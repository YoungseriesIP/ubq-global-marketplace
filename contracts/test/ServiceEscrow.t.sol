// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {ServiceEscrow} from "../ServiceEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─── Invariant handler ────────────────────────────────────────────────────────
// Tracks ghost state so the invariant_Balance test can verify the accounting
// invariant: contract USDC balance == sum of locked (Deposited+Disputed) escrows
//            + sum of all claimable[] balances.
contract EscrowHandler is Test {
    ServiceEscrow public escrow;
    MockERC20     public usdc;

    // Ghost accounting
    uint256 public ghostLocked;       // sum of amounts in Deposited / Disputed escrows
    uint256 public ghostClaimable;    // sum of all claimable[] balances

    // Actors
    address internal customer = makeAddr("h_customer");
    address internal provider = makeAddr("h_provider");
    address internal admin;

    uint256 internal constant AMOUNT = 1_000e6;
    bytes32 internal constant BID    = keccak256("handler-booking");

    bool internal deposited;
    bool internal disputed;

    constructor(ServiceEscrow _escrow, MockERC20 _usdc, address _admin) {
        escrow = _escrow;
        usdc   = _usdc;
        admin  = _admin;
    }

    // ── Handler actions ───────────────────────────────────────────────────────

    function doDeposit() external {
        if (deposited) return;
        usdc.mint(customer, AMOUNT);
        vm.startPrank(customer);
        usdc.approve(address(escrow), AMOUNT);
        escrow.deposit(BID, provider, AMOUNT);
        vm.stopPrank();
        ghostLocked += AMOUNT;
        deposited    = true;
    }

    function doDispute() external {
        if (!deposited || disputed) return;
        vm.prank(customer);
        escrow.dispute(BID, provider);
        disputed = true;
    }

    function doAdminRelease() external {
        if (!disputed) return;
        bytes32 key = escrow.escrowKey(customer, provider, BID);
        ServiceEscrow.EscrowRecord memory rec = escrow.getEscrow(key);
        if (rec.status != ServiceEscrow.EscrowStatus.Disputed) return;

        vm.prank(admin);
        escrow.adminRelease(key);

        uint256 fee     = (AMOUNT * escrow.feeBps()) / 10_000;
        uint256 credit  = AMOUNT - fee;
        ghostLocked    -= AMOUNT;
        ghostClaimable += credit + fee;
        disputed        = false;
        deposited       = false;
    }

    function doAdminRefund() external {
        if (!disputed) return;
        bytes32 key = escrow.escrowKey(customer, provider, BID);
        ServiceEscrow.EscrowRecord memory rec = escrow.getEscrow(key);
        if (rec.status != ServiceEscrow.EscrowStatus.Disputed) return;

        vm.prank(admin);
        escrow.adminRefund(key);

        ghostLocked    -= AMOUNT;
        ghostClaimable += AMOUNT;
        disputed        = false;
        deposited       = false;
    }

    function doClaim(address who) external {
        uint256 bal = escrow.claimableOf(who);
        if (bal == 0) return;
        ghostClaimable -= bal;
        vm.prank(who);
        escrow.claim();
    }
}

// ─── Main test contract ───────────────────────────────────────────────────────
contract ServiceEscrowTest is Test {

    // ── Fixture ───────────────────────────────────────────────────────────────

    ServiceEscrow internal escrow;
    MockERC20     internal usdc;

    address internal adminAddr;
    address internal feeRcpt;
    address internal alice;       // customer
    address internal bob;         // provider
    address internal carol;       // second customer
    address internal eve;         // adversary / third party

    uint256 internal alicePk;
    uint256 internal bobPk;

    uint256 internal constant FEE_BPS   = 200; // 2 %
    uint256 internal constant AMOUNT    = 1_000e6;
    bytes32 internal constant BOOKING_A = keccak256("booking-A");
    bytes32 internal constant BOOKING_B = keccak256("booking-B");

    // ── setUp ─────────────────────────────────────────────────────────────────

    function setUp() public {
        adminAddr = makeAddr("admin");
        feeRcpt   = makeAddr("feeRecipient");
        (alice, alicePk) = makeAddrAndKey("alice");
        (bob,   bobPk)   = makeAddrAndKey("bob");
        carol = makeAddr("carol");
        eve   = makeAddr("eve");

        // Deploy mock USDC (6 decimals to match real USDC)
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // Deploy contract under test as adminAddr
        vm.prank(adminAddr);
        escrow = new ServiceEscrow(address(usdc), feeRcpt, FEE_BPS);

        // Fund alice and carol with ample USDC
        usdc.mint(alice, 100_000e6);
        usdc.mint(carol, 100_000e6);

        // Pre-approve for convenience (approve the full balance)
        vm.prank(alice);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. CONSTRUCTOR / INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────

    function test_ConstructorSetsStateCorrectly() public view {
        assertEq(address(escrow.usdc()),        address(usdc));
        assertEq(escrow.admin(),                adminAddr);
        assertEq(escrow.feeRecipient(),         feeRcpt);
        assertEq(escrow.feeBps(),               FEE_BPS);
        assertEq(escrow.pendingAdmin(),         address(0));
        assertEq(escrow.MAX_FEE_BPS(),          500);
        assertEq(escrow.DISPUTE_TIMEOUT(),      7 days);
    }

    function test_ConstructorRevertsOnZeroUsdc() public {
        vm.expectRevert(ServiceEscrow.ZeroAddress.selector);
        new ServiceEscrow(address(0), feeRcpt, FEE_BPS);
    }

    function test_ConstructorRevertsOnZeroFeeRecipient() public {
        vm.expectRevert(ServiceEscrow.ZeroAddress.selector);
        new ServiceEscrow(address(usdc), address(0), FEE_BPS);
    }

    function test_ConstructorRevertsOnFeeTooHigh() public {
        vm.expectRevert(ServiceEscrow.FeeTooHigh.selector);
        new ServiceEscrow(address(usdc), feeRcpt, 501);
    }

    function test_DomainSeparatorIsNonZero() public view {
        assertNotEq(escrow.domainSeparator(), bytes32(0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. VIEW HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    function test_EscrowKeyMatchesExpected() public view {
        bytes32 expected = keccak256(abi.encode(alice, bob, BOOKING_A));
        assertEq(escrow.escrowKey(alice, bob, BOOKING_A), expected);
    }

    function test_ClaimableOfReturnsZeroInitially() public view {
        assertEq(escrow.claimableOf(alice), 0);
    }

    function test_RescueNonceOfReturnsZeroInitially() public view {
        assertEq(escrow.rescueNonceOf(alice), 0);
    }

    function test_GetEscrowReturnsEmptyForUnknownKey() public view {
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        ServiceEscrow.EscrowRecord memory rec = escrow.getEscrow(key);
        assertEq(uint256(rec.status), uint256(ServiceEscrow.EscrowStatus.Empty));
        assertEq(rec.amount, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. DEPOSIT
    // ─────────────────────────────────────────────────────────────────────────

    function test_DepositHappyPath() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        ServiceEscrow.EscrowRecord memory rec = escrow.getEscrow(key);

        assertEq(rec.customer,        alice);
        assertEq(rec.provider,        bob);
        assertEq(rec.amount,          AMOUNT);
        assertEq(rec.feeBpsAtDeposit, FEE_BPS);
        assertEq(uint256(rec.status), uint256(ServiceEscrow.EscrowStatus.Deposited));
        assertEq(rec.depositedAt,     block.timestamp);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_DepositEmitsEvent() public {
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit ServiceEscrow.Deposited(key, BOOKING_A, alice, bob, AMOUNT);
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
    }

    function test_DepositRevertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(ServiceEscrow.ZeroAmount.selector);
        escrow.deposit(BOOKING_A, bob, 0);
    }

    function test_DepositRevertsOnZeroProvider() public {
        vm.prank(alice);
        vm.expectRevert(ServiceEscrow.ZeroAddress.selector);
        escrow.deposit(BOOKING_A, address(0), AMOUNT);
    }

    function test_DepositRevertsSelfEscrow() public {
        vm.prank(alice);
        vm.expectRevert(ServiceEscrow.ZeroAddress.selector);
        escrow.deposit(BOOKING_A, alice, AMOUNT);
    }

    function test_DepositRevertsOnDuplicateSlot() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        // Same slot → InvalidStatus(Deposited)
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ServiceEscrow.InvalidStatus.selector,
                ServiceEscrow.EscrowStatus.Deposited
            )
        );
        escrow.deposit(BOOKING_A, bob, AMOUNT);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. ANTI-SQUAT: two customers, same bookingId → independent slots
    // ─────────────────────────────────────────────────────────────────────────

    function test_AntiSquat_TwoCustomersSameBookingIdAreIndependent() public {
        // Alice deposits into her slot for booking A
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        // Carol deposits into her own slot for the SAME booking A and SAME provider
        vm.prank(carol);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        bytes32 keyAlice = escrow.escrowKey(alice, bob, BOOKING_A);
        bytes32 keyCarol = escrow.escrowKey(carol, bob, BOOKING_A);

        // Keys must differ
        assertTrue(keyAlice != keyCarol);

        // Both slots exist independently
        ServiceEscrow.EscrowRecord memory recAlice = escrow.getEscrow(keyAlice);
        ServiceEscrow.EscrowRecord memory recCarol = escrow.getEscrow(keyCarol);

        assertEq(recAlice.customer, alice);
        assertEq(recCarol.customer, carol);
        assertEq(recAlice.amount,   AMOUNT);
        assertEq(recCarol.amount,   AMOUNT);
        assertEq(uint256(recAlice.status), uint256(ServiceEscrow.EscrowStatus.Deposited));
        assertEq(uint256(recCarol.status), uint256(ServiceEscrow.EscrowStatus.Deposited));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. HAPPY PATH: deposit → release → claim
    // ─────────────────────────────────────────────────────────────────────────

    function test_HappyPath_DepositReleaseClaim() public {
        uint256 fee            = (AMOUNT * FEE_BPS) / 10_000;
        uint256 providerCredit = AMOUNT - fee;

        // Deposit
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        // Release
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);

        // Check claimable balances
        assertEq(escrow.claimableOf(bob),     providerCredit);
        assertEq(escrow.claimableOf(feeRcpt), fee);

        // Escrow status is Released
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        assertEq(
            uint256(escrow.getEscrow(key).status),
            uint256(ServiceEscrow.EscrowStatus.Released)
        );

        // Bob claims
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        escrow.claim();
        assertEq(usdc.balanceOf(bob), bobBefore + providerCredit);
        assertEq(escrow.claimableOf(bob), 0);

        // Fee recipient claims
        uint256 feeBefore = usdc.balanceOf(feeRcpt);
        vm.prank(feeRcpt);
        escrow.claim();
        assertEq(usdc.balanceOf(feeRcpt), feeBefore + fee);
    }

    function test_ReleaseEmitsReleasedEvent() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        uint256 fee            = (AMOUNT * FEE_BPS) / 10_000;
        uint256 providerCredit = AMOUNT - fee;
        bytes32 key            = escrow.escrowKey(alice, bob, BOOKING_A);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit ServiceEscrow.Released(key, alice, providerCredit, fee);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);
    }

    function test_ClaimEmitsClaimedEvent() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);

        uint256 providerCredit = AMOUNT - (AMOUNT * FEE_BPS) / 10_000;
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ServiceEscrow.Claimed(bob, providerCredit);
        vm.prank(bob);
        escrow.claim();
    }

    function test_ReleaseRevertsIfNotCustomer() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        // Bob tries to release alice's escrow (wrong caller)
        vm.prank(bob);
        vm.expectRevert(ServiceEscrow.NotCustomer.selector);
        escrow.release(BOOKING_A, bob);
    }

    function test_ReleaseRevertsOnWrongStatus() public {
        // Deposit → dispute (status = Disputed is fine for release, but Released is not)
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);
        // Trying to release a second time
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ServiceEscrow.InvalidStatus.selector,
                ServiceEscrow.EscrowStatus.Released
            )
        );
        escrow.release(BOOKING_A, bob);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. FEE SNAPSHOT — fee baked at deposit, immune to later setFee
    // ─────────────────────────────────────────────────────────────────────────

    function test_FeeSnapshotIsImmutablePerBooking() public {
        // Deposit at 2 % fee
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        // Admin changes fee to 5 %
        vm.prank(adminAddr);
        escrow.setFee(500);

        // Release should still use 2 % (snapshotted)
        uint256 feeExpected    = (AMOUNT * FEE_BPS) / 10_000; // 2 % = 20 USDC
        uint256 creditExpected = AMOUNT - feeExpected;

        vm.prank(alice);
        escrow.release(BOOKING_A, bob);

        assertEq(escrow.claimableOf(bob),     creditExpected);
        assertEq(escrow.claimableOf(feeRcpt), feeExpected);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. DISPUTE → ADMIN RELEASE → CLAIM
    // ─────────────────────────────────────────────────────────────────────────

    function test_DisputeAdminReleaseClaim() public {
        uint256 fee            = (AMOUNT * FEE_BPS) / 10_000;
        uint256 providerCredit = AMOUNT - fee;

        // Deposit
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        // Customer disputes
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit ServiceEscrow.Disputed(key, alice);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);

        // Status is Disputed
        assertEq(
            uint256(escrow.getEscrow(key).status),
            uint256(ServiceEscrow.EscrowStatus.Disputed)
        );

        // Admin resolves in provider's favour
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ServiceEscrow.AdminResolved(key, true);
        vm.prank(adminAddr);
        escrow.adminRelease(key);

        // Status is Resolved
        assertEq(
            uint256(escrow.getEscrow(key).status),
            uint256(ServiceEscrow.EscrowStatus.Resolved)
        );

        // Claimables correct
        assertEq(escrow.claimableOf(bob),     providerCredit);
        assertEq(escrow.claimableOf(feeRcpt), fee);

        // Bob claims
        vm.prank(bob);
        escrow.claim();
        assertEq(usdc.balanceOf(bob), providerCredit);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. DISPUTE → ADMIN REFUND → CLAIM (provider disputes)
    // ─────────────────────────────────────────────────────────────────────────

    function test_DisputeByProviderAdminRefundClaim() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);

        // Provider raises dispute (counterparty = alice = customer)
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit ServiceEscrow.Disputed(key, bob);
        vm.prank(bob);
        escrow.dispute(BOOKING_A, alice);

        // Admin refunds customer
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ServiceEscrow.AdminResolved(key, false);
        vm.prank(adminAddr);
        escrow.adminRefund(key);

        // Alice's claimable = full amount (no fee on refund)
        assertEq(escrow.claimableOf(alice), AMOUNT);
        assertEq(escrow.claimableOf(feeRcpt), 0);

        // Alice claims
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.claim();
        assertEq(usdc.balanceOf(alice), before + AMOUNT);
    }

    function test_DisputeRevertsIfNotParty() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        // Eve calls dispute(BOOKING_A, alice) as if she were the provider.
        // The contract computes _escrowKey(eve, alice, BOOKING_A) first:
        // that slot is Empty (status 0), so it falls through to the provider path
        // which yields _escrowKey(alice, eve, BOOKING_A) — also Empty.
        // The rec.status check fires first → InvalidStatus(Empty) before NotParty.
        vm.prank(eve);
        vm.expectRevert(
            abi.encodeWithSelector(
                ServiceEscrow.InvalidStatus.selector,
                ServiceEscrow.EscrowStatus.Empty
            )
        );
        escrow.dispute(BOOKING_A, alice);
    }

    function test_DisputeRevertsOnWrongStatus() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        // Already disputed → InvalidStatus(Disputed)
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ServiceEscrow.InvalidStatus.selector,
                ServiceEscrow.EscrowStatus.Disputed
            )
        );
        escrow.dispute(BOOKING_A, bob);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. DISPUTE KEY RECONSTRUCTION — both caller paths
    // ─────────────────────────────────────────────────────────────────────────

    function test_DisputeKeyReconstructionCustomerCaller() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        // Customer (alice) calls dispute(bookingId, counterparty=provider)
        // Internal path: key = _escrowKey(msg.sender=alice, counterparty=bob, bookingId)
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        assertEq(
            uint256(escrow.getEscrow(key).status),
            uint256(ServiceEscrow.EscrowStatus.Disputed)
        );
    }

    function test_DisputeKeyReconstructionProviderCaller() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        // Provider (bob) calls dispute(bookingId, counterparty=customer=alice)
        // Internal path falls through to: key = _escrowKey(counterparty=alice, msg.sender=bob, bookingId)
        vm.prank(bob);
        escrow.dispute(BOOKING_A, alice);
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        assertEq(
            uint256(escrow.getEscrow(key).status),
            uint256(ServiceEscrow.EscrowStatus.Disputed)
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. TIMEOUT REFUND → CLAIM
    // ─────────────────────────────────────────────────────────────────────────

    function test_TimeoutRefundAndClaim() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);

        // Warp past DISPUTE_TIMEOUT
        skip(7 days + 1);

        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit ServiceEscrow.Refunded(key, alice, AMOUNT);
        vm.prank(alice);
        escrow.refund(BOOKING_A, bob);

        assertEq(escrow.claimableOf(alice), AMOUNT);
        assertEq(
            uint256(escrow.getEscrow(key).status),
            uint256(ServiceEscrow.EscrowStatus.Refunded)
        );

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.claim();
        assertEq(usdc.balanceOf(alice), before + AMOUNT);
    }

    function test_RefundRevertsBeforeTimeout() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);

        // Only advance 3 days (not enough)
        skip(3 days);

        vm.prank(alice);
        vm.expectRevert(ServiceEscrow.DisputeTimeoutNotReached.selector);
        escrow.refund(BOOKING_A, bob);
    }

    function test_RefundRevertsIfNotDisputed() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        // Status is Deposited, not Disputed
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ServiceEscrow.InvalidStatus.selector,
                ServiceEscrow.EscrowStatus.Deposited
            )
        );
        escrow.refund(BOOKING_A, bob);
    }

    function test_RefundRevertsIfNotCustomer() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        skip(7 days + 1);
        // Bob tries to call refund as the customer — he is not
        vm.prank(bob);
        vm.expectRevert(ServiceEscrow.NotCustomer.selector);
        escrow.refund(BOOKING_A, bob);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. MULTI-ESCROW ACCUMULATION (two bookings, same provider, single claim)
    // ─────────────────────────────────────────────────────────────────────────

    function test_MultiEscrowAccumulation() public {
        uint256 fee1    = (AMOUNT * FEE_BPS) / 10_000;
        uint256 credit1 = AMOUNT - fee1;
        uint256 fee2    = (AMOUNT * 2 * FEE_BPS) / 10_000;
        uint256 credit2 = AMOUNT * 2 - fee2;

        // Booking A: 1_000 USDC
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);

        // Booking B (same provider, bigger amount): 2_000 USDC
        vm.prank(alice);
        escrow.deposit(BOOKING_B, bob, AMOUNT * 2);
        vm.prank(alice);
        escrow.release(BOOKING_B, bob);

        // Bob's claimable should be sum of both credits
        assertEq(escrow.claimableOf(bob), credit1 + credit2);

        // Single claim drains both
        vm.prank(bob);
        escrow.claim();
        assertEq(usdc.balanceOf(bob), credit1 + credit2);
        assertEq(escrow.claimableOf(bob), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 12. DOUBLE-CLAIM REVERTS
    // ─────────────────────────────────────────────────────────────────────────

    function test_DoubleClaimReverts() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);

        vm.prank(bob);
        escrow.claim();

        // Second claim → NothingToClaim
        vm.prank(bob);
        vm.expectRevert(ServiceEscrow.NothingToClaim.selector);
        escrow.claim();
    }

    function test_ClaimNothingToClaim() public {
        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NothingToClaim.selector);
        escrow.claim();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 13. ADMIN ACTIONS — access control
    // ─────────────────────────────────────────────────────────────────────────

    function test_AdminReleaseRevertsIfNotAdmin() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);

        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NotAdmin.selector);
        escrow.adminRelease(key);
    }

    function test_AdminRefundRevertsIfNotAdmin() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);

        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NotAdmin.selector);
        escrow.adminRefund(key);
    }

    function test_AdminReleaseRevertsIfNotDisputed() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        // Still Deposited, not Disputed
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        vm.prank(adminAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                ServiceEscrow.InvalidStatus.selector,
                ServiceEscrow.EscrowStatus.Deposited
            )
        );
        escrow.adminRelease(key);
    }

    function test_AdminRefundRevertsIfNotDisputed() public {
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        bytes32 key = escrow.escrowKey(alice, bob, BOOKING_A);
        vm.prank(adminAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                ServiceEscrow.InvalidStatus.selector,
                ServiceEscrow.EscrowStatus.Deposited
            )
        );
        escrow.adminRefund(key);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 14. setFee / setFeeRecipient
    // ─────────────────────────────────────────────────────────────────────────

    function test_SetFeeHappyPath() public {
        vm.expectEmit(false, false, false, true, address(escrow));
        emit ServiceEscrow.FeeUpdated(300);
        vm.prank(adminAddr);
        escrow.setFee(300);
        assertEq(escrow.feeBps(), 300);
    }

    function test_SetFeeRevertsIfTooHigh() public {
        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.FeeTooHigh.selector);
        escrow.setFee(501);
    }

    function test_SetFeeRevertsIfNotAdmin() public {
        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NotAdmin.selector);
        escrow.setFee(100);
    }

    function test_SetFeeRecipientHappyPath() public {
        address newRcpt = makeAddr("newFeeRcpt");
        vm.expectEmit(true, true, false, false, address(escrow));
        emit ServiceEscrow.FeeRecipientUpdated(feeRcpt, newRcpt);
        vm.prank(adminAddr);
        escrow.setFeeRecipient(newRcpt);
        assertEq(escrow.feeRecipient(), newRcpt);
    }

    function test_SetFeeRecipientRevertsOnZeroAddress() public {
        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.ZeroAddress.selector);
        escrow.setFeeRecipient(address(0));
    }

    function test_SetFeeRecipientRevertsIfNotAdmin() public {
        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NotAdmin.selector);
        escrow.setFeeRecipient(makeAddr("x"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 15. TWO-STEP ADMIN TRANSFER
    // ─────────────────────────────────────────────────────────────────────────

    function test_TwoStepAdminTransferHappyPath() public {
        address newAdmin = makeAddr("newAdmin");

        // Step 1: propose
        vm.expectEmit(true, false, false, false, address(escrow));
        emit ServiceEscrow.AdminTransferProposed(newAdmin);
        vm.prank(adminAddr);
        escrow.proposeAdmin(newAdmin);
        assertEq(escrow.pendingAdmin(), newAdmin);
        assertEq(escrow.admin(), adminAddr); // unchanged yet

        // Step 2: accept
        vm.expectEmit(true, false, false, false, address(escrow));
        emit ServiceEscrow.AdminTransferred(newAdmin);
        vm.prank(newAdmin);
        escrow.acceptAdmin();
        assertEq(escrow.admin(), newAdmin);
        assertEq(escrow.pendingAdmin(), address(0));
    }

    function test_ProposeAdminRevertsOnZeroAddress() public {
        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.ZeroAddress.selector);
        escrow.proposeAdmin(address(0));
    }

    function test_ProposeAdminRevertsOnSameAdmin() public {
        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.SameAdmin.selector);
        escrow.proposeAdmin(adminAddr);
    }

    function test_ProposeAdminRevertsIfNotAdmin() public {
        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NotAdmin.selector);
        escrow.proposeAdmin(makeAddr("x"));
    }

    function test_AcceptAdminRevertsIfNotPendingAdmin() public {
        vm.prank(adminAddr);
        escrow.proposeAdmin(makeAddr("newAdmin"));
        // Eve is not pendingAdmin
        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NoPendingAdmin.selector);
        escrow.acceptAdmin();
    }

    function test_AcceptAdminRevertsWithNoPendingAdmin() public {
        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NoPendingAdmin.selector);
        escrow.acceptAdmin();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 16. rescueClaim — EIP-712 happy path
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Build the EIP-712 digest the same way the contract does.
    function _buildRescueDigest(
        address from,
        address to,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 domSep = escrow.domainSeparator();
        bytes32 structHash = keccak256(abi.encode(
            escrow.RESCUE_TYPEHASH(),
            from,
            to,
            nonce,
            deadline
        ));
        return keccak256(abi.encodePacked("\x19\x01", domSep, structHash));
    }

    function test_RescueClaimHappyPath() public {
        // Give alice a claimable balance
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);
        // For this test, rescue alice's zero (she released it to bob) so use bob's
        // Actually let's set up alice having a claimable directly via refund path
        // Use carol as the one to rescue: carol gets credit via adminRefund
        vm.prank(carol);
        escrow.deposit(BOOKING_B, bob, AMOUNT);
        vm.prank(carol);
        escrow.dispute(BOOKING_B, bob);
        bytes32 keyCarol = escrow.escrowKey(carol, bob, BOOKING_B);
        vm.prank(adminAddr);
        escrow.adminRefund(keyCarol);
        // carol now has AMOUNT claimable
        assertEq(escrow.claimableOf(carol), AMOUNT);

        // carol (carolPk) signs rescue to redirect to eve
        // We need carol's private key — carol was made with makeAddr which has no key.
        // Redo with a keypair carol.
        // Note: we used makeAddr("carol") not makeAddrAndKey. Use alice instead.
        // alice is a depositing customer — her claimable is 0 after the release above.
        // Let's give alice a separate refund via a third booking.
        vm.prank(alice);
        escrow.deposit(keccak256("booking-C"), bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(keccak256("booking-C"), bob);
        bytes32 keyC = escrow.escrowKey(alice, bob, keccak256("booking-C"));
        vm.prank(adminAddr);
        escrow.adminRefund(keyC);
        // alice now has AMOUNT claimable
        assertEq(escrow.claimableOf(alice), AMOUNT);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce    = escrow.rescueNonceOf(alice);
        bytes32 digest   = _buildRescueDigest(alice, eve, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit ServiceEscrow.ClaimRescued(alice, eve, AMOUNT);
        vm.prank(adminAddr);
        escrow.rescueClaim(alice, eve, deadline, v, r, s);

        assertEq(escrow.claimableOf(alice), 0);
        assertEq(escrow.claimableOf(eve),   AMOUNT);
        assertEq(escrow.rescueNonceOf(alice), 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 17. rescueClaim — replay reverts (nonce consumed)
    // ─────────────────────────────────────────────────────────────────────────

    function test_RescueClaimReplayReverts() public {
        // Set up alice's claimable via dispute → adminRefund
        bytes32 keyA = keccak256(abi.encode(alice, bob, BOOKING_A));
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        vm.prank(adminAddr);
        escrow.adminRefund(keyA);
        assertEq(escrow.claimableOf(alice), AMOUNT);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce    = escrow.rescueNonceOf(alice); // == 0
        bytes32 digest   = _buildRescueDigest(alice, eve, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        // First rescue: succeeds (nonce 0 → increments to 1)
        vm.prank(adminAddr);
        escrow.rescueClaim(alice, eve, deadline, v, r, s);
        assertEq(escrow.rescueNonceOf(alice), 1);

        // Replenish alice's claimable via a second dispute so the signature is the failing gate
        bytes32 keyB = keccak256(abi.encode(alice, bob, BOOKING_B));
        vm.prank(alice);
        escrow.deposit(BOOKING_B, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_B, bob);
        vm.prank(adminAddr);
        escrow.adminRefund(keyB);
        assertEq(escrow.claimableOf(alice), AMOUNT);

        // Replay the old signature (same v,r,s, stale nonce=0) → InvalidSignature
        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.InvalidSignature.selector);
        escrow.rescueClaim(alice, eve, deadline, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 18. rescueClaim — expired deadline reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_RescueClaimExpiredDeadlineReverts() public {
        // Give alice claimable using pre-computed key (avoids consuming vm.prank)
        bytes32 key = keccak256(abi.encode(alice, bob, BOOKING_A));
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        vm.prank(adminAddr);
        escrow.adminRefund(key);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce    = escrow.rescueNonceOf(alice);
        bytes32 digest   = _buildRescueDigest(alice, eve, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        // Warp past the deadline
        skip(2 hours);

        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.ExpiredDeadline.selector);
        escrow.rescueClaim(alice, eve, deadline, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 19. rescueClaim — wrong signer reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_RescueClaimWrongSignerReverts() public {
        // Give alice claimable using pre-computed key
        bytes32 key = keccak256(abi.encode(alice, bob, BOOKING_A));
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        vm.prank(adminAddr);
        escrow.adminRefund(key);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce    = escrow.rescueNonceOf(alice);
        bytes32 digest   = _buildRescueDigest(alice, eve, nonce, deadline);
        // Bob signs instead of alice
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobPk, digest);

        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.InvalidSignature.selector);
        escrow.rescueClaim(alice, eve, deadline, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 20. rescueClaim — non-admin caller reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_RescueClaimNonAdminReverts() public {
        // Give alice claimable using pre-computed key
        bytes32 key = keccak256(abi.encode(alice, bob, BOOKING_A));
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        vm.prank(adminAddr);
        escrow.adminRefund(key);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce    = escrow.rescueNonceOf(alice);
        bytes32 digest   = _buildRescueDigest(alice, eve, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        // Eve calls rescueClaim (not admin)
        vm.prank(eve);
        vm.expectRevert(ServiceEscrow.NotAdmin.selector);
        escrow.rescueClaim(alice, eve, deadline, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 21. rescueClaim — zero `to` reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_RescueClaimZeroToReverts() public {
        // Give alice claimable using pre-computed key
        bytes32 key = keccak256(abi.encode(alice, bob, BOOKING_A));
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, AMOUNT);
        vm.prank(alice);
        escrow.dispute(BOOKING_A, bob);
        vm.prank(adminAddr);
        escrow.adminRefund(key);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest   = _buildRescueDigest(alice, address(0), 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.ZeroAddress.selector);
        escrow.rescueClaim(alice, address(0), deadline, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 22. rescueClaim — NothingToClaim reverts
    // ─────────────────────────────────────────────────────────────────────────

    function test_RescueClaimNothingToClaimReverts() public {
        // alice has zero claimable
        assertEq(escrow.claimableOf(alice), 0);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce    = escrow.rescueNonceOf(alice);
        bytes32 digest   = _buildRescueDigest(alice, eve, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        vm.prank(adminAddr);
        vm.expectRevert(ServiceEscrow.NothingToClaim.selector);
        escrow.rescueClaim(alice, eve, deadline, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 23. FUZZ: fee arithmetic is correct across all amounts and fee rates
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_FeeArithmetic(uint256 amount, uint256 bps) public {
        amount = bound(amount, 1, 1_000_000e6);  // up to 1M USDC
        bps    = bound(bps, 0, 500);             // 0 – 5 %

        // Set fee
        vm.prank(adminAddr);
        escrow.setFee(bps);

        // Fund & deposit
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, amount);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);

        uint256 feeExpected    = (amount * bps) / 10_000;
        uint256 creditExpected = amount - feeExpected;

        assertEq(escrow.claimableOf(bob),     creditExpected);
        assertEq(escrow.claimableOf(feeRcpt), feeExpected);
        // Conservation: fee + credit == amount
        assertEq(feeExpected + creditExpected, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 24. FUZZ: claimableOf / balanceOf accounting after claim
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_ClaimDrainsExactBalance(uint256 amount) public {
        amount = bound(amount, 1, 10_000e6);
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(alice);
        escrow.deposit(BOOKING_A, bob, amount);
        vm.prank(alice);
        escrow.release(BOOKING_A, bob);

        uint256 credit = escrow.claimableOf(bob);
        uint256 before = usdc.balanceOf(bob);
        vm.prank(bob);
        escrow.claim();
        assertEq(usdc.balanceOf(bob), before + credit);
        assertEq(escrow.claimableOf(bob), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 25. INVARIANT: contract USDC balance == locked + claimable
    // ─────────────────────────────────────────────────────────────────────────
}

// ─── Invariant test (separate contract per Foundry convention) ────────────────
contract ServiceEscrowInvariantTest is Test {
    ServiceEscrow internal escrow;
    MockERC20     internal usdc;
    EscrowHandler internal handler;

    address internal adminAddr;
    address internal feeRcpt;

    // Cache the actor addresses so invariant functions can use them without
    // calling makeAddr (which internally writes label storage and is non-view).
    address internal hCustomer;
    address internal hProvider;

    function setUp() public {
        adminAddr = makeAddr("inv_admin");
        feeRcpt   = makeAddr("inv_fee");
        hCustomer = makeAddr("h_customer");
        hProvider = makeAddr("h_provider");

        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.prank(adminAddr);
        escrow  = new ServiceEscrow(address(usdc), feeRcpt, 200);
        handler = new EscrowHandler(escrow, usdc, adminAddr);
        targetContract(address(handler));
    }

    /// @notice PROPERTY: contract USDC balance == ghost locked + ghost claimable.
    ///         The handler tracks both via ghost variables updated at every action.
    function invariant_ContractBalanceEqualsCoverage() public view {
        uint256 contractBal = usdc.balanceOf(address(escrow));
        assertEq(
            contractBal,
            handler.ghostLocked() + handler.ghostClaimable(),
            "balance mismatch: contract balance != ghostLocked + ghostClaimable"
        );
    }

    /// @notice PROPERTY: total reported claimable for all actors fits within
    ///         the accounting envelope (ghostClaimable + ghostLocked).
    function invariant_ClaimableViewsWithinEnvelope() public view {
        uint256 reportedClaimable =
            escrow.claimableOf(hCustomer) +
            escrow.claimableOf(hProvider) +
            escrow.claimableOf(feeRcpt);

        assertLe(
            reportedClaimable,
            handler.ghostClaimable() + handler.ghostLocked(),
            "reported claimable exceeds accounting envelope"
        );
    }
}
