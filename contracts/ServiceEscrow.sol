// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── ServiceEscrow (pull-payment, anti-squat, EIP-712 rescue) ─────────────────
//
// A minimal, auditable escrow for service bookings on the TradePort marketplace.
//
// Flow:
//   1. Customer calls deposit(bookingId, provider, amount).
//      The on-chain key is keccak256(customer, provider, bookingId) so no third
//      party can squat a booking ID intended for a different customer.
//   2. Funds sit locked. Customer calls release() when satisfied — credits the
//      provider's claimable balance (minus fee). Provider calls claim() any time.
//   3. Either party can dispute() to escalate to admin.
//   4. Admin calls adminRelease() (credit provider) or adminRefund() (credit customer).
//   5. If admin does not act within DISPUTE_TIMEOUT, customer calls refund().
//
// Pull-payment model:
//   All settlement writes to claimable[address]. No push to open-set addresses.
//   Recipients call claim(). If a wallet is blocklisted post-deposit only their
//   own claim() is affected — counterparty settles independently.
//
// Rescue path (EIP-712 gated):
//   rescueClaim(from, to, deadline, v, r, s) redirects claimable[from] to `to`
//   ONLY when `from` has signed an EIP-712 permit authorising exactly this rescue.
//   Admin alone cannot redirect without user consent (removes unilateral drain risk).
//
// Security properties:
//   - Reentrancy-guarded on all state-changing external calls.
//   - Fee snapshotted at deposit — immune to later setFee() calls.
//   - Escrow slot keyed by (customer, provider, bookingId) — anti-squatting.
//   - Admin is two-step transfer (propose + accept).

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ServiceEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 public constant MAX_FEE_BPS     = 500;   // 5 %
    uint256 public constant DISPUTE_TIMEOUT = 7 days;

    // EIP-712 type hash for the rescue permit.
    // RescuePermit(address from,address to,uint256 nonce,uint256 deadline)
    bytes32 public constant RESCUE_TYPEHASH = keccak256(
        "RescuePermit(address from,address to,uint256 nonce,uint256 deadline)"
    );

    // ── State ─────────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public           admin;
    address public           pendingAdmin;
    address public           feeRecipient;
    uint256 public           feeBps;

    // EIP-712 domain: cache the separator + the chain ID it was built for.
    // _buildDomainSeparator() recomputes when block.chainid differs (fork-safe).
    bytes32 private _cachedDomainSeparator;
    uint256 private _cachedChainId;

    enum EscrowStatus { Empty, Deposited, Released, Refunded, Disputed, Resolved }

    struct EscrowRecord {
        address      customer;
        address      provider;
        uint256      amount;
        uint256      feeBpsAtDeposit; // snapshotted — never changes per booking
        EscrowStatus status;
        uint256      depositedAt;
        uint256      disputedAt;
    }

    /// @dev Slot key = keccak256(abi.encode(customer, provider, bookingId)).
    ///      Binds the escrow to the depositing customer; prevents third-party squatting.
    mapping(bytes32 => EscrowRecord) public escrows;

    /// @dev Pull-payment ledger: address → claimable USDC amount.
    mapping(address => uint256) public claimable;

    /// @dev EIP-712 rescue nonces: signer → nonce (increments per rescue).
    mapping(address => uint256) public rescueNonces;

    // ── Events ────────────────────────────────────────────────────────────────

    event Deposited           (bytes32 indexed escrowKey, bytes32 indexed bookingId, address indexed customer, address provider, uint256 amount);
    event Released            (bytes32 indexed escrowKey, address indexed customer, uint256 providerCredit, uint256 feeCredit);
    event Disputed            (bytes32 indexed escrowKey, address indexed raisedBy);
    event AdminResolved       (bytes32 indexed escrowKey, bool releasedToProvider);
    event Refunded            (bytes32 indexed escrowKey, address indexed customer, uint256 amount);
    event Claimed             (address indexed recipient, uint256 amount);
    event ClaimRescued        (address indexed from, address indexed to, uint256 amount);
    event FeeUpdated          (uint256 newFeeBps);
    event FeeRecipientUpdated (address indexed oldRecipient, address indexed newRecipient);
    event AdminTransferProposed(address indexed proposed);
    event AdminTransferred    (address indexed newAdmin);

    // ── Custom errors ─────────────────────────────────────────────────────────

    error NotAdmin();
    error NotParty();
    error NotCustomer();
    error InvalidStatus(EscrowStatus current);
    error ZeroAmount();
    error ZeroAddress();
    error FeeTooHigh();
    error DisputeTimeoutNotReached();
    error NoPendingAdmin();
    error SameAdmin();
    error NothingToClaim();
    error InvalidSignature();
    error ExpiredDeadline();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _usdc, address _feeRecipient, uint256 _feeBps) {
        if (_usdc         == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS)       revert FeeTooHigh();

        usdc         = IERC20(_usdc);
        admin        = msg.sender;
        feeRecipient = _feeRecipient;
        feeBps       = _feeBps;

        _cachedChainId        = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// @dev Build the EIP-712 domain separator for the current chain.
    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("ServiceEscrow"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    /// @dev Fork-safe domain separator: recomputes if block.chainid has changed.
    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == _cachedChainId) return _cachedDomainSeparator;
        return _buildDomainSeparator();
    }

    /// @dev Derive the on-chain escrow slot key.
    function _escrowKey(address customer, address provider, bytes32 bookingId)
        internal pure returns (bytes32)
    {
        return keccak256(abi.encode(customer, provider, bookingId));
    }

    /// @dev Credit a claimable balance (no external call).
    function _credit(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        claimable[recipient] += amount;
    }

    // ── Customer actions ──────────────────────────────────────────────────────

    /// @notice Lock USDC into escrow for a booking.
    ///         The escrow slot is keyed by (msg.sender, provider, bookingId) so
    ///         only the intended customer can create this specific slot.
    /// @param bookingId Off-chain UUID encoded as bytes32 (keccak256 of the string).
    /// @param provider  Service provider wallet.
    /// @param amount    USDC amount in token-native decimals (6 for USDC).
    function deposit(bytes32 bookingId, address provider, uint256 amount)
        external
        nonReentrant
    {
        if (amount   == 0)          revert ZeroAmount();
        if (provider == address(0)) revert ZeroAddress();
        if (provider == msg.sender) revert ZeroAddress(); // no self-escrow

        bytes32 key = _escrowKey(msg.sender, provider, bookingId);
        EscrowRecord storage rec = escrows[key];
        if (rec.status != EscrowStatus.Empty) revert InvalidStatus(rec.status);

        rec.customer        = msg.sender;
        rec.provider        = provider;
        rec.amount          = amount;
        rec.feeBpsAtDeposit = feeBps;
        rec.status          = EscrowStatus.Deposited;
        rec.depositedAt     = block.timestamp;

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(key, bookingId, msg.sender, provider, amount);
    }

    /// @notice Release funds: credit provider (minus fee). Only the depositing customer.
    function release(bytes32 bookingId, address provider) external nonReentrant {
        bytes32 key = _escrowKey(msg.sender, provider, bookingId);
        EscrowRecord storage rec = escrows[key];
        if (msg.sender != rec.customer)           revert NotCustomer();
        if (rec.status != EscrowStatus.Deposited
            && rec.status != EscrowStatus.Disputed) revert InvalidStatus(rec.status);

        uint256 fee            = (rec.amount * rec.feeBpsAtDeposit) / 10_000;
        uint256 providerCredit = rec.amount - fee;

        rec.status = EscrowStatus.Released;

        _credit(rec.provider, providerCredit);
        _credit(feeRecipient, fee);

        emit Released(key, rec.customer, providerCredit, fee);
    }

    /// @notice Raise a dispute. Either party may call this.
    function dispute(bytes32 bookingId, address counterparty) external nonReentrant {
        // Determine key regardless of which party is calling.
        bytes32 key;
        if (msg.sender == escrows[_escrowKey(msg.sender, counterparty, bookingId)].customer) {
            key = _escrowKey(msg.sender, counterparty, bookingId);
        } else {
            key = _escrowKey(counterparty, msg.sender, bookingId);
        }

        EscrowRecord storage rec = escrows[key];
        if (rec.status != EscrowStatus.Deposited) revert InvalidStatus(rec.status);
        if (msg.sender != rec.customer && msg.sender != rec.provider) revert NotParty();

        rec.status     = EscrowStatus.Disputed;
        rec.disputedAt = block.timestamp;

        emit Disputed(key, msg.sender);
    }

    /// @notice Safety-valve: credit customer after DISPUTE_TIMEOUT with no admin action.
    function refund(bytes32 bookingId, address provider) external nonReentrant {
        bytes32 key = _escrowKey(msg.sender, provider, bookingId);
        EscrowRecord storage rec = escrows[key];
        if (msg.sender != rec.customer)          revert NotCustomer();
        if (rec.status != EscrowStatus.Disputed) revert InvalidStatus(rec.status);
        if (block.timestamp < rec.disputedAt + DISPUTE_TIMEOUT)
            revert DisputeTimeoutNotReached();

        uint256 amount = rec.amount;
        rec.status     = EscrowStatus.Refunded;

        _credit(rec.customer, amount);

        emit Refunded(key, rec.customer, amount);
    }

    // ── Claim (pull) ──────────────────────────────────────────────────────────

    /// @notice Withdraw all claimable USDC to msg.sender.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, amount);
    }

    // ── Admin actions ─────────────────────────────────────────────────────────

    /// @notice Resolve a dispute by crediting the provider.
    ///         Pass the raw escrow key (use the escrowKey() view to compute it off-chain).
    function adminRelease(bytes32 key) external onlyAdmin nonReentrant {
        EscrowRecord storage rec = escrows[key];
        if (rec.status != EscrowStatus.Disputed) revert InvalidStatus(rec.status);

        uint256 fee            = (rec.amount * rec.feeBpsAtDeposit) / 10_000;
        uint256 providerCredit = rec.amount - fee;

        rec.status = EscrowStatus.Resolved;

        _credit(rec.provider, providerCredit);
        _credit(feeRecipient, fee);

        emit AdminResolved(key, true);
    }

    /// @notice Resolve a dispute by crediting the full amount to the customer.
    function adminRefund(bytes32 key) external onlyAdmin nonReentrant {
        EscrowRecord storage rec = escrows[key];
        if (rec.status != EscrowStatus.Disputed) revert InvalidStatus(rec.status);

        uint256 amount = rec.amount;
        rec.status     = EscrowStatus.Resolved;

        _credit(rec.customer, amount);

        emit AdminResolved(key, false);
    }

    /// @notice Redirect a claimable balance to a new address.
    ///         Requires an EIP-712 signature from `from` — admin alone cannot execute.
    ///         Use when `from`'s address is permanently unpayable (e.g. blocklisted)
    ///         and the user has consented to a replacement address.
    /// @param from      Address whose claimable balance is being redirected.
    /// @param to        Replacement address (must be non-zero, must not be `from`).
    /// @param deadline  Unix timestamp after which the permit expires.
    /// @param v,r,s     EIP-712 signature from `from`.
    function rescueClaim(
        address from,
        address to,
        uint256 deadline,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external onlyAdmin nonReentrant {
        if (to == address(0) || to == from) revert ZeroAddress();
        if (block.timestamp > deadline)     revert ExpiredDeadline();

        uint256 amount = claimable[from];
        if (amount == 0) revert NothingToClaim();

        // Verify EIP-712 signature from `from`.
        uint256 nonce = rescueNonces[from];
        bytes32 structHash = keccak256(abi.encode(
            RESCUE_TYPEHASH, from, to, nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        address signer = ecrecover(digest, v, r, s);
        if (signer != from) revert InvalidSignature();

        rescueNonces[from] = nonce + 1;
        claimable[from]    = 0;
        claimable[to]     += amount;

        emit ClaimRescued(from, to, amount);
    }

    /// @notice Update platform fee (≤ MAX_FEE_BPS). Affects future deposits only.
    function setFee(uint256 newFeeBps) external onlyAdmin {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    /// @notice Update fee recipient address.
    function setFeeRecipient(address newRecipient) external onlyAdmin {
        if (newRecipient == address(0)) revert ZeroAddress();
        address old  = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(old, newRecipient);
    }

    /// @notice Step 1 of two-step admin transfer: propose a new admin.
    function proposeAdmin(address proposed) external onlyAdmin {
        if (proposed == address(0)) revert ZeroAddress();
        if (proposed == admin)      revert SameAdmin();
        pendingAdmin = proposed;
        emit AdminTransferProposed(proposed);
    }

    /// @notice Step 2: proposed admin accepts the role.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NoPendingAdmin();
        admin        = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(admin);
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    /// @notice Return the current EIP-712 domain separator (fork-safe).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    /// @notice Return the escrow slot key for a (customer, provider, bookingId) tuple.
    function escrowKey(address customer, address provider, bytes32 bookingId)
        external pure returns (bytes32)
    {
        return keccak256(abi.encode(customer, provider, bookingId));
    }

    /// @notice Return the EscrowRecord for a given escrow key.
    function getEscrow(bytes32 key) external view returns (EscrowRecord memory) {
        return escrows[key];
    }

    /// @notice Return the claimable balance for an address.
    function claimableOf(address account) external view returns (uint256) {
        return claimable[account];
    }

    /// @notice Return the current rescue nonce for an address (for permit construction).
    function rescueNonceOf(address account) external view returns (uint256) {
        return rescueNonces[account];
    }
}
