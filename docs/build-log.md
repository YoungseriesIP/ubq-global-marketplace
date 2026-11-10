# UBQ Global Marketplace: Build Log

A complete record of how this app was built, the problems met along the way (especially email sign-in), the real services and tools used, and what each costs.

Written 7 November 2026. The app is currently branded "TradePort" in the header and page title. It can be renamed on request.

Left out on purpose: personal names, email addresses, passwords, SMTP credentials and API keys. Never add those to this file.

---

## 1. What the product is

A global, multi-vendor marketplace where anyone can sell goods and services, get paid in USDC, and sign in with just an email (no crypto wallet needed). It runs on Arc Testnet, so no real money moves yet.

Main parts:
- **Marketplace:** shared listings, My Shop page, orders, country filter, local-currency prices.
- **Services and Diaspora Directory:** provider profiles, search, map, favourites, reviews, messaging, bookings, scam reports.
- **Payments:** direct USDC payment, "pay in person", and an escrow contract that holds funds until the customer confirms.
- **Sign-in:** email code, Google, or an existing wallet. Email and Google users get a wallet created for them.

---

## 2. Timeline of the build

### Step 1: First marketplace
- Built a one-page marketplace: browse listings, search, categories, create a listing, buy with USDC.
- Stack: React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit (wallet connection).
- Chain: Arc Testnet (chain ID 5042002). USDC is both the money and the gas.
- Listings were held in memory, so they disappeared on refresh.

### Step 2: Services and Diaspora Directory (five phases, one at a time)
You asked for a directory where service providers (tailors, barbers, mechanics, bakers, hotels, visa consultants and more) can be found by nearby customers. It was built in phases, each approved with "continue".

| Phase | What was built |
|---|---|
| 1. Profiles and categories | Eight categories with subcategories. Profile with photo, bio, years of experience, languages, services and prices, working hours, contacts, location (shop or travels to you), optional community tag, portfolio gallery, hotel extras (rooms, amenities, check-in), visa-agent extras and the "never pay the full fee upfront" warning. Shareable profile page. |
| 2. Search and maps | Keyword and category search, Near Me (browser location) with a distance radius, filters (rating, price, language, open now, travels to you), sorting, map view, favourites, paging. Distance uses a standard great-circle formula. |
| 3. Trust and ID checks | Consent screen (NDPA, GDPR, CCPA wording), ID and selfie flow, status badges, scam-report form, admin panel for the review queue and suspensions. In this version the ID check is simulated in the browser. |
| 4. Reviews | 1 to 5 stars, written reviews, photos, one provider reply, report-a-review, hotel and visa sub-ratings, verified-customer labels, admin hide and unhide. |
| 5. Contact, booking, payments | In-app messaging, booking requests, USDC payment, pay-in-person, safety notices, escrow option. |

Phase 6 (full server-side admin, moderation and disputes) was not built. See section 8.

### Step 3: Escrow contract
- Wrote `ServiceEscrow.sol` (Solidity, OpenZeppelin, Foundry tests).
- Went through several automated security reviews and rewrote it twice:
  1. First version pushed money to users. Found a risk that a blocked wallet could freeze a payout. Rewritten so people **claim** their money instead.
  2. Found that the admin could raise fees on money already deposited. Fixed by locking the fee when a booking is paid.
  3. Found that an admin function could redirect any user's balance. Fixed by requiring a signature from the affected user.
  4. Found that a stranger could take a booking ID first. Fixed by tying each escrow to the customer and provider.
  5. Fixed a signature-domain issue that could matter if the chain ever forked.
- Final result: automated review found nothing further; 62 tests pass, including fuzz and invariant tests.
- Not yet deployed, and **not independently audited by a professional firm**.

### Step 4: Country-based view
- Detects the visitor's country and shows goods and services for that country. Visitors can change it or choose "All countries". Remembered between visits.
- Later changed to use browser language settings instead of a third-party lookup, so visitors' IP addresses are not sent anywhere.

### Step 5: First public link
- Deployed the static app to Vercel: https://arc-studio-bc2ab11b9bf545ba878dd524.vercel.app
- That link is the version before email sign-in, the server, and the multi-vendor work. It does not include any of them.

### Step 6: Making it friendly for non-crypto users
Your suggestions, all built:
1. **Email or Google sign-in** with a wallet created automatically (Circle user-controlled wallets).
2. **Local-currency prices** converted to USDC at checkout.
3. **Multi-vendor marketplace**: anyone can open a shop and list items.

This required a new server and database, because browsers cannot share data between users.
- Server: Hono web framework on Bun, SQLite database.
- A Circle API key was created in your Circle account with your approval. It lives only in the server's private settings.
- Listings, shops and orders moved from memory to the database.
- Payments now work for both wallet types through one shared path.
- Fixed a bug in the old escrow screen, which approved spending but never actually deposited.
- Demo listings are marked as demos and cannot be bought, because nobody owns those seller addresses.

### Step 7: Safety pass
- Circle API key never reaches the browser; scanned the whole project and built app for it, found nowhere.
- Database moved outside the project folder so it can never be uploaded with the code.
- Sign-in sessions stored as hashes. Emails are not stored. Public seller names are never taken from an email.
- Tokens, keys and signatures are hidden from the in-app request traces.
- Request size limit, generic error messages, security headers, safer links, image links that send no referrer.
- The shared platform wallet no longer gets an admin button; admins come from `VITE_ADMIN_ADDRESSES`.

### Step 8: Hugging Face deployment (blocked)
You approved a public deployment, but the Hugging Face account was not connected, so nothing was published.

---

## 3. The email sign-in challenge, in detail

### Goal
Users sign up with only an email, receive a one-time code in their inbox, and get a wallet automatically.

### What had to be true
1. Circle sends the code email, so Circle needs an email account to send from (SMTP).
2. Circle needs your **App ID** (the app already had it).
3. Google sign-in needs a Google Client ID (not done yet).

### What happened, in order
1. **Choosing a test mail service.** Mailtrap was chosen because it is free to start and Circle's own guide uses it.
2. **Mailtrap sign-up questions.**
   - "Which products?" Answer: **Email Sandbox** only (the test inbox).
   - "What's your stack?" Answer: **Other** (Circle sends the mail, so it does not matter).
3. **Finding the SMTP details on a phone.** The settings gear seemed to do nothing because the panel opened off the screen edge. Fix: turn on **Desktop site** in the browser menu and zoom out. This showed the **Integration** tab with Host, Port, Username and Password.
4. **Values used.**
   - Host: `sandbox.smtp.mailtrap.io`
   - Port: Mailtrap lists 25, 465, 587 or 2525
   - Username and password: copied from Mailtrap and entered only in the Circle Console, never in chat.
5. **Circle Console.** Wallets, User Controlled, Configurator, Authentication Methods, Email.
6. **The error.** Saving the Email form first failed. Changing the **port** fixed it.
7. **Test email.** The Console's send-test-email button worked.
8. **First real sign-in test.** You expected the code in your main inbox and did not see it. This is how a sandbox works: it catches mail in the Mailtrap inbox and never delivers to real addresses.
9. **Success.** You opened Mailtrap, found the code, entered it in the Circle window, and logged in.

### The lesson
- Sandbox = for testing only. Codes arrive in Mailtrap.
- Going live needs real delivery. See section 4.

---

## 4. Making email work for real users (to do)

Real inboxes only accept mail from a **domain you own and have verified**. A Gmail or Yahoo address cannot be the sender.

1. Buy a domain (for example from Namecheap, Cloudflare or GoDaddy).
2. In Mailtrap open **Domains**, tap **Add Domain**.
3. Add the DNS records Mailtrap shows (four CNAME records and one TXT record) at your domain provider, then tap **Verify DNS Records**. DNS can take 15 minutes to 24 hours.
4. Complete the **Sender information** form and the automatic **compliance check**. A "Verified" badge means ready.
5. In Mailtrap, **Sending Setup**, pick the domain and the **Transactional Stream**, switch to **SMTP**:
   - Host `live.smtp.mailtrap.io`, port `587` (try `2525` if Circle rejects it), username `api`, password is an API token.
6. In the Circle Console, replace the Email settings with these values. Set **From** to an address on your verified domain.
7. Send a test email to a real address and check the spam folder too.
8. Sign in from the app with a different real email to prove the whole path.

Other sending services (SendGrid, Mailgun, Amazon SES) work the same way: four SMTP values plus a verified domain.

---

## 5. Real names of services, tools and files

### Services and accounts
| Name | Used for |
|---|---|
| Circle Developer Console (console.circle.com) | API key, user-controlled wallets, Email and Google sign-in settings (Wallets, User Controlled, Configurator) |
| Circle user-controlled wallets | The wallet created for each email or Google user, locked with the user's own PIN |
| Mailtrap | Test inbox now (Email Sandbox); live sending later (Email API/SMTP) |
| Google Cloud Console (Google Auth Platform) | Google Client ID for "Continue with Google" (still to do) |
| Arc Testnet and USDC | Chain and money. Test funds from the built-in "Get test USDC" button |
| Vercel | The first static public link |
| Hugging Face Spaces | Planned home for the full app with its server (not connected yet) |

### Software
React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit, Hono, Bun with SQLite, Circle web wallet SDK, OpenZeppelin contracts, Foundry (contract tests).

### Main folders and files
- `src/App.tsx`: app shell, marketplace and views.
- `src/components/`: Navbar, ListingCard, BuyModal, CreateListingModal, ShopPage, CountryFilterBanner.
- `src/components/services/`: the whole services directory (profiles, search, map, KYC screens, reviews, messaging, booking, payment, admin).
- `src/auth/`: sign-in context and modal, account menu, wallet payments.
- `src/lib/`: server calls and currency helpers.
- `server/`: `index.ts` (routes), `db.ts` (database), `auth.ts` (sessions), `wallet.ts` (Circle wallet routes).
- `contracts/ServiceEscrow.sol` and `contracts/test/ServiceEscrow.t.sol`: escrow and its tests.
- `README.md`, `AGENTS.md`, `docs/build-log.md`: documentation.

### Settings (names only, no values)
| Name | Public? | Purpose |
|---|---|---|
| `CIRCLE_API_KEY` | **Secret** | Server creates wallets |
| `VITE_CIRCLE_APP_ID` | Public | Identifies your Circle wallet setup |
| `VITE_GOOGLE_CLIENT_ID` | Public | Turns on Google sign-in |
| `VITE_ESCROW_ADDRESS` | Public | Turns on escrow after deployment |
| `VITE_ADMIN_ADDRESSES` | Public | Wallets that see the admin button |
| `DB_PATH` | Server | Where the database file is kept |

---

## 6. Problems met and how they were solved

| Problem | Fix |
|---|---|
| Escrow could freeze if a wallet was blocked | Changed to claim-based payouts |
| Admin could redirect user balances | Needs the user's own signature |
| Anyone could grab a booking ID | Escrow tied to customer and provider |
| Code checks failed (date in render, effect state, async without await) | Rewrote those parts |
| A map icon name clashed with the built-in Map type | Renamed the icon import |
| Server database types broke the rest of the type checks | Used a small local type description instead of global ones |
| Production build was killed once for memory | Re-ran with the dev server idle |
| Country lookup would be blocked on an https site | Replaced with browser language region |
| Request traces could have shown login tokens | Added automatic hiding of secrets |
| Mailtrap settings panel not visible on phone | Desktop site mode |
| Circle rejected the Email form | Changed the port |
| "I never got the code" | Sandbox inboxes are in Mailtrap, not real email |

---

## 7. Costs

I cannot see your bills. Treat this as a checklist, and confirm current prices on each service's pricing page.

### Services you pay for
| Item | Cost status |
|---|---|
| Circle developer account and API key | Created during the build; no charge was visible to me. Check Circle's pricing before mainnet |
| Testnet USDC and gas | Free test funds from the faucet; no real value |
| Mailtrap Email Sandbox | Free tier used for testing |
| Mailtrap live sending | Your screen showed the plan includes 4,000 emails. Higher volume or a different plan is paid; check Mailtrap pricing |
| Domain name | Not bought yet. Typically around $10 to $15 per year at common registrars; confirm at checkout |
| Google sign-in (Google Cloud Console) | Creating a sign-in Client ID has no charge to my knowledge; confirm in Google Cloud billing |
| Vercel | Used your connected account; plan terms apply |
| Hugging Face | Not yet deployed. The Space also has a free tier, with limits |

### Future costs not yet incurred
- Independent smart-contract audit before real money.
- Legal review (sanctions, anti-money-laundering, privacy) for mainnet.
- A real ID-verification provider (Smile ID, Sumsub or Persona), which charges per check.
- A permanent hosted database (a managed Postgres service).
- Mainnet gas, paid in USDC.

### Arc Studio itself
The cost of running Arc Studio is internal and not something I can share. Your own plan, limits and remaining allowance are on your Arc Studio account page.

---

## 8. Open items and risks

### Still to do
1. Use a real sending domain for email (section 4).
2. Add the Google Client ID and enable Google sign-in. Google will most likely work only on a standalone page, not inside the Preview panel.
3. Connect Hugging Face and publish the full app; add `CIRCLE_API_KEY` there by hand.
4. Deploy the escrow contract and set `VITE_ESCROW_ADDRESS`.
5. Move to a permanent database. The default one resets whenever the Space restarts.
6. Move the services directory (reviews, bookings, messages, ID status, admin) from the visitor's browser to the server, so it is shared and protected.
7. Add a real ID-verification provider.
8. Rename the app if wanted.

### Known risks
- Wallets are non-custodial. A user who loses their email or PIN loses their funds.
- Direct payments cannot be reversed; only escrow protects buyers.
- The services directory is a demo until step 6 is done.
- Orders are reported by the buyer's app and not yet checked on the server.
- No professional audit has been done on the app or the contract.
- Testnet only. Mainnet needs an independent review and your own deployment.
