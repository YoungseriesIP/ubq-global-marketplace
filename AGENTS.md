# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```


---

## Accounts, shops and payments (added later)

- API: `server/app.ts` (Hono, shared), `server/index.ts` (Bun entry), `server/vercel-entry.ts` bundled to `api/index.js` (Vercel function; rebuild with `bun run build:api`). Data: Neon Postgres via `DATABASE_URL` (schema auto-created, demo listings seeded). Run `bun run server`; Vite proxies `/api` to port 3001. The Studio deploy tool cannot ship functions, so Vercel is deployed from a Git import with root `vercel.json`. Vercel needs env vars DATABASE_URL, CIRCLE_API_KEY, VITE_CIRCLE_APP_ID (+ optional VITE_GOOGLE_CLIENT_ID, VITE_ESCROW_ADDRESS); they are never uploaded by the deploy.
- Sign-in: email code or Google creates a Circle user-controlled wallet (EOA on Arc Testnet). Wallet users sign a one-time message. App sessions are opaque tokens in the `sessions` table.
- Frontend auth: `src/auth/AuthContext.tsx`. Payments for both account types go through `src/auth/payments.ts` (`useWalletActions`).
- Currency: prices are stored and settled in USDC. `src/lib/currency.tsx` only changes what is displayed (rates from `/api/fx`).
- Listings are shared across sellers via `/api/listings`. Demo listings (`is_demo`) cannot be bought.
- Circle Console must have email (SMTP) and the Google client ID configured for those sign-in methods.
- Escrow: `contracts/ServiceEscrow.sol` is audited and tested but not deployed. Set `VITE_ESCROW_ADDRESS` after deploying.
- Security: Sessions are stored hashed. No emails stored. `src/tracing.ts` redacts token/secret/signature fields. Never log request bodies. `VITE_ADMIN_ADDRESSES` controls the (client-only) admin button.
