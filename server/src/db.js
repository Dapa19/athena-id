import sqlite3 from 'sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { databasePath } from './config.js';

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS organization_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner_admin','manager','staff')),
  UNIQUE(user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(organization_id, name)
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  planned_budget INTEGER NOT NULL DEFAULT 0 CHECK(planned_budget >= 0),
  actual_spend INTEGER CHECK(actual_spend IS NULL OR actual_spend >= 0),
  status TEXT NOT NULL CHECK(status IN ('Draft','Active','Completed','Archived')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS campaign_branches (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY(campaign_id, branch_id)
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('New','Contacted','Booked','Attended','Purchased','Lost','No-show')),
  created_at TEXT NOT NULL,
  next_follow_up_at TEXT,
  whatsapp_authorized INTEGER NOT NULL DEFAULT 0 CHECK(whatsapp_authorized IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS lead_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  transaction_date TEXT NOT NULL,
  amount_idr INTEGER NOT NULL CHECK(amount_idr >= 0),
  status TEXT NOT NULL CHECK(status IN ('Paid','Refunded','Cancelled')),
  reference TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS transaction_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  record_type TEXT NOT NULL CHECK(record_type IN ('leads','transactions')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(organization_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_org_dates ON campaigns(organization_id, start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_campaign_branches_org ON campaign_branches(organization_id, branch_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(organization_id, status, archived_at);
CREATE INDEX IF NOT EXISTS idx_leads_org_date ON leads(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_org_branch ON leads(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_campaign ON leads(organization_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(organization_id, next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_activities_lead ON lead_activities(organization_id, lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_org_date ON transactions(organization_id, transaction_date, status);
CREATE INDEX IF NOT EXISTS idx_transactions_lead ON transactions(organization_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_transactions_campaign ON transactions(organization_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_transaction_activities ON transaction_activities(organization_id, transaction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`;

export function openDatabase(filePath = databasePath()) {
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new sqlite3.Database(filePath);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
  const exec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (error) => error ? reject(error) : resolve());
  });
  const close = () => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

  return {
    raw: db,
    run,
    get,
    all,
    exec,
    close,
    async initialize() {
      await exec('PRAGMA foreign_keys = ON;');
      await exec(schema);
      const leadColumns = await all('PRAGMA table_info(leads)');
      if (!leadColumns.some((column) => column.name === 'whatsapp_authorized')) {
        await exec('ALTER TABLE leads ADD COLUMN whatsapp_authorized INTEGER NOT NULL DEFAULT 0 CHECK(whatsapp_authorized IN (0, 1));');
      }
      await exec('PRAGMA user_version = 1;');
    },
    async transaction(callback) {
      await exec('BEGIN IMMEDIATE');
      try {
        const result = await callback({ run, get, all });
        await exec('COMMIT');
        return result;
      } catch (error) {
        await exec('ROLLBACK');
        throw error;
      }
    }
  };
}

