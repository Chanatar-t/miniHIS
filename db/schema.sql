-- Mini HIS + LIS Outlab
-- Flow: Patient -> Visit -> LabOrder -> Specimen (accession) -> Shipment (to outlab) -> Result -> Verify

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id       INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  role     TEXT NOT NULL CHECK (role IN ('CLERK','DOCTOR','LAB','ADMIN'))
);

-- running numbers (HN, VN, accession, shipment); incremented atomically
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE patients (
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
CREATE INDEX idx_patients_name ON patients(first_name, last_name);

CREATE TABLE visits (
  id         INTEGER PRIMARY KEY,
  vn         TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  scheme     TEXT NOT NULL CHECK (scheme IN ('UC','SSS','CSMBS','SELF')), -- บัตรทอง/ประกันสังคม/ข้าราชการ/ชำระเอง
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE outlabs (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- test catalog; outlab_id NULL = in-house
CREATE TABLE lab_tests (
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
  tat_days      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE lab_orders (
  id         INTEGER PRIMARY KEY,
  visit_id   INTEGER NOT NULL REFERENCES visits(id),
  ordered_by INTEGER NOT NULL REFERENCES users(id),
  priority   TEXT NOT NULL DEFAULT 'ROUTINE' CHECK (priority IN ('ROUTINE','STAT')),
  note       TEXT,
  ordered_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- one tube; one accession barcode; goes to at most one shipment
CREATE TABLE specimens (
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
CREATE TABLE shipments (
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
CREATE TABLE lab_order_items (
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
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT
);
CREATE INDEX idx_items_status ON lab_order_items(status);

-- result changed after verify: keep the old value
CREATE TABLE result_amendments (
  id        INTEGER PRIMARY KEY,
  item_id   INTEGER NOT NULL REFERENCES lab_order_items(id),
  old_value TEXT,
  new_value TEXT NOT NULL,
  reason    TEXT NOT NULL,
  by_user   INTEGER NOT NULL REFERENCES users(id),
  at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- critical value (LL/HH) must be reported to someone, logged
CREATE TABLE critical_notifications (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES lab_order_items(id),
  notified_to TEXT NOT NULL,
  method      TEXT NOT NULL,
  by_user     INTEGER NOT NULL REFERENCES users(id),
  at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- raw HL7 from outlabs; control_id UNIQUE makes re-import idempotent
CREATE TABLE inbound_messages (
  id         INTEGER PRIMARY KEY,
  control_id TEXT NOT NULL UNIQUE,
  raw        TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('OK','ERROR')),
  error      TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  detail    TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
