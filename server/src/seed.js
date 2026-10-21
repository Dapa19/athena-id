import bcrypt from 'bcryptjs';

const daysAgo = (count) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString();
};
const dateAgo = (count) => daysAgo(count).slice(0, 10);

export async function seedDemo(database) {
  if (!database) throw new Error('seedDemo requires a database instance.');
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');

  let organization = await database.get('SELECT * FROM organizations WHERE slug = ?', ['athena-demo']);
  if (!organization) {
    const result = await database.run('INSERT INTO organizations (name, slug) VALUES (?, ?)', ['Lumina Beauty Studio (Demo)', 'athena-demo']);
    organization = await database.get('SELECT * FROM organizations WHERE id = ?', [result.lastID]);
  }

  const email = (process.env.DEMO_EMAIL || 'owner@athena.id').toLowerCase();
  let user = await database.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    const password = process.env.DEMO_PASSWORD || 'athena-demo-2026';
    const hash = await bcrypt.hash(password, 12);
    const result = await database.run(
      'INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)',
      [email, 'Nadia Putri', hash]
    );
    user = await database.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
  }
  await database.run(
    'INSERT OR IGNORE INTO organization_memberships (user_id, organization_id, role) VALUES (?, ?, ?)',
    [user.id, organization.id, 'owner_admin']
  );

  const branchNames = [
    ['Kemang', 'Jakarta Selatan'],
    ['Senopati', 'Jakarta Selatan'],
    ['Bandung', 'Bandung']
  ];
  const branchIds = {};
  for (const [name, city] of branchNames) {
    await database.run('INSERT OR IGNORE INTO branches (organization_id, name, city) VALUES (?, ?, ?)', [organization.id, name, city]);
    const branch = await database.get('SELECT id FROM branches WHERE organization_id = ? AND name = ?', [organization.id, name]);
    branchIds[name] = branch.id;
  }

  const campaignSpecs = [
    { name: 'Glow Season', channel: 'Instagram', objective: 'New customer acquisition', start: 35, end: -10, budget: 12000000, spend: 8750000, status: 'Active', branches: ['Kemang', 'Senopati'] },
    { name: 'Ramadan Ready', channel: 'Meta Ads', objective: 'Consultation bookings', start: 80, end: 20, budget: 8500000, spend: 7900000, status: 'Completed', branches: ['Kemang', 'Bandung'] },
    { name: 'Refer a Friend', channel: 'Referral', objective: 'Referral leads', start: 14, end: -14, budget: 2500000, spend: null, status: 'Active', branches: ['Senopati', 'Bandung'] }
  ];
  const campaignIds = {};
  for (const item of campaignSpecs) {
    let campaign = await database.get('SELECT id FROM campaigns WHERE organization_id = ? AND name = ?', [organization.id, item.name]);
    if (!campaign) {
      const inserted = await database.run(
        `INSERT INTO campaigns
         (organization_id, name, channel, objective, start_date, end_date, planned_budget, actual_spend, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [organization.id, item.name, item.channel, item.objective, dateAgo(item.start), dateAgo(item.end), item.budget, item.spend, item.status]
      );
      campaign = { id: inserted.lastID };
    }
    campaignIds[item.name] = campaign.id;
    for (const branch of item.branches) {
      await database.run(
        'INSERT OR IGNORE INTO campaign_branches (campaign_id, branch_id, organization_id) VALUES (?, ?, ?)',
        [campaign.id, branchIds[branch], organization.id]
      );
    }
  }

  const leadSpecs = [
    ['Alya S.', '081234560101', 'Instagram', 'Glow Season', 'Kemang', 'Purchased', 2, 3],
    ['Dimas R.', '081234560102', 'Instagram', 'Glow Season', 'Senopati', 'Booked', 1, null],
    ['Maya P.', '081234560103', 'Meta Ads', 'Ramadan Ready', 'Bandung', 'Attended', 7, null],
    ['Rani K.', '081234560104', 'Referral', 'Refer a Friend', 'Senopati', 'Contacted', 3, 1],
    ['Nina W.', '081234560105', 'Instagram', 'Glow Season', 'Kemang', 'New', 0, 0],
    ['Fajar H.', '081234560106', 'Meta Ads', 'Ramadan Ready', 'Bandung', 'Lost', 11, null],
    ['Salsa M.', '081234560107', 'Walk-in', '', 'Kemang', 'Purchased', 5, null],
    ['Putri A.', '081234560108', 'Referral', 'Refer a Friend', 'Bandung', 'No-show', 4, null],
    ['Kirana T.', '081234560109', 'Instagram', 'Glow Season', 'Senopati', 'New', 1, 4],
    ['Reza N.', '081234560110', 'Meta Ads', 'Ramadan Ready', 'Bandung', 'Contacted', 6, 2],
    ['Dewi L.', '081234560111', 'Instagram', 'Glow Season', 'Kemang', 'Booked', 8, 3],
    ['Tara B.', '081234560112', 'Referral', 'Refer a Friend', 'Senopati', 'Attended', 9, null]
  ];
  const leadIds = {};
  for (const [name, phone, source, campaign, branch, status, createdAgo, followupAgo] of leadSpecs) {
    let lead = await database.get('SELECT id FROM leads WHERE organization_id = ? AND phone = ?', [organization.id, phone]);
    if (!lead) {
      const inserted = await database.run(
        `INSERT INTO leads
         (organization_id, display_name, phone, source, campaign_id, branch_id, assignee_user_id, status, created_at, next_follow_up_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [organization.id, name, phone, source, campaign ? campaignIds[campaign] : null, branchIds[branch], user.id, status, daysAgo(createdAgo), followupAgo === null ? null : dateAgo(followupAgo), 'Synthetic demo record']
      );
      lead = { id: inserted.lastID };
    }
    leadIds[name] = lead.id;
    const hasActivity = await database.get('SELECT id FROM lead_activities WHERE organization_id = ? AND lead_id = ? LIMIT 1', [organization.id, lead.id]);
    if (!hasActivity) {
      await database.run(
        `INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, to_status, note)
         VALUES (?, ?, ?, 'created', ?, 'Synthetic demo record')`,
        [organization.id, lead.id, user.id, status]
      );
    }
  }

  const transactionSpecs = [
    ['Alya S.', 'Kemang', 'Glow Season', 2, 1250000, 'Paid'],
    ['Alya S.', 'Kemang', 'Glow Season', 0, 850000, 'Paid'],
    ['Maya P.', 'Bandung', 'Ramadan Ready', 5, 1750000, 'Paid'],
    ['Salsa M.', 'Kemang', '', 3, 980000, 'Paid'],
    ['Tara B.', 'Senopati', 'Refer a Friend', 1, 0, 'Cancelled']
  ];
  for (const [index, [leadName, branch, campaign, date, amount, status]] of transactionSpecs.entries()) {
    const reference = `DEMO-${leadName.replace(/[^A-Z]/gi, '').toUpperCase()}-${index + 1}`;
    const existing = await database.get('SELECT id FROM transactions WHERE organization_id = ? AND reference = ?', [organization.id, reference]);
    if (!existing) {
      await database.run(
        `INSERT INTO transactions
         (organization_id, lead_id, branch_id, campaign_id, transaction_date, amount_idr, status, reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [organization.id, leadIds[leadName], branchIds[branch], campaign ? campaignIds[campaign] : null, dateAgo(date), amount, status, reference]
      );
    }
  }

  return { organizationId: organization.id, userId: user.id };
}
