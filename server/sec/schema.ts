// Security, trust and compliance tables. Every statement is idempotent (safe to run on every cold start).

export const SEC_SCHEMA: string[] = [
  // ── Session metadata (device recognition, session list, step-up) ────────
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at DOUBLE PRECISION',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen DOUBLE PRECISION',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_hash TEXT',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS elevated_until DOUBLE PRECISION',

  // ── Orders become verified payment records ──────────────────────────────
  "ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unverified'",
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at DOUBLE PRECISION',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS verify_note TEXT',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_score INTEGER',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at DOUBLE PRECISION',
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tx_verified ON orders(tx_hash) WHERE status = 'verified'",
  'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at)',

  // ── Staff, roles and staff authentication ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS staff_roles (
    address    TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('support','compliance','finance','admin')),
    granted_by TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS staff_totp (
    address    TEXT PRIMARY KEY,
    secret_enc TEXT NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 0,
    created_at DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_requests (
    id           TEXT PRIMARY KEY,
    action       TEXT NOT NULL,
    payload      TEXT NOT NULL,
    reason       TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    approved_by  TEXT,
    created_at   DOUBLE PRECISION NOT NULL,
    resolved_at  DOUBLE PRECISION
  )`,

  // ── Append-only, hash-chained audit log ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS audit_log (
    id        BIGSERIAL PRIMARY KEY,
    at        DOUBLE PRECISION NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    target    TEXT NOT NULL DEFAULT '',
    details   TEXT NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL UNIQUE,
    hash      TEXT NOT NULL
  )`,
  `CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'audit_log is append-only'; END;
   $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log',
  `CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
   FOR EACH ROW EXECUTE FUNCTION audit_log_immutable()`,
  'DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log',
  `CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
   FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable()`,

  // ── Security events, devices, config ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS security_events (
    id       BIGSERIAL PRIMARY KEY,
    at       DOUBLE PRECISION NOT NULL,
    address  TEXT,
    kind     TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    details  TEXT NOT NULL DEFAULT '{}',
    ip_hash  TEXT,
    seen     INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_events_address ON security_events(address, at)',
  'CREATE INDEX IF NOT EXISTS idx_events_kind ON security_events(kind, at)',
  `CREATE TABLE IF NOT EXISTS user_devices (
    address     TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    first_seen  DOUBLE PRECISION NOT NULL,
    last_seen   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (address, device_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS security_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS risk_assessments (
    id       BIGSERIAL PRIMARY KEY,
    at       DOUBLE PRECISION NOT NULL,
    address  TEXT NOT NULL,
    action   TEXT NOT NULL,
    score    INTEGER NOT NULL,
    decision TEXT NOT NULL,
    reasons  TEXT NOT NULL DEFAULT '[]'
  )`,
  'CREATE INDEX IF NOT EXISTS idx_risk_address ON risk_assessments(address, at)',

  // ── Cases, restrictions, appeals, incidents, reports ────────────────────
  `CREATE TABLE IF NOT EXISTS cases (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    severity   TEXT NOT NULL DEFAULT 'medium',
    subject    TEXT,
    title      TEXT NOT NULL,
    summary    TEXT NOT NULL DEFAULT '',
    assignee   TEXT,
    created_by TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL,
    closed_at  DOUBLE PRECISION,
    resolution TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_cases_subject ON cases(subject)',
  `CREATE TABLE IF NOT EXISTS case_notes (
    id      BIGSERIAL PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    author  TEXT NOT NULL,
    kind    TEXT NOT NULL DEFAULT 'note',
    body    TEXT NOT NULL,
    at      DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS restrictions (
    id         TEXT PRIMARY KEY,
    address    TEXT NOT NULL,
    scope      TEXT NOT NULL CHECK (scope IN ('sell','buy','all')),
    reason     TEXT NOT NULL,
    case_id    TEXT,
    created_by TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    expires_at DOUBLE PRECISION,
    lifted_at  DOUBLE PRECISION,
    lifted_by  TEXT,
    auto       INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_restrictions_address ON restrictions(address)',
  `CREATE TABLE IF NOT EXISTS appeals (
    id             TEXT PRIMARY KEY,
    address        TEXT NOT NULL,
    restriction_id TEXT NOT NULL,
    message        TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open',
    reviewed_by    TEXT,
    decision_note  TEXT,
    created_at     DOUBLE PRECISION NOT NULL,
    resolved_at    DOUBLE PRECISION
  )`,
  `CREATE TABLE IF NOT EXISTS incidents (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'medium',
    status      TEXT NOT NULL DEFAULT 'open',
    description TEXT NOT NULL DEFAULT '',
    created_by  TEXT NOT NULL,
    created_at  DOUBLE PRECISION NOT NULL,
    resolved_at DOUBLE PRECISION
  )`,
  `CREATE TABLE IF NOT EXISTS incident_notes (
    id          BIGSERIAL PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    author      TEXT NOT NULL,
    body        TEXT NOT NULL,
    at          DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id         TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    reporter   TEXT NOT NULL,
    kind       TEXT NOT NULL,
    details    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'open',
    case_id    TEXT,
    created_at DOUBLE PRECISION NOT NULL,
    UNIQUE (listing_id, reporter, kind)
  )`,

  // ── Verification records (filled by a KYC/KYB provider integration; references only, never documents) ──
  `CREATE TABLE IF NOT EXISTS verifications (
    address    TEXT PRIMARY KEY,
    level      INTEGER NOT NULL DEFAULT 1,
    provider   TEXT NOT NULL,
    reference  TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    updated_at DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS consents (
    address TEXT NOT NULL,
    kind    TEXT NOT NULL,
    version TEXT NOT NULL,
    at      DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (address, kind, version)
  )`,
]
