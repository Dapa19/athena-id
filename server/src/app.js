import express from 'express';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { loginRoutes, requireAuth, requireRole, clearSessionCookie } from './auth.js';
import { summarizeMetrics } from './metrics.js';
import { parseCsv, stringifyCsv } from './csv.js';

const LEAD_STATUSES = ['New', 'Contacted', 'Booked', 'Attended', 'Purchased', 'Lost', 'No-show'];
const CAMPAIGN_STATUSES = ['Draft', 'Active', 'Completed', 'Archived'];
const TX_STATUSES = ['Paid', 'Refunded', 'Cancelled'];
const ROLE_ADMIN = ['owner_admin'];
const ROLE_MANAGERS = ['owner_admin', 'manager'];
const ROLE_OPERATORS = ['owner_admin', 'manager', 'staff'];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function requiredText(value, label, max = 120) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw httpError(400, 'VALIDATION_ERROR', `${label} is required and must be under ${max} characters.`);
  return text;
}

function optionalText(value, label, max = 500) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) throw httpError(400, 'VALIDATION_ERROR', `${label} must be under ${max} characters.`);
  return text;
}

function validTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const tz = value.trim();
  if (!Intl.supportedValuesOf) return tz;
  return Intl.supportedValuesOf('timeZone').includes(tz) ? tz : null;
}

function validateImageDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return null;
  const match = value.match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,/i);
  if (!match) return null;
  const data = value.slice(match[0].length);
  if (!data || data.length === 0 || data.length > 2_000_000) return null;
  return value;
}

function dateOnly(value, label, allowEmpty = false) {
  if (allowEmpty && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !datePattern.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw httpError(400, 'VALIDATION_ERROR', `${label} must be a valid date.`);
  }
  return value;
}

function integerMoney(value, label, allowEmpty = false) {
  if (allowEmpty && (value == null || value === '')) return null;
  if (value == null || value === '') throw httpError(400, 'VALIDATION_ERROR', `${label} must be a non-negative whole number of IDR.`);
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw httpError(400, 'VALIDATION_ERROR', `${label} must be a non-negative whole number of IDR.`);
  return number;
}

function optionalId(value, label) {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'VALIDATION_ERROR', `${label} is invalid.`);
  return id;
}

function singleQueryId(value, label) {
  if (value == null || value === '') return null;
  return optionalId(value, label);
}

async function ensureBranch(database, organizationId, branchId, required = false, includeArchived = false) {
  if (branchId == null) {
    if (required) throw httpError(400, 'VALIDATION_ERROR', 'Select a branch.');
    return null;
  }
  const branch = await database.get(
    `SELECT id FROM branches WHERE id = ? AND organization_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'}`,
    [branchId, organizationId]
  );
  if (!branch) throw httpError(400, 'VALIDATION_ERROR', 'Selected branch is unavailable.');
  return branch.id;
}

async function ensureCampaign(database, organizationId, campaignId, includeArchived = false) {
  if (campaignId == null) return null;
  const campaign = await database.get(
    `SELECT id FROM campaigns WHERE id = ? AND organization_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'}`,
    [campaignId, organizationId]
  );
  if (!campaign) throw httpError(400, 'VALIDATION_ERROR', 'Selected campaign is unavailable.');
  return campaign.id;
}

async function ensureCampaignBranch(database, organizationId, campaignId, branchId) {
  if (campaignId == null || branchId == null) return;
  const association = await database.get(
    'SELECT campaign_id FROM campaign_branches WHERE organization_id = ? AND campaign_id = ? AND branch_id = ?',
    [organizationId, campaignId, branchId]
  );
  if (!association) throw httpError(400, 'VALIDATION_ERROR', 'Selected campaign is not associated with this branch.');
}

async function ensureAssignee(database, organizationId, userId, includeInactive = false) {
  if (userId == null) return null;
  const user = await database.get(
    `SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id = u.id
     WHERE u.id = ? AND m.organization_id = ? ${includeInactive ? '' : 'AND u.is_active = 1'}`,
    [userId, organizationId]
  );
  if (!user) throw httpError(400, 'VALIDATION_ERROR', 'Selected team member is unavailable.');
  return user.id;
}

function normalizeCampaign(input) {
  const name = requiredText(input?.name, 'Campaign name', 120);
  const channel = requiredText(input?.channel, 'Channel', 80);
  const objective = optionalText(input?.objective, 'Objective', 180);
  const startDate = dateOnly(input?.startDate, 'Start date');
  const endDate = dateOnly(input?.endDate, 'End date');
  if (endDate < startDate) throw httpError(400, 'VALIDATION_ERROR', 'End date must be on or after start date.');
  const plannedBudget = integerMoney(input?.plannedBudget ?? 0, 'Planned budget');
  const actualSpend = integerMoney(input?.actualSpend, 'Actual spend', true);
  const status = CAMPAIGN_STATUSES.includes(input?.status) ? input.status : null;
  if (!status) throw httpError(400, 'VALIDATION_ERROR', 'Choose a valid campaign status.');
  const branchIds = Array.isArray(input?.branchIds) ? [...new Set(input.branchIds.map((id) => optionalId(id, 'Branch')))] : [];
  if (branchIds.length === 0) throw httpError(400, 'VALIDATION_ERROR', 'Select at least one branch.');
  return { name, channel, objective, startDate, endDate, plannedBudget, actualSpend, status, branchIds };
}

async function ensureCampaignBranches(database, organizationId, branchIds) {
  const placeholders = branchIds.map(() => '?').join(',');
  const branches = await database.all(
    `SELECT id FROM branches WHERE organization_id = ? AND archived_at IS NULL AND id IN (${placeholders})`,
    [organizationId, ...branchIds]
  );
  if (branches.length !== branchIds.length) throw httpError(400, 'VALIDATION_ERROR', 'One or more selected branches are unavailable.');
}

async function campaignRows(database, organizationId, id = null, includeArchived = false) {
  const rows = await database.all(
    `SELECT c.* FROM campaigns c
     WHERE c.organization_id = ? ${includeArchived ? '' : 'AND c.archived_at IS NULL'} ${id == null ? '' : 'AND c.id = ?'}
     ORDER BY c.start_date DESC, c.id DESC`,
    id == null ? [organizationId] : [organizationId, id]
  );
  if (!rows.length) return rows;
  const ids = rows.map((row) => row.id);
  const branches = await database.all(
    `SELECT cb.campaign_id, b.id, b.name, b.city, b.archived_at FROM campaign_branches cb
     JOIN branches b ON b.id = cb.branch_id AND b.organization_id = cb.organization_id
     WHERE cb.organization_id = ? AND cb.campaign_id IN (${ids.map(() => '?').join(',')})`,
    [organizationId, ...ids]
  );
  const grouped = new Map(rows.map((row) => [row.id, { ...row, branches: [], branchIds: [] }]));
  for (const branch of branches) {
    const campaign = grouped.get(branch.campaign_id);
    campaign.branches.push({ id: branch.id, name: branch.name, city: branch.city, archived: Boolean(branch.archived_at) });
    campaign.branchIds.push(branch.id);
  }
  return [...grouped.values()];
}

function normalizeLead(input) {
  const name = requiredText(input?.displayName, 'Lead name or reference', 120);
  const phone = optionalText(input?.phone, 'Contact number', 40);
  if (phone && !/^[+()0-9 .-]{5,40}$/.test(phone)) throw httpError(400, 'VALIDATION_ERROR', 'Contact number can contain digits, spaces, and + ( ) . - only.');
  const source = requiredText(input?.source || 'Manual', 'Source', 80);
  const status = LEAD_STATUSES.includes(input?.status) ? input.status : null;
  if (!status) throw httpError(400, 'VALIDATION_ERROR', 'Choose a valid lead status.');
  const createdDate = dateOnly(input?.createdDate || new Date().toISOString().slice(0, 10), 'Created date');
  const nextFollowUpDate = dateOnly(input?.nextFollowUpDate, 'Follow-up date', true);
  const notes = optionalText(input?.notes, 'Operational note', 500);
  const whatsappAuthorized = input?.whatsappAuthorized;
  if (whatsappAuthorized != null && ![true, false, 0, 1].includes(whatsappAuthorized)) throw httpError(400, 'VALIDATION_ERROR', 'WhatsApp authorization must be confirmed or left unchecked.');
  return {
    displayName: name, phone, source, status, createdDate, nextFollowUpDate, notes,
    whatsappAuthorized: whatsappAuthorized === true || whatsappAuthorized === 1,
    campaignId: optionalId(input?.campaignId, 'Campaign'),
    branchId: optionalId(input?.branchId, 'Branch'),
    assigneeUserId: optionalId(input?.assigneeUserId, 'Assignee')
  };
}

async function normalizeTransaction(input, database, organizationId, existing = null) {
  const transactionDate = dateOnly(input?.transactionDate, 'Transaction date');
  const amountIdr = integerMoney(input?.amountIdr, 'Amount');
  const status = TX_STATUSES.includes(input?.status) ? input.status : null;
  if (!status) throw httpError(400, 'VALIDATION_ERROR', 'Choose Paid, Refunded, or Cancelled.');
  const leadId = optionalId(input?.leadId, 'Lead');
  if (leadId != null && !await database.get(
    `SELECT id FROM leads WHERE id = ? AND organization_id = ? ${existing?.lead_id === leadId ? '' : 'AND archived_at IS NULL'}`,
    [leadId, organizationId]
  )) {
    throw httpError(400, 'VALIDATION_ERROR', 'Selected lead is unavailable.');
  }
  const requestedCampaignId = optionalId(input?.campaignId, 'Campaign');
  const campaignId = await ensureCampaign(database, organizationId, requestedCampaignId, existing?.campaign_id === requestedCampaignId);
  const requestedBranchId = optionalId(input?.branchId, 'Branch');
  const branchId = await ensureBranch(database, organizationId, requestedBranchId, true, existing?.branch_id === requestedBranchId);
  await ensureCampaignBranch(database, organizationId, campaignId, branchId);
  const reference = optionalText(input?.reference, 'Reference', 80);
  return { transactionDate, amountIdr, status, leadId, campaignId, branchId, reference };
}

function csvDownload(res, filename, records, columns) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${stringifyCsv(records, columns)}`);
}

function localToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function createApp({ database } = {}) {
  if (!database) throw new Error('createApp requires a database instance.');
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '1.2mb', strict: true }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  loginRoutes(app, database);
  app.use('/api', requireAuth(database));

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', async (req, res, next) => {
    try {
      await database.run('DELETE FROM sessions WHERE token_hash = ?', [req.sessionTokenHash]);
      clearSessionCookie(res);
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  app.get('/api/branches', async (req, res, next) => {
    try {
      const rows = await database.all(
        `SELECT b.id, b.name, b.city, b.created_at,
         (SELECT COUNT(*) FROM leads l WHERE l.organization_id = b.organization_id AND l.branch_id = b.id AND l.archived_at IS NULL) AS lead_count
         FROM branches b WHERE b.organization_id = ? AND b.archived_at IS NULL ORDER BY b.name`,
        [req.user.organizationId]
      );
      return res.json({ branches: rows });
    } catch (error) { return next(error); }
  });

  app.post('/api/branches', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const name = requiredText(req.body?.name, 'Branch name', 100);
      const city = optionalText(req.body?.city, 'City', 100);
      const result = await database.run('INSERT INTO branches (organization_id, name, city) VALUES (?, ?, ?)', [req.user.organizationId, name, city]);
      return res.status(201).json({ branch: await database.get('SELECT id, name, city, created_at FROM branches WHERE id = ? AND organization_id = ?', [result.lastID, req.user.organizationId]) });
    } catch (error) { return next(error); }
  });

  app.patch('/api/branches/:id', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Branch');
      const existing = await database.get('SELECT id FROM branches WHERE id = ? AND organization_id = ? AND archived_at IS NULL', [id, req.user.organizationId]);
      if (!existing) throw httpError(404, 'NOT_FOUND', 'Branch not found.');
      const name = requiredText(req.body?.name, 'Branch name', 100);
      const city = optionalText(req.body?.city, 'City', 100);
      await database.run('UPDATE branches SET name = ?, city = ? WHERE id = ? AND organization_id = ?', [name, city, id, req.user.organizationId]);
      return res.json({ branch: await database.get('SELECT id, name, city FROM branches WHERE id = ? AND organization_id = ?', [id, req.user.organizationId]) });
    } catch (error) { return next(error); }
  });

  app.delete('/api/branches/:id', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Branch');
      const result = await database.run('UPDATE branches SET archived_at = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL', [new Date().toISOString(), id, req.user.organizationId]);
      if (!result.changes) throw httpError(404, 'NOT_FOUND', 'Branch not found.');
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  app.get('/api/campaigns', async (req, res, next) => {
    try {
      const campaigns = await campaignRows(database, req.user.organizationId);
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80).toLowerCase() : '';
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const branchId = singleQueryId(req.query.branchId, 'Branch');
      return res.json({ campaigns: campaigns.filter((campaign) => (!q || `${campaign.name} ${campaign.channel}`.toLowerCase().includes(q))
        && (!status || campaign.status === status)
        && (!branchId || campaign.branchIds.includes(branchId))) });
    } catch (error) { return next(error); }
  });

  app.post('/api/campaigns', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const campaign = normalizeCampaign(req.body);
      await ensureCampaignBranches(database, req.user.organizationId, campaign.branchIds);
      const result = await database.transaction(async (tx) => {
        const inserted = await tx.run(
          `INSERT INTO campaigns (organization_id, name, channel, objective, start_date, end_date, planned_budget, actual_spend, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.organizationId, campaign.name, campaign.channel, campaign.objective, campaign.startDate, campaign.endDate, campaign.plannedBudget, campaign.actualSpend, campaign.status]
        );
        for (const branchId of campaign.branchIds) await tx.run('INSERT INTO campaign_branches (campaign_id, branch_id, organization_id) VALUES (?, ?, ?)', [inserted.lastID, branchId, req.user.organizationId]);
        return inserted.lastID;
      });
      return res.status(201).json({ campaign: (await campaignRows(database, req.user.organizationId, result))[0] });
    } catch (error) { return next(error); }
  });

  app.patch('/api/campaigns/:id', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Campaign');
      if (!await database.get('SELECT id FROM campaigns WHERE id = ? AND organization_id = ? AND archived_at IS NULL', [id, req.user.organizationId])) throw httpError(404, 'NOT_FOUND', 'Campaign not found.');
      const campaign = normalizeCampaign(req.body);
      await ensureCampaignBranches(database, req.user.organizationId, campaign.branchIds);
      await database.transaction(async (tx) => {
        await tx.run(
          `UPDATE campaigns SET name = ?, channel = ?, objective = ?, start_date = ?, end_date = ?, planned_budget = ?, actual_spend = ?, status = ?, updated_at = ?
           WHERE id = ? AND organization_id = ?`,
          [campaign.name, campaign.channel, campaign.objective, campaign.startDate, campaign.endDate, campaign.plannedBudget, campaign.actualSpend, campaign.status, new Date().toISOString(), id, req.user.organizationId]
        );
        await tx.run('DELETE FROM campaign_branches WHERE campaign_id = ? AND organization_id = ?', [id, req.user.organizationId]);
        for (const branchId of campaign.branchIds) await tx.run('INSERT INTO campaign_branches (campaign_id, branch_id, organization_id) VALUES (?, ?, ?)', [id, branchId, req.user.organizationId]);
      });
      return res.json({ campaign: (await campaignRows(database, req.user.organizationId, id))[0] });
    } catch (error) { return next(error); }
  });

  app.delete('/api/campaigns/:id', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Campaign');
      const result = await database.run(
        "UPDATE campaigns SET status = 'Archived', archived_at = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL",
        [new Date().toISOString(), new Date().toISOString(), id, req.user.organizationId]
      );
      if (!result.changes) throw httpError(404, 'NOT_FOUND', 'Campaign not found.');
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  app.get('/api/campaigns/:id', async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Campaign');
      const campaign = (await campaignRows(database, req.user.organizationId, id, true))[0];
      if (!campaign) throw httpError(404, 'NOT_FOUND', 'Campaign not found.');
      const leads = await database.all(
        `SELECT l.id, l.display_name, l.status, l.created_at, b.name AS branch_name
         FROM leads l LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
         WHERE l.organization_id = ? AND l.campaign_id = ? AND l.archived_at IS NULL ORDER BY l.created_at DESC LIMIT 100`,
        [req.user.organizationId, id]
      );
      const transactions = await database.all(
        `SELECT t.id, t.transaction_date, t.amount_idr, t.status, t.reference, b.name AS branch_name, l.display_name AS lead_name
         FROM transactions t LEFT JOIN branches b ON b.id = t.branch_id AND b.organization_id = t.organization_id
         LEFT JOIN leads l ON l.id = t.lead_id AND l.organization_id = t.organization_id
         WHERE t.organization_id = ? AND t.campaign_id = ? ORDER BY t.transaction_date DESC LIMIT 100`,
        [req.user.organizationId, id]
      );
      const summary = await database.get(
        `SELECT
           (SELECT COUNT(*) FROM leads WHERE organization_id = ? AND campaign_id = ? AND archived_at IS NULL) AS lead_count,
           (SELECT COUNT(*) FROM transactions WHERE organization_id = ? AND campaign_id = ?) AS transaction_count,
           (SELECT COALESCE(SUM(amount_idr), 0) FROM transactions WHERE organization_id = ? AND campaign_id = ? AND status = 'Paid') AS paid_revenue`,
        [req.user.organizationId, id, req.user.organizationId, id, req.user.organizationId, id]
      );
      return res.json({ campaign, leads, transactions, summary });
    } catch (error) { return next(error); }
  });

  app.get('/api/leads', async (req, res, next) => {
    try {
      const clauses = ['l.organization_id = ?', 'l.archived_at IS NULL'];
      const params = [req.user.organizationId];
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      if (q) { clauses.push('(l.display_name LIKE ? OR l.phone LIKE ? OR l.source LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      const assigneeId = singleQueryId(req.query.assigneeId, 'Assignee');
      if (assigneeId) { clauses.push('l.assignee_user_id = ?'); params.push(assigneeId); }
      if (req.query.status) {
        if (!LEAD_STATUSES.includes(req.query.status)) throw httpError(400, 'VALIDATION_ERROR', 'Invalid lead status filter.');
        clauses.push('l.status = ?'); params.push(req.query.status);
      }
      for (const [queryKey, column, label] of [['campaignId', 'l.campaign_id', 'Campaign'], ['branchId', 'l.branch_id', 'Branch'], ['assigneeId', 'l.assignee_user_id', 'Assignee']]) {
        const id = singleQueryId(req.query[queryKey], label);
        if (id) { clauses.push(`${column} = ?`); params.push(id); }
      }
      if (req.query.source) { clauses.push('l.source = ?'); params.push(optionalText(String(req.query.source), 'Source', 80)); }
      const from = dateOnly(req.query.from, 'Start date', true);
      const to = dateOnly(req.query.to, 'End date', true);
      if (from && to && to < from) throw httpError(400, 'VALIDATION_ERROR', 'End date must be on or after start date.');
      if (from) { clauses.push('date(l.created_at) >= ?'); params.push(from); }
      if (to) { clauses.push('date(l.created_at) <= ?'); params.push(to); }
      const leads = await database.all(
        `SELECT l.id, l.display_name, l.phone, l.source, l.campaign_id, l.branch_id, l.assignee_user_id,
                l.status, l.created_at, l.next_follow_up_at, l.notes,
                c.name AS campaign_name, b.name AS branch_name, u.display_name AS assignee_name
         FROM leads l
         LEFT JOIN campaigns c ON c.id = l.campaign_id AND c.organization_id = l.organization_id
         LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
         LEFT JOIN users u ON u.id = l.assignee_user_id
         WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT 500`,
        params
      );
      return res.json({ leads });
    } catch (error) { return next(error); }
  });

  app.post('/api/leads', requireRole(...ROLE_OPERATORS), async (req, res, next) => {
    try {
      const lead = normalizeLead(req.body);
      const orgId = req.user.organizationId;
      lead.branchId = await ensureBranch(database, orgId, lead.branchId);
      lead.campaignId = await ensureCampaign(database, orgId, lead.campaignId);
      await ensureCampaignBranch(database, orgId, lead.campaignId, lead.branchId);
      lead.assigneeUserId = await ensureAssignee(database, orgId, lead.assigneeUserId);
      const id = await database.transaction(async (tx) => {
        const inserted = await tx.run(
          `INSERT INTO leads (organization_id, display_name, phone, source, campaign_id, branch_id, assignee_user_id, status, created_at, next_follow_up_at, whatsapp_authorized, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orgId, lead.displayName, lead.phone, lead.source, lead.campaignId, lead.branchId, lead.assigneeUserId, lead.status, `${lead.createdDate}T12:00:00.000Z`, lead.nextFollowUpDate, lead.whatsappAuthorized ? 1 : 0, lead.notes]
        );
        await tx.run(
          `INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, to_status, note)
           VALUES (?, ?, ?, 'created', ?, 'Lead created')`,
          [orgId, inserted.lastID, req.user.id, lead.status]
        );
        return inserted.lastID;
      });
      const created = await database.get(
        `SELECT l.*, c.name AS campaign_name, b.name AS branch_name, u.display_name AS assignee_name
         FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id AND c.organization_id = l.organization_id
         LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
         LEFT JOIN users u ON u.id = l.assignee_user_id WHERE l.id = ? AND l.organization_id = ?`, [id, orgId]
      );
      return res.status(201).json({ lead: created });
    } catch (error) { return next(error); }
  });

  app.get('/api/leads/:id', async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Lead');
      const orgId = req.user.organizationId;
      const lead = await database.get(
        `SELECT l.*, c.name AS campaign_name, b.name AS branch_name, u.display_name AS assignee_name
         FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id AND c.organization_id = l.organization_id
         LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
         LEFT JOIN users u ON u.id = l.assignee_user_id
         WHERE l.id = ? AND l.organization_id = ? AND l.archived_at IS NULL`, [id, orgId]
      );
      if (!lead) throw httpError(404, 'NOT_FOUND', 'Lead not found.');
      const activities = await database.all(
        `SELECT a.id, a.activity_type, a.from_status, a.to_status, a.note, a.created_at, u.display_name AS actor_name
         FROM lead_activities a LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.organization_id = ? AND a.lead_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 100`, [orgId, id]
      );
      const transactions = await database.all(
        `SELECT id, transaction_date, amount_idr, status, reference FROM transactions WHERE organization_id = ? AND lead_id = ? ORDER BY transaction_date DESC`, [orgId, id]
      );
      return res.json({ lead, activities, transactions });
    } catch (error) { return next(error); }
  });

  app.patch('/api/leads/:id', requireRole(...ROLE_OPERATORS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Lead');
      const orgId = req.user.organizationId;
      const existing = await database.get('SELECT * FROM leads WHERE id = ? AND organization_id = ? AND archived_at IS NULL', [id, orgId]);
      if (!existing) throw httpError(404, 'NOT_FOUND', 'Lead not found.');
      const lead = normalizeLead(req.body);
      lead.branchId = await ensureBranch(database, orgId, lead.branchId, false, existing.branch_id === lead.branchId);
      lead.campaignId = await ensureCampaign(database, orgId, lead.campaignId, existing.campaign_id === lead.campaignId);
      await ensureCampaignBranch(database, orgId, lead.campaignId, lead.branchId);
      lead.assigneeUserId = await ensureAssignee(database, orgId, lead.assigneeUserId, existing.assignee_user_id === lead.assigneeUserId);
      await database.transaction(async (tx) => {
        await tx.run(
          `UPDATE leads SET display_name = ?, phone = ?, source = ?, campaign_id = ?, branch_id = ?, assignee_user_id = ?, status = ?, created_at = ?, next_follow_up_at = ?, whatsapp_authorized = ?, notes = ?, updated_at = ?
           WHERE id = ? AND organization_id = ?`,
          [lead.displayName, lead.phone, lead.source, lead.campaignId, lead.branchId, lead.assigneeUserId, lead.status, `${lead.createdDate}T12:00:00.000Z`, lead.nextFollowUpDate, lead.whatsappAuthorized ? 1 : 0, lead.notes, new Date().toISOString(), id, orgId]
        );
        if (existing.status !== lead.status) {
          await tx.run(
            `INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, from_status, to_status, note)
             VALUES (?, ?, ?, 'status_changed', ?, ?, 'Status updated')`,
            [orgId, id, req.user.id, existing.status, lead.status]
          );
        }
        if ((existing.next_follow_up_at || null) !== (lead.nextFollowUpDate || null)) {
          await tx.run(
            `INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, note)
             VALUES (?, ?, ?, 'follow_up_updated', ?)`,
            [orgId, id, req.user.id, lead.nextFollowUpDate ? `Follow-up set for ${lead.nextFollowUpDate}` : 'Follow-up cleared']
          );
        }
      });
      const updated = await database.get(
        `SELECT l.*, c.name AS campaign_name, b.name AS branch_name, u.display_name AS assignee_name
         FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id AND c.organization_id = l.organization_id
         LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
         LEFT JOIN users u ON u.id = l.assignee_user_id WHERE l.id = ? AND l.organization_id = ?`, [id, orgId]
      );
      return res.json({ lead: updated });
    } catch (error) { return next(error); }
  });

  app.delete('/api/leads/:id', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Lead');
      const result = await database.run('UPDATE leads SET archived_at = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL', [new Date().toISOString(), new Date().toISOString(), id, req.user.organizationId]);
      if (!result.changes) throw httpError(404, 'NOT_FOUND', 'Lead not found.');
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  app.post('/api/leads/:id/follow-up', requireRole(...ROLE_OPERATORS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Lead');
      const date = dateOnly(req.body?.date, 'Follow-up date', true);
      const orgId = req.user.organizationId;
      const lead = await database.get('SELECT id FROM leads WHERE id = ? AND organization_id = ? AND archived_at IS NULL', [id, orgId]);
      if (!lead) throw httpError(404, 'NOT_FOUND', 'Lead not found.');
      await database.transaction(async (tx) => {
        await tx.run('UPDATE leads SET next_follow_up_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?', [date, new Date().toISOString(), id, orgId]);
        await tx.run(
          'INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, note) VALUES (?, ?, ?, ?, ?)',
          [orgId, id, req.user.id, date ? 'follow_up_rescheduled' : 'follow_up_completed', date ? `Follow-up moved to ${date}` : 'Follow-up completed']
        );
      });
      return res.json({ ok: true, nextFollowUpAt: date });
    } catch (error) { return next(error); }
  });

  app.get('/api/transactions', async (req, res, next) => {
    try {
      const clauses = ['t.organization_id = ?'];
      const params = [req.user.organizationId];
      const branchId = singleQueryId(req.query.branchId, 'Branch');
      const campaignId = singleQueryId(req.query.campaignId, 'Campaign');
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const from = dateOnly(req.query.from, 'Start date', true);
      const to = dateOnly(req.query.to, 'End date', true);
      if (from && to && to < from) throw httpError(400, 'VALIDATION_ERROR', 'End date must be on or after start date.');
      if (branchId) { clauses.push('t.branch_id = ?'); params.push(branchId); }
      if (campaignId) { clauses.push('t.campaign_id = ?'); params.push(campaignId); }
      if (q) { clauses.push('(l.display_name LIKE ? OR t.reference LIKE ? OR c.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      if (status) {
        if (!TX_STATUSES.includes(status)) throw httpError(400, 'VALIDATION_ERROR', 'Invalid transaction status filter.');
        clauses.push('t.status = ?'); params.push(status);
      }
      if (from) { clauses.push('t.transaction_date >= ?'); params.push(from); }
      if (to) { clauses.push('t.transaction_date <= ?'); params.push(to); }
      const transactions = await database.all(
        `SELECT t.*, l.display_name AS lead_name, c.name AS campaign_name, b.name AS branch_name
         FROM transactions t LEFT JOIN leads l ON l.id = t.lead_id AND l.organization_id = t.organization_id
         LEFT JOIN campaigns c ON c.id = t.campaign_id AND c.organization_id = t.organization_id
         LEFT JOIN branches b ON b.id = t.branch_id AND b.organization_id = t.organization_id
         WHERE ${clauses.join(' AND ')} ORDER BY t.transaction_date DESC, t.id DESC LIMIT 500`, params
      );
      return res.json({ transactions });
    } catch (error) { return next(error); }
  });

  async function transitionLeadToPurchased(tx, orgId, leadId, actorId) {
    if (leadId == null) return;
    const lead = await tx.get('SELECT status FROM leads WHERE id = ? AND organization_id = ? AND archived_at IS NULL', [leadId, orgId]);
    if (lead && lead.status !== 'Purchased') {
      await tx.run('UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?', ['Purchased', new Date().toISOString(), leadId, orgId]);
      await tx.run(
        `INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, from_status, to_status, note)
         VALUES (?, ?, ?, 'status_changed', ?, 'Purchased', 'Paid transaction recorded')`,
        [orgId, leadId, actorId, lead.status]
      );
    }
  }

  app.post('/api/transactions', requireRole(...ROLE_OPERATORS), async (req, res, next) => {
    try {
      const tx = await normalizeTransaction(req.body, database, req.user.organizationId);
      const id = await database.transaction(async (sql) => {
        const result = await sql.run(
          `INSERT INTO transactions (organization_id, lead_id, branch_id, campaign_id, transaction_date, amount_idr, status, reference)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.organizationId, tx.leadId, tx.branchId, tx.campaignId, tx.transactionDate, tx.amountIdr, tx.status, tx.reference]
        );
        await sql.run(
          'INSERT INTO transaction_activities (organization_id, transaction_id, actor_user_id, action) VALUES (?, ?, ?, ?)',
          [req.user.organizationId, result.lastID, req.user.id, 'created']
        );
        if (tx.status === 'Paid') await transitionLeadToPurchased(sql, req.user.organizationId, tx.leadId, req.user.id);
        return result.lastID;
      });
      const transaction = await database.get(
        `SELECT t.*, l.display_name AS lead_name, c.name AS campaign_name, b.name AS branch_name FROM transactions t
         LEFT JOIN leads l ON l.id = t.lead_id AND l.organization_id = t.organization_id
         LEFT JOIN campaigns c ON c.id = t.campaign_id AND c.organization_id = t.organization_id
         LEFT JOIN branches b ON b.id = t.branch_id AND b.organization_id = t.organization_id
         WHERE t.id = ? AND t.organization_id = ?`, [id, req.user.organizationId]
      );
      return res.status(201).json({ transaction });
    } catch (error) { return next(error); }
  });

  app.patch('/api/transactions/:id', requireRole(...ROLE_OPERATORS), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Transaction');
      const orgId = req.user.organizationId;
      const existing = await database.get('SELECT id, lead_id, branch_id, campaign_id FROM transactions WHERE id = ? AND organization_id = ?', [id, orgId]);
      if (!existing) throw httpError(404, 'NOT_FOUND', 'Transaction not found.');
      const tx = await normalizeTransaction(req.body, database, orgId, existing);
      await database.transaction(async (sql) => {
        await sql.run(
          `UPDATE transactions SET lead_id = ?, branch_id = ?, campaign_id = ?, transaction_date = ?, amount_idr = ?, status = ?, reference = ?, updated_at = ?
           WHERE id = ? AND organization_id = ?`,
          [tx.leadId, tx.branchId, tx.campaignId, tx.transactionDate, tx.amountIdr, tx.status, tx.reference, new Date().toISOString(), id, orgId]
        );
        await sql.run(
          'INSERT INTO transaction_activities (organization_id, transaction_id, actor_user_id, action) VALUES (?, ?, ?, ?)',
          [orgId, id, req.user.id, 'updated']
        );
        if (tx.status === 'Paid') await transitionLeadToPurchased(sql, orgId, tx.leadId, req.user.id);
      });
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  app.get('/api/dashboard', async (req, res, next) => {
    try {
      const from = dateOnly(req.query.from, 'Start date', true);
      const to = dateOnly(req.query.to, 'End date', true);
      if (from && to && to < from) throw httpError(400, 'VALIDATION_ERROR', 'End date must be on or after start date.');
      const branchId = singleQueryId(req.query.branchId, 'Branch');
      if (branchId) await ensureBranch(database, req.user.organizationId, branchId, true);
      const orgId = req.user.organizationId;
      const leads = await database.all('SELECT * FROM leads WHERE organization_id = ? AND archived_at IS NULL', [orgId]);
      const transactions = await database.all('SELECT * FROM transactions WHERE organization_id = ?', [orgId]);
      const leadActivities = await database.all('SELECT lead_id, activity_type, to_status, created_at FROM lead_activities WHERE organization_id = ?', [orgId]);
      const campaigns = await campaignRows(database, orgId, null, true);
      const metrics = summarizeMetrics({ leads, transactions, campaigns, leadActivities, from, to, branchId });
      const branches = await database.all('SELECT id, name, city FROM branches WHERE organization_id = ? AND archived_at IS NULL ORDER BY name', [orgId]);
      const branchPerformance = branches.filter((branch) => !branchId || branch.id === branchId).map((branch) => {
        const branchLeads = leads.filter((lead) => lead.branch_id === branch.id && (!from || lead.created_at.slice(0, 10) >= from) && (!to || lead.created_at.slice(0, 10) <= to));
        const revenue = transactions.filter((tx) => tx.branch_id === branch.id && tx.status === 'Paid' && tx.campaign_id != null && (!from || tx.transaction_date >= from) && (!to || tx.transaction_date <= to))
          .reduce((sum, tx) => sum + Number(tx.amount_idr), 0);
        return { ...branch, leads: branchLeads.length, revenue };
      });
      const funnel = metrics.funnel;
      const attention = await database.all(
        `SELECT l.id, l.display_name, l.phone, l.whatsapp_authorized, l.status, l.next_follow_up_at, b.name AS branch_name
         FROM leads l LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
         WHERE l.organization_id = ? AND l.archived_at IS NULL AND l.next_follow_up_at IS NOT NULL
           AND l.next_follow_up_at <= date(?, '+7 days') ORDER BY l.next_follow_up_at ASC LIMIT 5`, [orgId, localToday()]
      );
      return res.json({ metrics, branchPerformance, followUps: attention, filters: { from, to, branchId } });
    } catch (error) { return next(error); }
  });

  app.get('/api/follow-ups', async (req, res, next) => {
    try {
      const today = localToday();
      const until = req.query.until ? dateOnly(req.query.until, 'Through date') : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const leads = await database.all(
        `SELECT l.id, l.display_name, l.phone, l.whatsapp_authorized, l.source, l.status, l.next_follow_up_at, l.branch_id, b.name AS branch_name,
                c.name AS campaign_name, l.assignee_user_id, u.display_name AS assignee_name,
                CASE WHEN l.next_follow_up_at < ? THEN 'overdue' ELSE 'upcoming' END AS timing
         FROM leads l LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
         LEFT JOIN campaigns c ON c.id = l.campaign_id AND c.organization_id = l.organization_id
         LEFT JOIN users u ON u.id = l.assignee_user_id
         WHERE l.organization_id = ? AND l.archived_at IS NULL AND l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= ?
         ORDER BY l.next_follow_up_at ASC, l.id ASC`, [today, req.user.organizationId, until]
      );
      return res.json({ followUps: leads, today, until });
    } catch (error) { return next(error); }
  });

  app.get('/api/settings', requireRole(...ROLE_ADMIN), async (req, res, next) => {
    try {
      const organization = await database.get('SELECT id, name, timezone, logo_url, created_at FROM organizations WHERE id = ?', [req.user.organizationId]);
      return res.json({ organization });
    } catch (error) { return next(error); }
  });

  app.patch('/api/settings', requireRole(...ROLE_ADMIN), async (req, res, next) => {
    try {
      const name = requiredText(req.body?.name, 'Organization name', 120);
      const timezoneValue = validTimezone(req.body?.timezone || 'Asia/Jakarta');
      if (!timezoneValue) throw httpError(400, 'VALIDATION_ERROR', 'Choose a valid timezone from the list.');
      const logoUrl = validateImageDataUrl(req.body?.logoDataUrl ?? null);
      if (req.body?.logoDataUrl != null && !logoUrl) throw httpError(400, 'VALIDATION_ERROR', 'Upload a valid image file in PNG, JPG, GIF, or WEBP format.');
      await database.run('UPDATE organizations SET name = ?, timezone = ?, logo_url = ? WHERE id = ?', [name, timezoneValue, logoUrl ?? null, req.user.organizationId]);
      return res.json({ organization: await database.get('SELECT id, name, timezone, logo_url, created_at FROM organizations WHERE id = ?', [req.user.organizationId]) });
    } catch (error) { return next(error); }
  });

  app.get('/api/team', requireRole(...ROLE_ADMIN), async (req, res, next) => {
    try {
      const members = await database.all(
        `SELECT u.id, u.email, u.display_name, u.is_active, m.role, u.created_at
         FROM organization_memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = ? ORDER BY CASE m.role WHEN 'owner_admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.display_name`,
        [req.user.organizationId]
      );
      return res.json({ members });
    } catch (error) { return next(error); }
  });

  app.post('/api/team', requireRole(...ROLE_ADMIN), async (req, res, next) => {
    try {
      const displayName = requiredText(req.body?.displayName, 'Name', 100);
      const email = requiredText(req.body?.email, 'Email', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (password.length < 10 || password.length > 200) throw httpError(400, 'VALIDATION_ERROR', 'Password must be at least 10 characters.');
      const role = ['owner_admin', 'manager', 'staff'].includes(req.body?.role) ? req.body.role : null;
      if (!role) throw httpError(400, 'VALIDATION_ERROR', 'Choose a valid role.');
      const existing = await database.get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) throw httpError(409, 'EMAIL_EXISTS', 'An account already uses this email.');
      const passwordHash = await bcrypt.hash(password, 12);
      const userId = await database.transaction(async (tx) => {
        const user = await tx.run('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)', [email, displayName, passwordHash]);
        await tx.run('INSERT INTO organization_memberships (user_id, organization_id, role) VALUES (?, ?, ?)', [user.lastID, req.user.organizationId, role]);
        return user.lastID;
      });
      const member = await database.get(
        `SELECT u.id, u.email, u.display_name, u.is_active, m.role, u.created_at
         FROM organization_memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = ? AND u.id = ?`, [req.user.organizationId, userId]
      );
      return res.status(201).json({ member });
    } catch (error) { return next(error); }
  });

  app.patch('/api/team/:id', requireRole(...ROLE_ADMIN), async (req, res, next) => {
    try {
      const id = optionalId(req.params.id, 'Team member');
      const member = await database.get(
        `SELECT u.id, u.display_name, u.is_active, m.role FROM users u JOIN organization_memberships m ON m.user_id = u.id
         WHERE u.id = ? AND m.organization_id = ?`, [id, req.user.organizationId]
      );
      if (!member) throw httpError(404, 'NOT_FOUND', 'Team member not found.');
      const role = req.body?.role === undefined ? member.role : req.body.role;
      if (!['owner_admin', 'manager', 'staff'].includes(role)) throw httpError(400, 'VALIDATION_ERROR', 'Choose a valid role.');
      if (req.body?.isActive !== undefined && typeof req.body.isActive !== 'boolean') throw httpError(400, 'VALIDATION_ERROR', 'Account status must be active or inactive.');
      const isActive = req.body?.isActive === undefined ? member.is_active : (req.body.isActive ? 1 : 0);
      if (!isActive && id === req.user.id) throw httpError(400, 'VALIDATION_ERROR', 'You cannot deactivate your own account.');
      if (member.role === 'owner_admin' && (role !== 'owner_admin' || !isActive)) {
        const adminCount = await database.get(
          `SELECT COUNT(*) AS count FROM users u JOIN organization_memberships m ON m.user_id = u.id
           WHERE m.organization_id = ? AND m.role = 'owner_admin' AND u.is_active = 1`, [req.user.organizationId]
        );
        if (adminCount.count <= 1) throw httpError(400, 'LAST_ADMIN', 'Keep at least one active Owner/Admin account.');
      }
      await database.transaction(async (tx) => {
        await tx.run('UPDATE organization_memberships SET role = ? WHERE user_id = ? AND organization_id = ?', [role, id, req.user.organizationId]);
        await tx.run('UPDATE users SET is_active = ? WHERE id = ?', [isActive, id]);
        if (!isActive) await tx.run('DELETE FROM sessions WHERE user_id = ? AND organization_id = ?', [id, req.user.organizationId]);
      });
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  async function getFilteredLeadsForExport(req) {
    const clauses = ['l.organization_id = ?', 'l.archived_at IS NULL'];
    const params = [req.user.organizationId];
    const branchId = singleQueryId(req.query.branchId, 'Branch');
    const campaignId = singleQueryId(req.query.campaignId, 'Campaign');
    const assigneeId = singleQueryId(req.query.assigneeId, 'Assignee');
    if (branchId) { clauses.push('l.branch_id = ?'); params.push(branchId); }
    if (campaignId) { clauses.push('l.campaign_id = ?'); params.push(campaignId); }
    if (assigneeId) { clauses.push('l.assignee_user_id = ?'); params.push(assigneeId); }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q) { clauses.push('(l.display_name LIKE ? OR l.phone LIKE ? OR l.source LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (req.query.source) { clauses.push('l.source = ?'); params.push(optionalText(String(req.query.source), 'Source', 80)); }
    if (req.query.status) {
      if (!LEAD_STATUSES.includes(req.query.status)) throw httpError(400, 'VALIDATION_ERROR', 'Invalid lead status filter.');
      clauses.push('l.status = ?'); params.push(req.query.status);
    }
    const from = dateOnly(req.query.from, 'Start date', true);
    const to = dateOnly(req.query.to, 'End date', true);
    if (from && to && to < from) throw httpError(400, 'VALIDATION_ERROR', 'End date must be on or after start date.');
    if (from) { clauses.push('date(l.created_at) >= ?'); params.push(from); }
    if (to) { clauses.push('date(l.created_at) <= ?'); params.push(to); }
    return database.all(
      `SELECT l.display_name, l.phone, l.source, l.status, date(l.created_at) AS created_date, l.next_follow_up_at,
              b.name AS branch, c.name AS campaign, u.display_name AS assignee, l.notes
       FROM leads l LEFT JOIN branches b ON b.id = l.branch_id AND b.organization_id = l.organization_id
       LEFT JOIN campaigns c ON c.id = l.campaign_id AND c.organization_id = l.organization_id
       LEFT JOIN users u ON u.id = l.assignee_user_id WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC`, params
    );
  }

  app.get('/api/export/leads.csv', async (req, res, next) => {
    try {
      const leads = await getFilteredLeadsForExport(req);
      return csvDownload(res, 'athena-leads.csv', leads, [
        { key: 'display_name', label: 'Name or reference' }, { key: 'phone', label: 'Contact number' }, { key: 'source', label: 'Source' },
        { key: 'campaign', label: 'Campaign' }, { key: 'branch', label: 'Branch' }, { key: 'assignee', label: 'Assignee' },
        { key: 'status', label: 'Status' }, { key: 'created_date', label: 'Created date' }, { key: 'next_follow_up_at', label: 'Next follow-up' }, { key: 'notes', label: 'Operational note' }
      ]);
    } catch (error) { return next(error); }
  });

  app.get('/api/export/transactions.csv', async (req, res, next) => {
    try {
      const clauses = ['t.organization_id = ?'];
      const params = [req.user.organizationId];
      const branchId = singleQueryId(req.query.branchId, 'Branch');
      const campaignId = singleQueryId(req.query.campaignId, 'Campaign');
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const from = dateOnly(req.query.from, 'Start date', true);
      const to = dateOnly(req.query.to, 'End date', true);
      if (branchId) { clauses.push('t.branch_id = ?'); params.push(branchId); }
      if (campaignId) { clauses.push('t.campaign_id = ?'); params.push(campaignId); }
      if (q) { clauses.push('(l.display_name LIKE ? OR t.reference LIKE ? OR c.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      if (req.query.status) {
        if (!TX_STATUSES.includes(req.query.status)) throw httpError(400, 'VALIDATION_ERROR', 'Invalid transaction status filter.');
        clauses.push('t.status = ?'); params.push(req.query.status);
      }
      if (from) { clauses.push('t.transaction_date >= ?'); params.push(from); }
      if (to) { clauses.push('t.transaction_date <= ?'); params.push(to); }
      const rows = await database.all(
        `SELECT t.transaction_date, t.amount_idr, t.status, t.reference, l.display_name AS lead, c.name AS campaign, b.name AS branch
         FROM transactions t LEFT JOIN leads l ON l.id = t.lead_id AND l.organization_id = t.organization_id
         LEFT JOIN campaigns c ON c.id = t.campaign_id AND c.organization_id = t.organization_id
         LEFT JOIN branches b ON b.id = t.branch_id AND b.organization_id = t.organization_id
         WHERE ${clauses.join(' AND ')} ORDER BY t.transaction_date DESC`, params
      );
      return csvDownload(res, 'athena-transactions.csv', rows, [
        { key: 'transaction_date', label: 'Transaction date' }, { key: 'lead', label: 'Lead' }, { key: 'branch', label: 'Branch' },
        { key: 'campaign', label: 'Campaign' }, { key: 'amount_idr', label: 'Amount IDR' }, { key: 'status', label: 'Status' }, { key: 'reference', label: 'Reference' }
      ]);
    } catch (error) { return next(error); }
  });

  app.get('/api/export/campaign-performance.csv', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const from = dateOnly(req.query.from, 'Start date', true);
      const to = dateOnly(req.query.to, 'End date', true);
      if (from && to && to < from) throw httpError(400, 'VALIDATION_ERROR', 'End date must be on or after start date.');
      const branchId = singleQueryId(req.query.branchId, 'Branch');
      const [campaigns, leads, transactions] = await Promise.all([
        campaignRows(database, req.user.organizationId),
        database.all('SELECT * FROM leads WHERE organization_id = ? AND archived_at IS NULL', [req.user.organizationId]),
        database.all('SELECT * FROM transactions WHERE organization_id = ?', [req.user.organizationId])
      ]);
      const performance = summarizeMetrics({ campaigns, leads, transactions, from, to, branchId }).campaignPerformance;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80).toLowerCase() : '';
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      if (status && !['Draft', 'Active', 'Completed'].includes(status)) throw httpError(400, 'VALIDATION_ERROR', 'Invalid campaign status filter.');
      const rows = performance
        .filter((row) => (!q || `${row.name} ${row.channel}`.toLowerCase().includes(q)) && (!status || row.status === status))
        .map((row) => ({ ...row, plannedBudget: campaigns.find((campaign) => campaign.id === row.id)?.planned_budget }));
      return csvDownload(res, 'athena-campaign-performance.csv', rows, [
        { key: 'name', label: 'Campaign' }, { key: 'channel', label: 'Channel' }, { key: 'status', label: 'Status' },
        { key: 'leadCount', label: 'Leads' }, { key: 'revenue', label: 'Attributed revenue IDR' },
        { key: 'plannedBudget', label: 'Planned budget IDR' }, { key: 'spend', label: 'Recorded spend IDR' }, { key: 'costPerLead', label: 'Cost per lead IDR' }
      ]);
    } catch (error) { return next(error); }
  });

  const importFields = {
    leads: ['displayName', 'phone', 'source', 'campaign', 'branch', 'assignee', 'status', 'createdDate', 'nextFollowUpDate', 'notes'],
    transactions: ['leadReference', 'branch', 'campaign', 'transactionDate', 'amountIdr', 'status', 'reference']
  };
  const headerAliases = {
    displayName: ['name', 'lead', 'lead name', 'name or reference', 'customer'], phone: ['phone', 'contact', 'contact number', 'mobile'],
    source: ['source', 'channel'], campaign: ['campaign', 'campaign name'], branch: ['branch', 'branch name'],
    assignee: ['assignee', 'assigned to', 'staff'], status: ['status'], createdDate: ['created date', 'created at', 'date created'],
    nextFollowUpDate: ['next follow-up', 'follow up', 'follow-up date'], notes: ['note', 'notes'],
    leadReference: ['lead', 'lead reference', 'customer', 'phone'], transactionDate: ['transaction date', 'date'],
    amountIdr: ['amount', 'amount idr', 'amount_idr'], reference: ['reference', 'receipt']
  };
  function defaultMapping(headers, type) {
    const mapping = {};
    for (const field of importFields[type]) {
      const aliases = headerAliases[field];
      const found = headers.find((header) => aliases.includes(header.trim().toLowerCase()));
      mapping[field] = found || '';
    }
    return mapping;
  }

  async function previewImport({ type, rawRows, mapping, organizationId }) {
    if (!['leads', 'transactions'].includes(type)) throw httpError(400, 'VALIDATION_ERROR', 'Choose leads or transactions for import.');
    if (!Array.isArray(rawRows) || rawRows.length > 2000) throw httpError(400, 'VALIDATION_ERROR', 'Import contains too many rows.');
    const fields = importFields[type];
    for (const [field, header] of Object.entries(mapping || {})) {
      if (!fields.includes(field) || (header && (!rawRows.every((row) => Object.hasOwn(row, header))))) throw httpError(400, 'VALIDATION_ERROR', 'Column mapping is invalid.');
    }
    const getValue = (raw, field) => {
      const header = mapping?.[field];
      return header ? String(raw[header] ?? '').trim() : '';
    };
    const rows = [];
    const seen = new Set();
    for (let index = 0; index < rawRows.length; index += 1) {
      const raw = rawRows[index];
      const errors = [];
      const warnings = [];
      const values = {};
      try {
        if (type === 'leads') {
          values.displayName = requiredText(getValue(raw, 'displayName'), 'Name or reference', 120);
          values.phone = optionalText(getValue(raw, 'phone'), 'Contact number', 40);
          values.source = getValue(raw, 'source') || 'CSV import';
          values.status = getValue(raw, 'status') || 'New';
          if (!LEAD_STATUSES.includes(values.status)) throw httpError(400, 'VALIDATION_ERROR', 'Lead status is not recognized.');
          values.createdDate = dateOnly(getValue(raw, 'createdDate') || localToday(), 'Created date');
          values.nextFollowUpDate = dateOnly(getValue(raw, 'nextFollowUpDate'), 'Follow-up date', true);
          values.notes = optionalText(getValue(raw, 'notes'), 'Operational note', 500);
          const branchName = getValue(raw, 'branch');
          const campaignName = getValue(raw, 'campaign');
          const assigneeName = getValue(raw, 'assignee');
          const branch = branchName ? await database.get('SELECT id FROM branches WHERE organization_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE', [organizationId, branchName]) : null;
          const campaign = campaignName ? await database.get('SELECT id FROM campaigns WHERE organization_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE', [organizationId, campaignName]) : null;
          const assignee = assigneeName ? await database.get(
            `SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id = u.id WHERE m.organization_id = ? AND u.is_active = 1 AND u.display_name = ? COLLATE NOCASE`,
            [organizationId, assigneeName]
          ) : null;
          if (branchName && !branch) throw httpError(400, 'VALIDATION_ERROR', `Branch “${branchName}” was not found.`);
          if (campaignName && !campaign) throw httpError(400, 'VALIDATION_ERROR', `Campaign “${campaignName}” was not found.`);
          if (assigneeName && !assignee) throw httpError(400, 'VALIDATION_ERROR', `Team member “${assigneeName}” was not found.`);
          if (campaign && branch) await ensureCampaignBranch(database, organizationId, campaign.id, branch.id);
          values.branchId = branch?.id ?? null;
          values.campaignId = campaign?.id ?? null;
          values.assigneeUserId = assignee?.id ?? null;
          const duplicateKey = values.phone ? `phone:${values.phone.replace(/\D/g, '')}` : `name:${values.displayName.toLowerCase()}:${values.createdDate}`;
          if (seen.has(duplicateKey) || (values.phone && await database.get('SELECT id FROM leads WHERE organization_id = ? AND archived_at IS NULL AND phone = ?', [organizationId, values.phone]))) warnings.push('Possible duplicate lead');
          seen.add(duplicateKey);
        } else {
          const branchName = getValue(raw, 'branch');
          if (!branchName) throw httpError(400, 'VALIDATION_ERROR', 'Branch is required.');
          const branch = await database.get('SELECT id FROM branches WHERE organization_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE', [organizationId, branchName]);
          if (!branch) throw httpError(400, 'VALIDATION_ERROR', `Branch “${branchName}” was not found.`);
          const campaignName = getValue(raw, 'campaign');
          const campaign = campaignName ? await database.get('SELECT id FROM campaigns WHERE organization_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE', [organizationId, campaignName]) : null;
          if (campaignName && !campaign) throw httpError(400, 'VALIDATION_ERROR', `Campaign “${campaignName}” was not found.`);
          if (campaign) await ensureCampaignBranch(database, organizationId, campaign.id, branch.id);
          values.branchId = branch.id;
          values.campaignId = campaign?.id ?? null;
          values.transactionDate = dateOnly(getValue(raw, 'transactionDate'), 'Transaction date');
          const amount = getValue(raw, 'amountIdr');
          if (!/^\d+$/.test(amount)) throw httpError(400, 'VALIDATION_ERROR', 'Amount must be whole IDR with no separators.');
          values.amountIdr = integerMoney(amount, 'Amount');
          values.status = getValue(raw, 'status');
          if (!TX_STATUSES.includes(values.status)) throw httpError(400, 'VALIDATION_ERROR', 'Choose Paid, Refunded, or Cancelled.');
          values.reference = optionalText(getValue(raw, 'reference'), 'Reference', 80);
          const leadReference = getValue(raw, 'leadReference');
          const lead = leadReference ? await database.get(
            `SELECT id FROM leads WHERE organization_id = ? AND archived_at IS NULL AND (phone = ? OR display_name = ? COLLATE NOCASE) ORDER BY id LIMIT 1`,
            [organizationId, leadReference, leadReference]
          ) : null;
          if (leadReference && !lead) throw httpError(400, 'VALIDATION_ERROR', 'Lead reference was not found.');
          values.leadId = lead?.id ?? null;
          const duplicateKey = values.reference
            ? `reference:${values.reference.toLowerCase()}`
            : `transaction:${values.branchId}:${values.transactionDate}:${values.amountIdr}:${values.leadId || ''}`;
          const existing = values.reference
            ? await database.get('SELECT id FROM transactions WHERE organization_id = ? AND reference = ?', [organizationId, values.reference])
            : await database.get('SELECT id FROM transactions WHERE organization_id = ? AND branch_id = ? AND transaction_date = ? AND amount_idr = ? AND COALESCE(lead_id, 0) = COALESCE(?, 0)', [organizationId, values.branchId, values.transactionDate, values.amountIdr, values.leadId]);
          if (seen.has(duplicateKey) || existing) warnings.push('Possible duplicate transaction');
          seen.add(duplicateKey);
        }
      } catch (error) {
        errors.push(error.message);
      }
      rows.push({ rowNumber: index + 2, values, errors, warnings });
    }
    return rows;
  }

  app.post('/api/imports/preview', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : '';
      const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.toLowerCase().split(';')[0].trim() : '';
      if (!/\.csv$/i.test(fileName)) throw httpError(400, 'INVALID_FILE_TYPE', 'Choose a CSV file.');
      if (mimeType && !['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'].includes(mimeType)) {
        throw httpError(400, 'INVALID_FILE_TYPE', 'Choose a CSV file, not an executable or spreadsheet workbook.');
      }
      const parsed = parseCsv(req.body?.csvText);
      const type = req.body?.type;
      if (!['leads', 'transactions'].includes(type)) throw httpError(400, 'VALIDATION_ERROR', 'Choose leads or transactions for import.');
      const mapping = req.body?.mapping || defaultMapping(parsed.headers, type);
      const rows = await previewImport({ type, rawRows: parsed.rows, mapping, organizationId: req.user.organizationId });
      return res.json({ headers: parsed.headers, mapping, rows, validCount: rows.filter((row) => !row.errors.length).length, errorCount: rows.filter((row) => row.errors.length).length, duplicateCount: rows.filter((row) => row.warnings.length).length });
    } catch (error) { return next(error); }
  });

  app.post('/api/imports/commit', requireRole(...ROLE_MANAGERS), async (req, res, next) => {
    try {
      const type = req.body?.type;
      const rows = req.body?.rows;
      if (!['leads', 'transactions'].includes(type) || !Array.isArray(rows) || rows.length < 1 || rows.length > 2000) throw httpError(400, 'VALIDATION_ERROR', 'Select valid rows to import.');
      if (rows.some((row) => !row || typeof row !== 'object' || !row.values || (row.errors || []).length)) throw httpError(400, 'VALIDATION_ERROR', 'Resolve every row error before importing.');
      if (rows.some((row) => (row.warnings || []).length) && req.body?.allowDuplicates !== true) throw httpError(409, 'DUPLICATES_NEED_REVIEW', 'Review possible duplicate rows before confirming this import.');
      const orgId = req.user.organizationId;
      let imported = 0;
      await database.transaction(async (tx) => {
        const seen = new Set();
        for (const row of rows) {
          const value = row.values;
          if (type === 'leads') {
            const lead = normalizeLead({ ...value, branchId: value.branchId, campaignId: value.campaignId, assigneeUserId: value.assigneeUserId });
            lead.branchId = await ensureBranch(tx, orgId, lead.branchId);
            lead.campaignId = await ensureCampaign(tx, orgId, lead.campaignId);
            await ensureCampaignBranch(tx, orgId, lead.campaignId, lead.branchId);
            lead.assigneeUserId = await ensureAssignee(tx, orgId, lead.assigneeUserId);
            const key = lead.phone ? `phone:${lead.phone.replace(/\D/g, '')}` : `name:${lead.displayName.toLowerCase()}:${lead.createdDate}`;
            const exists = lead.phone
              ? await tx.get('SELECT id FROM leads WHERE organization_id = ? AND archived_at IS NULL AND phone = ?', [orgId, lead.phone])
              : await tx.get('SELECT id FROM leads WHERE organization_id = ? AND archived_at IS NULL AND lower(display_name) = lower(?) AND date(created_at) = ?', [orgId, lead.displayName, lead.createdDate]);
            if ((exists || seen.has(key)) && req.body?.allowDuplicates !== true) throw httpError(409, 'DUPLICATES_NEED_REVIEW', 'Possible duplicate leads were found. Review the preview and confirm duplicates if you want to continue.');
            seen.add(key);
            const inserted = await tx.run(
              `INSERT INTO leads (organization_id, display_name, phone, source, campaign_id, branch_id, assignee_user_id, status, created_at, next_follow_up_at, whatsapp_authorized, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [orgId, lead.displayName, lead.phone, lead.source, lead.campaignId, lead.branchId, lead.assigneeUserId, lead.status, `${lead.createdDate}T12:00:00.000Z`, lead.nextFollowUpDate, lead.whatsappAuthorized ? 1 : 0, lead.notes]
            );
            await tx.run(
              `INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, to_status, note)
               VALUES (?, ?, ?, 'created', ?, 'Imported from CSV')`, [orgId, inserted.lastID, req.user.id, lead.status]
            );
          } else {
            const transaction = await normalizeTransaction(value, tx, orgId);
            const key = transaction.reference
              ? `reference:${transaction.reference.toLowerCase()}`
              : `transaction:${transaction.branchId}:${transaction.transactionDate}:${transaction.amountIdr}:${transaction.leadId || ''}`;
            const exists = transaction.reference
              ? await tx.get('SELECT id FROM transactions WHERE organization_id = ? AND lower(reference) = lower(?)', [orgId, transaction.reference])
              : await tx.get('SELECT id FROM transactions WHERE organization_id = ? AND branch_id = ? AND transaction_date = ? AND amount_idr = ? AND COALESCE(lead_id, 0) = COALESCE(?, 0)', [orgId, transaction.branchId, transaction.transactionDate, transaction.amountIdr, transaction.leadId]);
            if ((exists || seen.has(key)) && req.body?.allowDuplicates !== true) throw httpError(409, 'DUPLICATES_NEED_REVIEW', 'Possible duplicate transactions were found. Review the preview and confirm duplicates if you want to continue.');
            seen.add(key);
            const inserted = await tx.run(
              `INSERT INTO transactions (organization_id, lead_id, branch_id, campaign_id, transaction_date, amount_idr, status, reference)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [orgId, transaction.leadId, transaction.branchId, transaction.campaignId, transaction.transactionDate, transaction.amountIdr, transaction.status, transaction.reference]
            );
            await tx.run(
              'INSERT INTO transaction_activities (organization_id, transaction_id, actor_user_id, action) VALUES (?, ?, ?, ?)',
              [orgId, inserted.lastID, req.user.id, 'imported']
            );
            if (transaction.status === 'Paid') await transitionLeadToPurchased(tx, orgId, transaction.leadId, req.user.id);
          }
          imported += 1;
        }
        await tx.run('INSERT INTO import_batches (organization_id, user_id, record_type, imported_count) VALUES (?, ?, ?, ?)', [orgId, req.user.id, type, imported]);
      });
      return res.status(201).json({ imported });
    } catch (error) { return next(error); }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('API request failed:', error.message);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with those details already exists.' } });
    }
    return res.status(status).json({ error: { code: error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'), message: status >= 500 ? 'The request could not be completed.' : error.message } });
  });
  return app;
}
