# Handoff: UBQ Global Marketplace

Read this first when continuing the project in a new chat. It holds the current state, what is pending, and how the owner likes to work. It contains no secrets.

## How to work with the owner

- The owner is a complete beginner and works mostly from a phone. Give one short numbered step list at a time and ask what the screen shows.
- Never ask the owner to paste secrets (API keys, database address, app passwords, private keys) in chat. Secrets go only into `.env` in the Code panel and into Vercel's Environment Variables. Public values (Circle App ID, Google client ID, wallet address) are fine to share.
- Default network is Arc Testnet. Mainnet work needs the standard mainnet warning first.
- Describe outcomes, not internals. No em dashes. Write "onchain".
- Screenshots of Vercel, Neon, Circle or Google screens often arrive. Read them carefully and point at the exact button.

## What the app is

A global marketplace where anyone can sell goods and services, pay in USDC on Arc Testnet, and sign in with email, Google or a wallet.

- Frontend: React, Vite, TypeScript, Tailwind, wagmi, viem.
- Server: Hono (`server/app.ts`), Postgres on Neon, Circle user-controlled wallets.
- Server entry points: `server/index.ts` (Bun, local), `server/vercel-entry.ts` bundled into `api/index.js` (Vercel). After any change under `server/`, run `bun run build:api` and commit `api/index.js`.
- Trust layer in `server/sec/` with UI in `src/security/` (see README and AGENTS.md).
- Escrow contract `contracts/ServiceEscrow.sol` (62 unit tests passing). It is NOT deployed. It has had automated reviews only, no independent audit.

## Live setup

- Live site: https://ubq-global-marketplace.vercel.app
- GitHub repository: `YoungseriesIP/ubq-global-marketplace` (currently PUBLIC so Vercel's free plan accepts commits; switch back to private after linking the commit email in GitHub Settings, Emails).
- Deploy flow: push from Arc Studio (Integrations menu, GitHub) then in Vercel open the project, Deployments, three dots, Create Deployment, branch `main`, Deploy to Production.
- Arc Studio's own Vercel deploy tool cannot publish the server (static files only). Deploy through GitHub and Vercel.
- Database: Neon project "Ubq global marketplace", region AWS Europe West 2 (London). Vercel functions currently run in Washington DC; the owner can change Function Region to London in Vercel project settings.
- Circle App ID (public): `8cb057c5-7467-5c52-91d8-8f119de4aba3`. Circle is on Testnet.

## Environment variables (names only)

Set in `.env` (local) and in Vercel, Settings, Environment Variables (Production):

- `DATABASE_URL`: Neon pooled connection string. The password was reset once after it appeared in a screenshot.
- `CIRCLE_API_KEY`: server only.
- `VITE_CIRCLE_APP_ID`: public.
- `APP_ENCRYPTION_KEY`: 64 hex characters, encrypts staff authenticator secrets.
- `ADMIN_BOOTSTRAP_ADDRESSES`: first admin wallet address(es).
- `VITE_GOOGLE_CLIENT_ID`: NOT set yet (see below).
- Optional later: `ALCHEMY_API_KEY` (planned: steadier payment checks and payment alerts), `VITE_ESCROW_ADDRESS` (after escrow deploy).

## Done and verified

- Marketplace, services directory, country filter, local-currency display, multi-vendor shops, orders.
- Wallet sign-in works on the live site. Staff console works for the owner (admin role, authenticator set up).
- Security layer tested: 22 unit tests (`bun run test:unit`), 59 live checks (`bun run test:security`, uses throwaway data in the real database), and 11 checks against the live site.
- A scan found no secrets in the repository, the built files or the server bundle.

## Email sign-in status (unfinished)

- Circle Console, Wallets, User Controlled, Configurator, Email: SMTP is set to Gmail (`smtp.gmail.com`, port 587) using a dedicated marketplace Gmail account and a Google app password. The owner has this account; its address is in Circle's settings.
- "Send test email" works and reaches real inboxes, but the sample code is always `ABC-123456`.
- REAL sign-in codes never arrive. The marketplace Gmail Sent folder holds only sample emails. Circle's logs show `POST /v1/w3s/users/email/token` succeeding, and the Circle sign-in window opens and shows a code prefix, but no real email is sent.
- Earlier (with Mailtrap sandbox SMTP, tested from the Arc Studio preview) real codes did arrive. Untested idea: pass `email: { email }` in the SDK `loginConfigs` in `sendEmailCode` (`src/auth/AuthContext.tsx`), as Circle's tutorial does. The installed SDK types do not list that field.
- Next options: test with Mailtrap again to see if Gmail is the cause; check the bell icon in the Circle Console; contact Circle support. A ready message with request IDs `9e403b904c29fd335d3a88ca3f42dd3c` (2026-11-16 19:53:29 UTC) and `3400ac1e19ff5e73def9b299f4ed4f66` (19:43:17 UTC) was given to the owner.
- Real inbox email at scale will need a verified sending domain (Mailtrap sending or similar). The owner has no budget for a domain yet. Gmail SMTP is capped near 500 emails a day.

## In progress right now: Google sign-in

Goal: users tap Continue with Google, no emailed code.

1. Google Cloud: create project, Google Auth Platform, OAuth client (Web application), authorized redirect URI `https://ubq-global-marketplace.vercel.app`, then Audience, Publish app. Copy the Client ID.
2. Circle Console: Wallets, User Controlled, Configurator, Authentication Methods, Social Logins, Google: paste Client ID (Web).
3. Vercel: add `VITE_GOOGLE_CLIENT_ID` (Production), redeploy. The server serves it from `/api/config`, so no code change is needed.
4. Test on the live site (Google sign-in will not work inside the Arc Studio preview frame).

The owner had been told these steps and had not yet reported finishing step 1.

## Still to do

- Finish Google sign-in (above) and resolve real email codes.
- Link the commit email to GitHub, then make the repository private again.
- Deploy the escrow contract (testnet) and set `VITE_ESCROW_ADDRESS`.
- Alchemy key for payment verification and payment alerts.
- Not built, needs provider accounts and legal review: KYC and KYB, sanctions and wallet screening, real-inbox alerts, independent contract audit, penetration test.
- Services directory data (reviews, bookings, messages, KYC badges, admin panel) still lives in each visitor's browser; moving it to the server is a larger change.
- Mainnet needs an independent audit, legal review, and the owner deploying from their own wallet.

## Prompt to paste into the new chat

> Continue my project, UBQ Global Marketplace. First read `docs/handoff.md`, `AGENTS.md` and `README.md` in the project. I am a beginner working from my phone, so guide me one short step at a time. We were in the middle of turning on Google sign-in and fixing real email sign-in codes. Do not ask me to paste secrets in chat.


## Update: own email-code sign-in (built after the notes above)

Circle's own email-code step never delivered real codes through Gmail (test emails worked, real codes did not), so sign-in by email now runs on this server:

- `POST /api/email/request` emails a 6-digit code through Gmail SMTP (nodemailer). Only a keyed hash is stored (`email_otps`), codes last 10 minutes, 5 wrong tries lock a code, and each address gets at most 5 codes an hour.
- `POST /api/email/verify` checks the code, then creates a pseudonymous Circle PIN user (`e_` plus a hash of the email) and returns a Circle user token. The existing wallet setup then runs unchanged (the user sets a PIN once).
- `/api/config` reports `emailLogin: "own"` when `SMTP_USER`, `SMTP_PASS` and `APP_ENCRYPTION_KEY` are set; otherwise the old Circle email-code path is used.
- Tests: `bun run test:unit` (26) and `bun run test:email` (14, real database and Circle test environment, dev-mail mode). The real Gmail send is only proven by a live test on the deployed site.
- Vercel settings added: `SMTP_USER`, `SMTP_PASS` (secret), `VITE_GOOGLE_CLIENT_ID` (config). Google app is published; Privacy and Terms pages live at /privacy and /terms.

## Update: sold items, editing and photo upload

- Listing states: active, review (held), reserved (a payment is awaiting confirmation), sold, removed. `settleOrder` moves the listing; schema v5 also marks already-paid items sold.
- `PATCH /api/listings/:id` edits price, wording, category, place and photo until a payment exists. New wording is re-checked for prohibited terms. `GET /api/listings/mine` returns the seller's own listings in every state.
- Photos: the browser shrinks them, `POST /api/uploads/image` checks the real file type (JPEG, PNG or WebP, max 700 KB) and stores them in the database; `GET /api/images/:id` serves them with a locked-down policy.
- Tests: `bun run test:unit` (29), `bun run test:listings` (24).
