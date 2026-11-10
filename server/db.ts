// Postgres store (Neon) for accounts, shops, listings, orders, sessions and rate limits.
// Uses Neon's HTTP driver, so it works the same in a long-running server and in serverless functions.
// Timestamps are milliseconds since the epoch, stored as DOUBLE PRECISION (exact up to 2^53).

import { neon } from '@neondatabase/serverless'
import { SEC_SCHEMA } from './sec/schema'

type Sql = ReturnType<typeof neon>
let sqlClient: Sql | null = null

function client(): Sql {
  if (sqlClient) return sqlClient
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  sqlClient = neon(url)
  return sqlClient
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    address          TEXT PRIMARY KEY,
    method           TEXT NOT NULL,
    email            TEXT,
    circle_wallet_id TEXT,
    display_name     TEXT NOT NULL DEFAULT '',
    shop_name        TEXT NOT NULL DEFAULT '',
    shop_bio         TEXT NOT NULL DEFAULT '',
    country_code     TEXT,
    is_demo          INTEGER NOT NULL DEFAULT 0,
    created_at       DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    address    TEXT NOT NULL REFERENCES users(address) ON DELETE CASCADE,
    expires_at DOUBLE PRECISION NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_address ON sessions(address)',
  `CREATE TABLE IF NOT EXISTS nonces (
    address    TEXT PRIMARY KEY,
    nonce      TEXT NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS listings (
    id           TEXT PRIMARY KEY,
    seller       TEXT NOT NULL REFERENCES users(address) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL,
    price_usdc   TEXT NOT NULL,
    category     TEXT NOT NULL,
    location     TEXT NOT NULL,
    country_code TEXT,
    chain        TEXT NOT NULL,
    chain_id     INTEGER NOT NULL,
    image_url    TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   DOUBLE PRECISION NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller)',
  'CREATE INDEX IF NOT EXISTS idx_listings_country ON listings(country_code, status)',
  `CREATE TABLE IF NOT EXISTS orders (
    id               TEXT PRIMARY KEY,
    listing_id       TEXT NOT NULL REFERENCES listings(id),
    buyer            TEXT NOT NULL,
    seller           TEXT NOT NULL,
    amount_usdc      TEXT NOT NULL,
    display_currency TEXT,
    display_amount   TEXT,
    tx_hash          TEXT,
    created_at       DOUBLE PRECISION NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller)',
  'CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer)',
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key      TEXT PRIMARY KEY,
    n        INTEGER NOT NULL,
    reset_at DOUBLE PRECISION NOT NULL
  )`,
]

export type Stmt = [text: string, params?: unknown[]]

async function rawQuery<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await client().query(text, params)) as unknown as T[]
}

/** Run several statements atomically in one round trip. */
export async function batch(stmts: Stmt[]): Promise<void> {
  const c = client()
  await c.transaction(stmts.map(([text, params]) => c.query(text, params ?? [])))
}

let readyPromise: Promise<void> | null = null

// Bump this whenever SCHEMA or SEC_SCHEMA changes. Cold starts then cost one cheap query instead of ~50.
const SCHEMA_VERSION = 2

async function init(): Promise<void> {
  const current = await rawQuery<{ value: string }>(
    "SELECT value FROM security_config WHERE key = 'schema_version'",
  ).catch(() => [] as Array<{ value: string }>)
  if (current[0]?.value === String(SCHEMA_VERSION)) return

  const stmts: Stmt[] = [
    ...SCHEMA.map((s): Stmt => [s]),
    ...SEC_SCHEMA.map((s): Stmt => [s]),
  ]
  // security_config is created by SEC_SCHEMA, so the version row goes in a second step.
  try {
    await batch(stmts)
  } catch {
    // Two cold starts can race on CREATE TABLE; one retry is enough because the statements are idempotent.
    await batch(stmts)
  }
  await seedIfEmpty()
  await rawQuery(
    `INSERT INTO security_config (key, value, updated_by, updated_at) VALUES ('schema_version', $1, 'system', $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [String(SCHEMA_VERSION), Date.now()],
  )
}

function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = init().catch((e: unknown) => {
      readyPromise = null
      throw e
    })
  }
  return readyPromise
}

/** All queries go through here so the schema exists before the first one runs. */
export async function q<T>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready()
  return rawQuery<T>(text, params)
}

export async function one<T>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows[0] ?? null
}

export async function exec(text: string, params: unknown[] = []): Promise<void> {
  await q(text, params)
}

export async function pruneExpired(): Promise<void> {
  const now = Date.now()
  await batch([
    ['DELETE FROM sessions WHERE expires_at < $1', [now]],
    ['DELETE FROM nonces WHERE expires_at < $1', [now]],
    ['DELETE FROM rate_limits WHERE reset_at < $1', [now]],
  ])
}

export interface UserRow {
  address: string
  method: 'circle' | 'wallet'
  email: string | null
  circle_wallet_id: string | null
  display_name: string
  shop_name: string
  shop_bio: string
  country_code: string | null
  is_demo: number
  created_at: number
}

export interface ListingRow {
  id: string
  seller: string
  title: string
  description: string
  price_usdc: string
  category: string
  location: string
  country_code: string | null
  chain: string
  chain_id: number
  image_url: string | null
  status: string
  created_at: number
}

export interface OrderRow {
  id: string
  listing_id: string
  buyer: string
  seller: string
  amount_usdc: string
  display_currency: string | null
  display_amount: string | null
  tx_hash: string | null
  created_at: number
  status: 'pending_payment' | 'unverified' | 'verified' | 'failed'
  verified_at: number | null
  verify_note: string | null
  risk_score: number | null
  expires_at: number | null
}

// ── Demo seed (only when the listings table is empty) ────────────────────
// Demo sellers get placeholder ids, flagged is_demo. Payments to them are blocked
// in the UI so nobody can send real funds to an address nobody controls.
function demoAddress(n: number): string {
  return '0x' + n.toString(16).padStart(40, '0')
}

const IMG = (id: string) => `https://images.unsplash.com/${id}?w=600&auto=format&fit=crop`

// [shop, title, description, price, category, location, country, image, hoursAgo]
type Seed = [string, string, string, string, string, string, string, string, number]

const SEED: Seed[] = [
  ['Lagos Tech Hub', 'Sony WH-1000XM5 Headphones, Excellent Condition', 'Barely used, bought 3 months ago. All original accessories and carry case included.', '220', 'Electronics', 'Lagos, Nigeria', 'NG', IMG('photo-1618366712010-f4ae9c647dcb'), 0.5],
  ['Kumasi Weavers', 'Handwoven Kente Cloth, Premium Quality', 'Authentic handwoven Kente from Kumasi. Bold gold and green pattern. 6 yards, never worn.', '85', 'Fashion', 'Accra, Ghana', 'GH', IMG('photo-1590736969955-71cc94901144'), 1.5],
  ['Atelier Paulista', 'Original Oil Painting, Abstract Cityscape', '50x70cm oil on canvas, signed. Ships worldwide with certificate of authenticity.', '350', 'Art', 'São Paulo, Brazil', 'BR', IMG('photo-1548438294-1ad5d5f4f063'), 5],
  ['Bosphorus Digital', 'MacBook Air M2 13", 512GB Space Gray', 'One year old, light scratches on bottom only. All original accessories included.', '920', 'Electronics', 'Istanbul, Turkey', 'TR', IMG('photo-1611186871348-b1ce696e52c9'), 12],
  ['Tokyo Kicks', 'Limited Edition Sneakers, Nike Air Max 270', 'Deadstock, unworn, size 10 US. Tokyo exclusive colorway with authentic receipt.', '180', 'Fashion', 'Tokyo, Japan', 'JP', IMG('photo-1542291026-7eec264c27ff'), 2],
  ['Mayfair Books', 'First Edition "Dune" by Frank Herbert, 1965', 'Rare first printing in very good condition. Stored in acid-free sleeve with provenance.', '1200', 'Books', 'London, UK', 'GB', IMG('photo-1512820790803-83ca734da794'), 24],
  ['Abuja Fabrics', 'Premium Ankara Fabric Set, 6 Yards', 'Vibrant 100% wax print Ankara. Double Dutch quality for outfits, decor and crafts.', '45', 'Fashion', 'Abuja, Nigeria', 'NG', IMG('photo-1590736969955-71cc94901144'), 3],
  ['Beijing Aerial', 'DJI Mini 4 Pro Drone, Barely Used', 'Flown fewer than 10 times. Extra battery and carrying case. 4K camera.', '680', 'Electronics', 'Beijing, China', 'CN', IMG('photo-1473968512647-3e447244af8f'), 8],
  ['Isfahan Rugs', 'Handmade Persian Rug, 150x240cm', 'Hand-knotted wool rug from Isfahan. 80 knots per square inch. Certificate of origin included.', '890', 'Home', 'Tehran, Iran', 'IR', IMG('photo-1616046229478-9901c5536a45'), 6],
  ['Brooklyn Games', 'PlayStation 5 Disc Edition Bundle', 'PS5 with 3 games, one controller and all cables. Barely used.', '520', 'Electronics', 'New York, USA', 'US', IMG('photo-1606813907291-d86efa9b94db'), 4],
  ['Berlin Horology', 'Homage Dive Watch, Sapphire Crystal', 'Ceramic bezel, 300m water resistance, sapphire glass. Comes with box.', '320', 'Collectibles', 'Berlin, Germany', 'DE', IMG('photo-1523275335684-37898b6baf30'), 9],
  ['Mumbai Woodcraft', 'Handcrafted Wooden Chess Set', 'Walnut and maple. Weighted pieces, felt base, storage compartment in board.', '95', 'Other', 'Mumbai, India', 'IN', IMG('photo-1585504198199-20277593b94f'), 11],
]

async function seedIfEmpty(): Promise<void> {
  const rows = await rawQuery<{ n: number }>('SELECT COUNT(*)::int AS n FROM listings')
  if ((rows[0]?.n ?? 0) > 0) return
  const now = Date.now()
  const chainId = Number(process.env.VITE_DEFAULT_CHAIN_ID ?? 5042002)
  const stmts: Stmt[] = []
  SEED.forEach(([shop, title, desc, price, cat, loc, cc, img, hrs], i) => {
    const seller = demoAddress(i + 1)
    stmts.push([
      `INSERT INTO users (address, method, display_name, shop_name, country_code, is_demo, created_at)
       VALUES ($1, 'wallet', $2, $2, $3, 1, $4) ON CONFLICT (address) DO NOTHING`,
      [seller, shop, cc, now],
    ])
    stmts.push([
      `INSERT INTO listings (id, seller, title, description, price_usdc, category, location, country_code, chain, chain_id, image_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Arc', $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
      [`seed-${i + 1}`, seller, title, desc, price, cat, loc, cc, chainId, img, now - Math.round(hrs * 3_600_000)],
    ])
  })
  await batch(stmts)
}
