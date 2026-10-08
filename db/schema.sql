-- Mini HIS + LIS Outlab
-- Flow: Patient -> Visit -> LabOrder -> Specimen (accession) -> Shipment (to outlab) -> Result -> Verify

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  role     TEXT NOT NULL CHECK (role IN ('CLERK','DOCTOR','LAB','ADMIN')),
  can_approve_config INTEGER NOT NULL DEFAULT 0  -- permission, not a role: e.g. the pathologist (also LAB)
);

-- running numbers (HN, VN, accession, shipment); incremented atomically
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id         INTEGER PRIMARY KEY,
  hn         TEXT NOT NULL UNIQUE,
  cid        TEXT NOT NULL UNIQUE,          -- Thai national ID, checksum validated in app
  prefix     TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  dob        TEXT NOT NULL,
  sex        TEXT NOT NULL CHECK (sex IN ('M','F')),
  phone      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(first_name, last_name);

CREATE TABLE IF NOT EXISTS visits (
  id         INTEGER PRIMARY KEY,
  vn         TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  scheme     TEXT NOT NULL CHECK (scheme IN ('UC','SSS','CSMBS','SELF')), -- บัตรทอง/ประกันสังคม/ข้าราชการ/ชำระเอง
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS outlabs (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- test catalog; outlab_id NULL = in-house
-- ref_*/crit_* here are only the legacy default: reference ranges live in test_ranges (versioned, approved)
CREATE TABLE IF NOT EXISTS lab_tests (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  loinc         TEXT,
  specimen_type TEXT NOT NULL,
  container     TEXT NOT NULL,
  unit          TEXT,
  ref_low       REAL,
  ref_high      REAL,
  crit_low      REAL,
  crit_high     REAL,
  price         REAL NOT NULL,              -- charged to patient
  outlab_id     INTEGER REFERENCES outlabs(id),
  outlab_code   TEXT,                       -- test code at the outlab (mapping)
  outlab_cost   REAL,                       -- what the outlab bills us
  tat_days      INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1  -- a new test stays 0 until its first range is approved
);

CREATE TABLE IF NOT EXISTS lab_orders (
  id         INTEGER PRIMARY KEY,
  visit_id   INTEGER NOT NULL REFERENCES visits(id),
  ordered_by INTEGER NOT NULL REFERENCES users(id),
  priority   TEXT NOT NULL DEFAULT 'ROUTINE' CHECK (priority IN ('ROUTINE','STAT')),
  note       TEXT,
  ordered_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- one tube; one accession barcode; goes to at most one shipment
CREATE TABLE IF NOT EXISTS specimens (
  id            INTEGER PRIMARY KEY,
  accession_no  TEXT NOT NULL UNIQUE,
  order_id      INTEGER NOT NULL REFERENCES lab_orders(id),
  specimen_type TEXT NOT NULL,
  container     TEXT NOT NULL,
  collected_by  INTEGER REFERENCES users(id),
  collected_at  TEXT,
  received_by   INTEGER REFERENCES users(id),  -- received into lab
  received_at   TEXT,
  shipment_id   INTEGER REFERENCES shipments(id),
  reject_reason TEXT
);

-- manifest of specimens sent to one outlab
CREATE TABLE IF NOT EXISTS shipments (
  id          INTEGER PRIMARY KEY,
  shipment_no TEXT NOT NULL UNIQUE,
  outlab_id   INTEGER NOT NULL REFERENCES outlabs(id),
  status      TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','RECEIVED')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sent_at     TEXT,
  received_at TEXT
);

-- one row per test; status drives every worklist
CREATE TABLE IF NOT EXISTS lab_order_items (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES lab_orders(id),
  test_id     INTEGER NOT NULL REFERENCES lab_tests(id),
  specimen_id INTEGER REFERENCES specimens(id),
  status      TEXT NOT NULL DEFAULT 'ORDERED'
              CHECK (status IN ('ORDERED','COLLECTED','RECEIVED','SENT','RESULTED','VERIFIED','REJECTED','CANCELLED')),
  value       TEXT,
  flag        TEXT CHECK (flag IN ('LL','L','N','H','HH')),
  resulted_by INTEGER REFERENCES users(id),  -- verifier must differ (four-eyes); NULL = came from outlab HL7
  resulted_at TEXT,
  message_id  INTEGER REFERENCES inbound_messages(id), -- which HL7 message delivered it
  -- range used when the result was flagged; reports keep showing it even after the range is revised
  ref_low     REAL,
  ref_high    REAL,
  crit_low    REAL,
  crit_high   REAL,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_status ON lab_order_items(status);

-- result changed after verify: keep the old value
CREATE TABLE IF NOT EXISTS result_amendments (
  id        INTEGER PRIMARY KEY,
  item_id   INTEGER NOT NULL REFERENCES lab_order_items(id),
  old_value TEXT,
  new_value TEXT NOT NULL,
  reason    TEXT NOT NULL,
  by_user   INTEGER NOT NULL REFERENCES users(id),
  at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- critical value (LL/HH) must be reported to someone, logged
CREATE TABLE IF NOT EXISTS critical_notifications (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES lab_order_items(id),
  notified_to TEXT NOT NULL,
  method      TEXT NOT NULL,
  by_user     INTEGER NOT NULL REFERENCES users(id),
  at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- raw HL7 from outlabs; control_id UNIQUE makes re-import idempotent
CREATE TABLE IF NOT EXISTS inbound_messages (
  id         INTEGER PRIMARY KEY,
  control_id TEXT NOT NULL UNIQUE,
  raw        TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('OK','ERROR')),
  error      TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  detail    TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- UAT: testers record pass/fail per test case from /guide (latest row per case+tester wins)
CREATE TABLE IF NOT EXISTS uat_results (
  id      INTEGER PRIMARY KEY,
  case_id TEXT NOT NULL,                -- e.g. UAT-LAB-03, defined in src/lib/guide.ts
  user_id INTEGER NOT NULL REFERENCES users(id),
  status  TEXT NOT NULL CHECK (status IN ('PASS','FAIL','BLOCKED')),
  note    TEXT,
  at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Reference / critical ranges, versioned. Proposed by lab staff, approved by someone else with can_approve_config.
-- Resolution (src/lib/rules.ts pickRange): APPROVED rows matching the patient's sex/age, effective now,
-- most specific scope first, then latest effective_from. Old versions are kept, never edited.
CREATE TABLE IF NOT EXISTS test_ranges (
  id             INTEGER PRIMARY KEY,
  test_id        INTEGER NOT NULL REFERENCES lab_tests(id),
  sex            TEXT CHECK (sex IN ('M','F')),     -- NULL = any
  age_min        INTEGER,                           -- years, inclusive; NULL = no lower bound
  age_max        INTEGER,                           -- years, inclusive; NULL = no upper bound
  ref_low        REAL,
  ref_high       REAL,
  crit_low       REAL,
  crit_high      REAL,
  effective_from TEXT NOT NULL,                     -- YYYY-MM-DD
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reason         TEXT NOT NULL,                     -- why: guideline, new reagent lot, analyzer change ...
  proposed_by    INTEGER REFERENCES users(id),
  proposed_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reviewed_by    INTEGER REFERENCES users(id),
  reviewed_at    TEXT,
  review_note    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ranges_test ON test_ranges(test_id, status);
