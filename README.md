# TradePort

A global marketplace where anyone can sign in with an email, open a shop, list products or services, and get paid in USDC. Prices show in the buyer's local currency, and buyers can find goods and services near them. Built on Arc Testnet.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Sign in with email or Google (a secure wallet is created automatically) or bring your own wallet
- Open shop: any signed-in person or business can list items and manage orders
- Local-currency prices with live exchange rates, paid as USDC
- Country-aware browsing for goods and for local services (providers, reviews, bookings, messaging)
- Optional escrow for service payments

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit, Hono API (Bun locally, Vercel functions in production), Neon Postgres, Circle user-controlled wallets, Solidity (Foundry) for escrow.

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
bun run server   # API on port 3001 (keep running)
bun run dev      # web app on port 5173, proxies /api to the API
```

Build and serve everything from one process:

```bash
bun run build
bun run start
```

Publish to Vercel from a Git repository: push the project to GitHub, import it in Vercel (framework: Vite), and set `DATABASE_URL`, `CIRCLE_API_KEY` and `VITE_CIRCLE_APP_ID` as environment variables. The API ships as the prebuilt `api/index.js`; after changing anything in `server/`, run `bun run build:api` and commit the result.

Other commands: `bun run check` (lint and typecheck), `bun run contracts:build`, `bun run contracts:test`.

## Environment variables

Set these in `.env`. Never commit it.

- `CIRCLE_API_KEY`: Circle API key used by the server to create wallets. Keep it server-side only.
- `VITE_CIRCLE_APP_ID`: Circle app ID for the sign-in window (public).
- `VITE_GOOGLE_CLIENT_ID`: Google OAuth client ID to enable "Continue with Google" (optional, public).
- `VITE_ESCROW_ADDRESS`: deployed escrow contract address to enable escrow payments (optional, public).
- `VITE_DEFAULT_CHAIN_ID`: chain used for payments, defaults to Arc Testnet (optional).
- `DATABASE_URL`: Postgres connection string (Neon). Required. Keep it secret and server-side only.
- `VITE_ADMIN_ADDRESSES`: comma-separated wallet addresses that see the admin button. Empty by default (optional, public).
- `PORT`: API port, defaults to 3001 (optional).
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio (optional outside Arc Studio).

Circle Console setup for email and Google sign-in: configure email (SMTP) and the Google client ID under Wallets, User Controlled, Configurator.

## Security notes

- The Circle API key stays on the server. It is never sent to the browser, logged, or written into the built app.
- Only a hash of each sign-in session is stored. Email addresses are not stored at all, and public names are never taken from an email.
- Secrets (tokens, keys, signatures) are removed from the in-app request traces.
- Image links do not send a referrer. Country is guessed from browser language settings, so no visitor address is sent to a third party.
- The services directory (reviews, bookings, messages, ID checks, admin panel) is still stored in each visitor's own browser and is a demo, not a protected system.
