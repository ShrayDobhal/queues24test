<?php
/**
 * Health module schema. Versioned, additive migrations (never drops data).
 * Money is stored as whole rupees (INTEGER). Timestamps are ISO-8601 UTC text.
 */
declare(strict_types=1);

namespace Q24H;

use PDO;

const SCHEMA_VERSION = 2;

function migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    $v = $pdo->query("SELECT value FROM meta WHERE key = 'schema_version'")->fetchColumn();
    $v = $v === false ? 0 : (int) json_decode((string) $v);
    if ($v >= SCHEMA_VERSION) return;

    $pdo->exec('BEGIN IMMEDIATE');
    try {
        // re-check inside the lock (two first requests at once)
        $v2 = $pdo->query("SELECT value FROM meta WHERE key = 'schema_version'")->fetchColumn();
        if ($v2 !== false && (int) json_decode((string) $v2) >= SCHEMA_VERSION) { $pdo->exec('COMMIT'); return; }

        if ($v < 1) {
            $pdo->exec(<<<'SQL'
CREATE TABLE areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('metro','state')),
  cities TEXT NOT NULL DEFAULT '[]'          -- metro: JSON [{"name":..,"state":..}]
);
CREATE INDEX areas_state ON areas(state, kind);

CREATE TABLE partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  city TEXT, state TEXT, address TEXT,
  password_hash TEXT NOT NULL,
  password_enc TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- which partner serves which area, in which role (metro: primary+backup, state: primary)
CREATE TABLE coverage (
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('primary','backup')),
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  PRIMARY KEY (area_id, role)
);
CREATE INDEX coverage_partner ON coverage(partner_id);

CREATE TABLE tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('test','package')),
  category TEXT NOT NULL,
  description TEXT,
  sample_type TEXT NOT NULL DEFAULT 'Blood',
  fasting_hours INTEGER NOT NULL DEFAULT 0,
  tat_hours INTEGER NOT NULL DEFAULT 24,
  parameters INTEGER NOT NULL DEFAULT 1,
  includes TEXT NOT NULL DEFAULT '[]',       -- package: JSON list of test codes
  price INTEGER NOT NULL,
  mrp INTEGER NOT NULL,
  popular INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100
);
CREATE INDEX tests_active ON tests(active, kind, sort);

CREATE TABLE patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('tests','prescription')),
  status TEXT NOT NULL,
  area_id INTEGER NOT NULL REFERENCES areas(id),
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT,
  address TEXT,
  member_name TEXT, member_age INTEGER, member_gender TEXT,
  contact_phone TEXT NOT NULL,
  slot_date TEXT, slot_window TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'pay_at_collection',
  partner_id INTEGER REFERENCES partners(id),
  partner_role TEXT,
  client_ref TEXT,                              -- idempotency key from the device
  note TEXT,
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (patient_id, client_ref)
);
CREATE INDEX orders_partner ON orders(partner_id, status, updated_at);
CREATE INDEX orders_patient ON orders(patient_id, created_at);
CREATE INDEX orders_status ON orders(status, updated_at);
CREATE INDEX orders_area ON orders(area_id, created_at);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  test_id INTEGER REFERENCES tests(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  mrp INTEGER NOT NULL
);
CREATE INDEX order_items_order ON order_items(order_id);

-- every offer of an order to a partner (primary → backup failover history)
CREATE TABLE assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('offered','accepted','rejected','expired','revoked')),
  reason TEXT,
  offered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at INTEGER,
  responded_at TEXT
);
CREATE INDEX assignments_order ON assignments(order_id);
CREATE INDEX assignments_open ON assignments(status, expires_at);

-- audit timeline shown to patient, partner and admin
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  from_status TEXT, to_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX events_order ON events(order_id, id);

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('prescription','report','chat')),
  uploader_type TEXT NOT NULL,
  uploader_id INTEGER,
  storage TEXT NOT NULL,
  key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX files_order ON files(order_id, purpose);

-- one conversation per order (patient ↔ lab ↔ admin)
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('patient','partner','admin','system')),
  sender_id INTEGER,
  sender_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('text','file','quote','system')),
  body TEXT,
  file_ids TEXT NOT NULL DEFAULT '[]',
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX messages_order ON messages(order_id, id);

-- read pointer per party → unread counts without scanning
CREATE TABLE reads (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  party TEXT NOT NULL CHECK (party IN ('patient','partner','admin')),
  last_message_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, party)
);

CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
SQL);
            require_once __DIR__ . '/seed.php';
            seed_all($pdo);
        }
        if ($v < 2) {
            // v2: exact GPS spot of the patient (optional) so the collection team can navigate there
            $pdo->exec('ALTER TABLE orders ADD COLUMN geo_lat REAL');
            $pdo->exec('ALTER TABLE orders ADD COLUMN geo_lng REAL');
            $pdo->exec('ALTER TABLE orders ADD COLUMN geo_accuracy INTEGER');
        }
        $pdo->prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")->execute([json_encode(SCHEMA_VERSION)]);
        $pdo->exec('COMMIT');
    } catch (\Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}
