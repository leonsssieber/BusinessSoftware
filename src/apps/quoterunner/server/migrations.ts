import type { Migration } from "@core/server/db";

export const quoteRunnerMigrations: Migration[] = [
  {
    version: 1,
    name: "suppliers, requests, quotes, purchase orders, price history",
    sql: `
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  categories TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX suppliers_org ON suppliers(org_id, archived);

CREATE TABLE rfqs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  job_name TEXT,
  site_address TEXT,
  need_by TEXT,
  due_at TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  awarded_at TEXT,
  UNIQUE (org_id, number)
);
CREATE INDEX rfqs_org_status ON rfqs(org_id, status, created_at);

CREATE TABLE rfq_items (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ea',
  part_number TEXT,
  notes TEXT,
  allow_substitutes INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX rfq_items_rfq ON rfq_items(rfq_id, position);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  viewed_at TEXT,
  responded_at TEXT,
  last_reminded_at TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  decline_reason TEXT,
  UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  freight REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  valid_until TEXT,
  notes TEXT,
  contact_name TEXT,
  reference TEXT,
  received_at TEXT NOT NULL,
  raw_text TEXT,
  UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE quote_lines (
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  unit_price REAL,
  lead_days INTEGER,
  substitute TEXT,
  note TEXT,
  PRIMARY KEY (quote_id, item_id)
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal REAL NOT NULL,
  freight REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (org_id, number)
);
CREATE INDEX purchase_orders_org ON purchase_orders(org_id, created_at);

CREATE TABLE po_lines (
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT NOT NULL,
  unit_price REAL NOT NULL,
  substitute TEXT,
  PRIMARY KEY (po_id, item_id)
);

CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price REAL NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  rfq_id TEXT REFERENCES rfqs(id) ON DELETE SET NULL,
  awarded INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL
);
CREATE INDEX price_history_key ON price_history(org_id, item_key, observed_at);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rfq_id TEXT REFERENCES rfqs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX activity_org ON activity(org_id, created_at);
CREATE INDEX activity_rfq ON activity(rfq_id, created_at);
`,
  },
];
