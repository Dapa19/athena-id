import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Megaphone, Plus, Search } from 'lucide-react';
import { api, downloadCsv, formatDate, formatIDR, todayString, withQuery } from '../lib/api.js';
import { Badge, Button, EmptyState, ErrorState, Field, LoadingState, PageTitle, Select, StatusBadge, TableWrap } from '../components/UI.jsx';
import { Modal } from '../components/Modal.jsx';

const today = todayString;
const plusDays = (count) => {
  const date = new Date(`${today()}T12:00:00+07:00`);
  date.setDate(date.getDate() + count);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function CampaignForm({ campaign, branches, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    name: campaign?.name || '', channel: campaign?.channel || 'Instagram', objective: campaign?.objective || '',
    startDate: campaign?.start_date || today(), endDate: campaign?.end_date || plusDays(30),
    plannedBudget: campaign?.planned_budget ?? 0, actualSpend: campaign?.actual_spend ?? '',
    status: campaign?.status || 'Draft', branchIds: campaign?.branchIds || []
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function change(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  function toggleBranch(id) { setForm((current) => ({ ...current, branchIds: current.branchIds.includes(id) ? current.branchIds.filter((value) => value !== id) : [...current.branchIds, id] })); }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api(campaign ? `/api/campaigns/${campaign.id}` : '/api/campaigns', {
        method: campaign ? 'PATCH' : 'POST', json: { ...form, plannedBudget: Number(form.plannedBudget), actualSpend: form.actualSpend === '' ? null : Number(form.actualSpend) }
      });
      notify(campaign ? 'Campaign updated' : 'Campaign created');
      onSaved();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={campaign ? 'Edit campaign' : 'Create campaign'} description="Campaign details and the branches it applies to." onClose={onClose} size="large">
      <form className="form-stack" onSubmit={submit}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid two-columns">
          <Field label="Campaign name"><input value={form.name} onChange={(event) => change('name', event.target.value)} required maxLength={120} autoFocus /></Field>
          <Field label="Channel / source"><input value={form.channel} onChange={(event) => change('channel', event.target.value)} required maxLength={80} placeholder="Instagram, referral…" /></Field>
          <Field label="Start date"><input type="date" value={form.startDate} onChange={(event) => change('startDate', event.target.value)} required /></Field>
          <Field label="End date"><input type="date" value={form.endDate} onChange={(event) => change('endDate', event.target.value)} min={form.startDate} required /></Field>
          <Field label="Planned budget (IDR)"><input type="number" min="0" step="1" inputMode="numeric" value={form.plannedBudget} onChange={(event) => change('plannedBudget', event.target.value)} required /></Field>
          <Field label="Actual spend (IDR)" hint="Leave blank until recorded."><input type="number" min="0" step="1" inputMode="numeric" value={form.actualSpend} onChange={(event) => change('actualSpend', event.target.value)} /></Field>
          <Field label="Objective"><input value={form.objective} onChange={(event) => change('objective', event.target.value)} maxLength={180} placeholder="Optional" /></Field>
          <Field label="Status"><Select value={form.status} onChange={(event) => change('status', event.target.value)}>{['Draft', 'Active', 'Completed'].map((status) => <option key={status}>{status}</option>)}</Select></Field>
        </div>
        <fieldset className="branch-checkboxes"><legend>Branches <span>Choose at least one</span></legend>
          {branches.length ? <div className="checkbox-row">{branches.map((branch) => <label key={branch.id} className="checkbox-option"><input type="checkbox" checked={form.branchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} /><span>{branch.name}</span></label>)}</div> : <p className="field-hint">Add a branch before creating a campaign.</p>}
        </fieldset>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={!branches.length}>{campaign ? 'Save changes' : 'Create campaign'}</Button></div>
      </form>
    </Modal>
  );
}

function CampaignDetail({ campaignId, navigate, canManage, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [branches, setBranches] = useState([]);
  const load = useCallback(() => {
    setLoading(true); setError('');
    Promise.all([api(`/api/campaigns/${campaignId}`), api('/api/branches')])
      .then(([result, branchResult]) => { setData(result); setBranches(branchResult.branches); })
      .catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [campaignId]);
  useEffect(() => { load(); }, [load]);
  if (loading && !data) return <LoadingState label="Loading campaign…" />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;
  const { campaign, leads, transactions, summary } = data;
  const revenue = summary?.paid_revenue || 0;
  const editCampaign = { ...campaign, branchIds: campaign.branches.filter((branch) => !branch.archived).map((branch) => branch.id) };
  async function archive() {
    if (!window.confirm(`Archive “${campaign.name}”? Historical records will remain available.`)) return;
    try { await api(`/api/campaigns/${campaign.id}`, { method: 'DELETE' }); notify('Campaign archived'); navigate('campaigns'); }
    catch (requestError) { notify(requestError.message, 'error'); }
  }
  return (
    <div className="page-content">
      <button className="back-link" onClick={() => navigate('campaigns')}><ArrowLeft size={16} /> Campaigns</button>
      <PageTitle eyebrow={campaign.channel} title={campaign.name} description={campaign.objective || 'Campaign results and linked records.'} actions={<>
        {canManage && campaign.status !== 'Archived' && <button className="button button-secondary" onClick={() => setEditing(true)}>Edit campaign</button>}
        {canManage && campaign.status !== 'Archived' && <button className="button button-ghost-danger" onClick={archive}>Archive</button>}
      </>} />
      {error && <div className="inline-error">{error}</div>}
      <div className="detail-metrics">
        <div><span>Status</span><StatusBadge status={campaign.status} /></div>
        <div><span>Campaign period</span><strong>{formatDate(campaign.start_date)} – {formatDate(campaign.end_date)}</strong></div>
        <div><span>Planned budget</span><strong>{formatIDR(campaign.planned_budget)}</strong></div>
        <div><span>Actual spend</span><strong>{formatIDR(campaign.actual_spend)}</strong></div>
        <div><span>Linked leads</span><strong>{summary?.lead_count || 0}</strong></div>
        <div><span>Paid attributed revenue</span><strong>{formatIDR(revenue)}</strong></div>
        <div><span>Cost per lead</span><strong>{summary?.lead_count && campaign.actual_spend != null ? formatIDR(campaign.actual_spend / summary.lead_count) : '—'}</strong></div>
      </div>
      <div className="tag-row">{campaign.branches.map((branch) => <Badge key={branch.id} tone={branch.archived ? 'neutral' : 'blue'}>{branch.name}{branch.archived ? ' · archived' : ''}</Badge>)}</div>
      <div className="dashboard-grid detail-grid">
        <section className="panel"><div className="panel-heading"><div><h2>Linked leads</h2><p>{leads.length} records</p></div></div>
          {leads.length ? <><div className="compact-record-list">{leads.map((lead) => <button key={lead.id} onClick={() => navigate(`leads/${lead.id}`)}><span><strong>{lead.display_name}</strong><small>{lead.branch_name || 'No branch'} · {formatDate(lead.created_at)}</small></span><StatusBadge status={lead.status} /></button>)}</div>{summary?.lead_count > leads.length && <p className="panel-footnote">Showing the 100 most recent of {summary.lead_count} leads.</p>}</> : <EmptyState icon={ContactRound} title="No linked leads" description="Add leads and choose this campaign as their source." action={<button className="button button-secondary button-small" onClick={() => navigate('leads')}>Open leads</button>} />}
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Transactions</h2><p>{transactions.length} records</p></div></div>
          {transactions.length ? <><div className="compact-record-list">{transactions.map((transaction) => <div key={transaction.id}><span><strong>{transaction.lead_name || transaction.reference || 'Unlinked transaction'}</strong><small>{transaction.branch_name || 'No branch'} · {formatDate(transaction.transaction_date)}</small></span><span className="record-end"><StatusBadge status={transaction.status} /><strong>{formatIDR(transaction.amount_idr)}</strong></span></div>)}</div>{summary?.transaction_count > transactions.length && <p className="panel-footnote">Showing the 100 most recent of {summary.transaction_count} transactions.</p>}</> : <EmptyState title="No campaign transactions" description="Record a transaction and link it to this campaign." action={<button className="button button-secondary button-small" onClick={() => navigate('transactions')}>Record transaction</button>} />}
        </section>
      </div>
      <div className="metric-footnote">Attributed revenue includes only paid transactions explicitly linked to this campaign. Refunded and cancelled transactions are excluded.</div>
      {editing && <CampaignForm campaign={editCampaign} branches={branches} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} notify={notify} />}
    </div>
  );
}

export function CampaignsPage({ user, navigate, selectedId, notify }) {
  const [campaigns, setCampaigns] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const canManage = ['owner_admin', 'manager'].includes(user.role);
  const load = useCallback(() => {
    setLoading(true); setError('');
    Promise.all([api(withQuery('/api/campaigns', { q: search, status, branchId })), api('/api/branches')])
      .then(([campaignResult, branchResult]) => { setCampaigns(campaignResult.campaigns); setBranches(branchResult.branches); })
      .catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [search, status, branchId]);
  useEffect(() => { load(); }, [load]);

  if (selectedId) return <CampaignDetail campaignId={selectedId} navigate={navigate} canManage={canManage} notify={notify} />;

  async function archive(item) {
    if (!window.confirm(`Archive “${item.name}”? Historical records will remain available.`)) return;
    try { await api(`/api/campaigns/${item.id}`, { method: 'DELETE' }); notify('Campaign archived'); load(); }
    catch (requestError) { notify(requestError.message, 'error'); }
  }

  return (
    <div className="page-content">
      <PageTitle eyebrow="Acquisition" title="Campaigns" description="Plan campaigns and compare their recorded outcomes." actions={<>
        {canManage && <Button variant="secondary" icon={Download} onClick={() => downloadCsv(withQuery('/api/export/campaign-performance.csv', { q: search, status, branchId }))}>Export performance</Button>}
        {canManage && <Button icon={Plus} onClick={() => { setEditingCampaign(null); setFormOpen(true); }}>New campaign</Button>}
      </>} />
      <section className="filter-toolbar">
        <label className="search-box"><Search size={17} /><input aria-label="Search campaigns" placeholder="Search campaigns" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="toolbar-select"><span className="sr-only">Campaign status</span><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['Draft', 'Active', 'Completed'].map((item) => <option key={item}>{item}</option>)}</Select></label>
        <label className="toolbar-select"><span className="sr-only">Filter by branch</span><Select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      </section>
      {loading ? <LoadingState label="Loading campaigns…" /> : error ? <ErrorState message={error} onRetry={load} /> : campaigns.length ? (
        <section className="panel table-panel">
          <TableWrap><thead><tr><th>Campaign</th><th>Channel</th><th>Branches</th><th>Period</th><th>Planned budget</th><th>Actual spend</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{campaigns.map((item) => <tr key={item.id}>
              <td><button className="table-primary-link" onClick={() => navigate(`campaigns/${item.id}`)}>{item.name}</button><span className="table-subtext">{item.objective || '—'}</span></td>
              <td>{item.channel}</td><td><span className="branch-pills">{item.branches.map((branch) => <Badge key={branch.id}>{branch.name}{branch.archived ? ' · archived' : ''}</Badge>)}</span></td>
              <td>{formatDate(item.start_date)} – {formatDate(item.end_date)}</td><td>{formatIDR(item.planned_budget)}</td><td>{formatIDR(item.actual_spend)}</td><td><StatusBadge status={item.status} /></td>
              <td><div className="table-actions">{canManage && <button className="text-button" onClick={() => { setEditingCampaign(item); setFormOpen(true); }}>Edit</button>}{canManage && <button className="text-button danger-text" onClick={() => archive(item)}>Archive</button>}<button className="table-arrow" aria-label={`View ${item.name}`} onClick={() => navigate(`campaigns/${item.id}`)}><ArrowRight size={17} /></button></div></td>
            </tr>)}</tbody>
          </TableWrap>
        </section>
      ) : <section className="panel"><EmptyState icon={Megaphone} title={search || status || branchId ? 'No matching campaigns' : 'Start with a campaign'} description={search || status || branchId ? 'Try changing your search or filters.' : 'Record campaign dates, budget, spend, and branches to track real outcomes.'} action={canManage && !search && !status && !branchId ? <Button icon={Plus} onClick={() => setFormOpen(true)}>Create campaign</Button> : null} /></section>}
      {formOpen && <CampaignForm campaign={editingCampaign} branches={branches} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} notify={notify} />}
    </div>
  );
}
