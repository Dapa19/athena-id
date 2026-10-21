import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { summarizeMetrics, sumPaidAttributedRevenue } from '../src/metrics.js';
import { parseCsv, stringifyCsv } from '../src/csv.js';

let database;
let app;
let organizationId;
let userId;
let branchId;
let campaignId;
let leadId;
let agent;

before(async () => {
  database = openDatabase(':memory:');
  await database.initialize();
  const org = await database.run('INSERT INTO organizations (name, slug) VALUES (?, ?)', ['Test clinic', 'test-clinic']);
  organizationId = org.lastID;
  const user = await database.run('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)', ['owner@test.invalid', 'Test Owner', await bcrypt.hash('strong-demo-password', 4)]);
  userId = user.lastID;
  await database.run('INSERT INTO organization_memberships (user_id, organization_id, role) VALUES (?, ?, ?)', [userId, organizationId, 'owner_admin']);
  const branch = await database.run('INSERT INTO branches (organization_id, name, city) VALUES (?, ?, ?)', [organizationId, 'Central', 'Jakarta']);
  branchId = branch.lastID;
  const campaign = await database.run(
    `INSERT INTO campaigns (organization_id, name, channel, start_date, end_date, planned_budget, actual_spend, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, 'Spring social', 'Instagram', '2026-10-01', '2026-10-31', 2000000, 1500000, 'Active']
  );
  campaignId = campaign.lastID;
  await database.run('INSERT INTO campaign_branches (campaign_id, branch_id, organization_id) VALUES (?, ?, ?)', [campaignId, branchId, organizationId]);
  const lead = await database.run(
    `INSERT INTO leads (organization_id, display_name, phone, source, campaign_id, branch_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, 'Test Lead', '08123456789', 'Instagram', campaignId, branchId, 'New', '2026-10-10T12:00:00.000Z']
  );
  leadId = lead.lastID;
  app = createApp({ database });
  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email: 'owner@test.invalid', password: 'strong-demo-password' });
  assert.equal(login.status, 200);
});

after(async () => {
  if (database) await database.close();
});

test('metric formulas use linked paid transactions and a lead creation cohort', async () => {
  const leads = [
    { id: 1, branch_id: 1, campaign_id: 1, created_at: '2026-10-10T12:00:00.000Z', status: 'Contacted' },
    { id: 2, branch_id: 1, campaign_id: 1, created_at: '2026-10-11T12:00:00.000Z', status: 'New' },
    { id: 3, branch_id: 1, campaign_id: 1, created_at: '2026-09-01T12:00:00.000Z', status: 'Purchased' }
  ];
  const transactions = [
    { lead_id: 1, campaign_id: 1, branch_id: 1, transaction_date: '2026-10-12', amount_idr: 900000, status: 'Paid' },
    { lead_id: 1, campaign_id: 1, branch_id: 1, transaction_date: '2026-10-13', amount_idr: 100000, status: 'Refunded' },
    { lead_id: 2, campaign_id: 1, branch_id: 1, transaction_date: '2026-10-14', amount_idr: 500000, status: 'Cancelled' }
  ];
  const metrics = summarizeMetrics({
    leads, transactions,
    leadActivities: [
      { lead_id: 1, activity_type: 'status_changed', to_status: 'Booked', created_at: '2026-10-11T12:00:00.000Z' },
      { lead_id: 1, activity_type: 'status_changed', to_status: 'Attended', created_at: '2026-10-12T12:00:00.000Z' },
      { lead_id: 2, activity_type: 'status_changed', to_status: 'Booked', created_at: '2026-10-12T12:00:00.000Z' }
    ],
    campaigns: [{ id: 1, name: 'Campaign', channel: 'Social', status: 'Active', start_date: '2026-10-01', end_date: '2026-10-31', planned_budget: 2000000, actual_spend: 1500000, branch_ids: [1] }],
    from: '2026-10-01', to: '2026-10-31', branchId: 1
  });
  assert.equal(metrics.leadCount, 2);
  assert.equal(metrics.convertedLeads, 1);
  assert.equal(metrics.conversionRate, 0.5);
  assert.equal(metrics.attributedRevenue, 900000);
  assert.equal(sumPaidAttributedRevenue(transactions), 900000);
  assert.equal(metrics.recordedSpend, 1500000);
  assert.equal(metrics.roas, 0.6);
  assert.equal(metrics.showRate, 0.5);
});

test('CSV export neutralizes spreadsheet formulas in user-controlled text', () => {
  const csv = stringifyCsv([{ name: '=1+1' }, { name: 'Normal name' }], [{ key: 'name', label: 'Name' }]);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /Normal name/);
  assert.deepEqual(parseCsv('\uFEFFName,Phone\nAlya,08123').headers, ['Name', 'Phone']);
});

test('lead status updates create activity and tenant data stays private', async () => {
  const update = await agent.patch(`/api/leads/${leadId}`).send({
    displayName: 'Test Lead', phone: '08123456789', source: 'Instagram', campaignId, branchId,
    status: 'Contacted', createdDate: '2026-10-10', nextFollowUpDate: '', notes: ''
  });
  assert.equal(update.status, 200);
  const detail = await agent.get(`/api/leads/${leadId}`);
  assert.equal(detail.body.lead.status, 'Contacted');
  assert.ok(detail.body.activities.some((activity) => activity.from_status === 'New' && activity.to_status === 'Contacted'));

  const otherOrg = await database.run('INSERT INTO organizations (name, slug) VALUES (?, ?)', ['Other clinic', 'other-clinic']);
  const otherBranch = await database.run('INSERT INTO branches (organization_id, name) VALUES (?, ?)', [otherOrg.lastID, 'Private']);
  const otherLead = await database.run(
    'INSERT INTO leads (organization_id, display_name, branch_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [otherOrg.lastID, 'Private lead', otherBranch.lastID, 'New', '2026-10-12T12:00:00.000Z']
  );
  const list = await agent.get('/api/leads');
  assert.equal(list.status, 200);
  assert.ok(list.body.leads.some((lead) => lead.id === leadId));
  assert.ok(!list.body.leads.some((lead) => lead.id === otherLead.lastID));
  const privateLead = await agent.get(`/api/leads/${otherLead.lastID}`);
  assert.equal(privateLead.status, 404);
});

test('campaigns can only be attributed to their selected branches', async () => {
  const otherBranch = await database.run('INSERT INTO branches (organization_id, name, city) VALUES (?, ?, ?)', [organizationId, 'North', 'Jakarta']);
  const response = await agent.post('/api/leads').send({
    displayName: 'Wrong branch lead', source: 'Social', campaignId, branchId: otherBranch.lastID,
    status: 'New', createdDate: '2026-10-14', nextFollowUpDate: '', notes: ''
  });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /not associated/);
});

test('paid transactions set Purchased status and refunds are excluded from dashboard revenue', async () => {
  const created = await agent.post('/api/transactions').send({
    leadId, branchId, campaignId, transactionDate: '2026-10-15', amountIdr: 1250000, status: 'Paid', reference: 'T-001'
  });
  assert.equal(created.status, 201);
  const lead = await agent.get(`/api/leads/${leadId}`);
  assert.equal(lead.body.lead.status, 'Purchased');
  await agent.post('/api/transactions').send({
    leadId, branchId, campaignId, transactionDate: '2026-10-16', amountIdr: 500000, status: 'Refunded', reference: 'T-002'
  });
  const dashboard = await agent.get('/api/dashboard?from=2026-10-01&to=2026-10-31');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.metrics.attributedRevenue, 1250000);
  assert.equal(dashboard.body.metrics.recordedSpend, 1500000);

  const archived = await agent.delete(`/api/campaigns/${campaignId}`);
  assert.equal(archived.status, 200);
  const updateArchivedRecord = await agent.patch(`/api/transactions/${created.body.transaction.id}`).send({
    leadId, branchId, campaignId, transactionDate: '2026-10-15', amountIdr: 1250000, status: 'Paid', reference: 'T-001'
  });
  assert.equal(updateArchivedRecord.status, 200);
});

test('CSV preview validates before insertion and requires duplicate confirmation', async () => {
  const preview = await agent.post('/api/imports/preview').send({
    type: 'leads', fileName: 'leads.csv', mimeType: 'text/csv', csvText: 'Name,Phone,Branch,Status\nImported Lead,081200000001,Central,New'
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.validCount, 1);
  const commit = await agent.post('/api/imports/commit').send({ type: 'leads', rows: preview.body.rows });
  assert.equal(commit.status, 201);
  assert.equal(commit.body.imported, 1);
  const exportResponse = await agent.get('/api/export/leads.csv');
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers['content-type'], /text\/csv/);
  assert.match(exportResponse.text, /Imported Lead/);

  const duplicatePreview = await agent.post('/api/imports/preview').send({
    type: 'leads', fileName: 'duplicates.csv', mimeType: 'text/csv',
    csvText: 'Name,Phone,Branch,Status\nAnother record,08123456789,Central,New'
  });
  assert.equal(duplicatePreview.body.duplicateCount, 1);
  const denied = await agent.post('/api/imports/commit').send({ type: 'leads', rows: duplicatePreview.body.rows });
  assert.equal(denied.status, 409);
  const confirmed = await agent.post('/api/imports/commit').send({ type: 'leads', rows: duplicatePreview.body.rows, allowDuplicates: true });
  assert.equal(confirmed.status, 201);
  assert.equal(confirmed.body.imported, 1);
});
