import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, Download, Filter, MessageCircle, Plus, Search, UserRound, Users } from 'lucide-react';
import { api, downloadCsv, downloadExcel, formatDate, formatIDR, todayString, withQuery } from '../lib/api.js';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, LoadingState, PageTitle, Select, StatusBadge, TableWrap } from '../components/UI.jsx';
import { Modal } from '../components/Modal.jsx';

const statuses = ['New', 'Contacted', 'Booked', 'Attended', 'Purchased', 'Lost', 'No-show'];

function LeadForm({ lead, branches, campaigns, members, onClose, onSaved, notify }) {
  const [step, setStep] = useState(0);
  const availableMembers = members.filter((member) => member.is_active || member.id === lead?.assignee_user_id);
  const missingBranch = lead?.branch_id && !branches.some((branch) => branch.id === lead.branch_id);
  const missingCampaign = lead?.campaign_id && !campaigns.some((campaign) => campaign.id === lead.campaign_id);
  const missingMember = lead?.assignee_user_id && !availableMembers.some((member) => member.id === lead.assignee_user_id);
  const [form, setForm] = useState({
    displayName: lead?.display_name || '', phone: lead?.phone || '', source: lead?.source || 'Instagram', status: lead?.status || 'New',
    campaignId: lead?.campaign_id ? String(lead.campaign_id) : '', branchId: lead?.branch_id ? String(lead.branch_id) : '',
    assigneeUserId: lead?.assignee_user_id ? String(lead.assignee_user_id) : '',
    createdDate: lead?.created_at?.slice(0, 10) || todayString(), nextFollowUpDate: lead?.next_follow_up_at?.slice(0, 10) || '',
    notes: lead?.notes || '', whatsappAuthorized: Boolean(lead?.whatsapp_authorized)
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    if (step === 0) { setStep(1); return; }
    setSaving(true); setError('');
    try {
      await api(lead ? `/api/leads/${lead.id}` : '/api/leads', {
        method: lead ? 'PATCH' : 'POST',
        json: { ...form, campaignId: form.campaignId || null, branchId: form.branchId || null, assigneeUserId: form.assigneeUserId || null }
      });
      notify(lead ? 'Lead updated' : 'Lead added');
      onSaved();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={lead ? 'Edit lead' : 'Add lead'} description={step === 0 ? 'Lead details and current status.' : 'Attribution and follow-up details.'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <div className="step-indicator"><span className={step === 0 ? 'current' : 'complete'}>1 <span>Lead details</span></span><i /><span className={step === 1 ? 'current' : ''}>2 <span>Attribution</span></span></div>
        {step === 0 ? <div className="form-stack">
          <Field label="Name or reference"><input autoFocus value={form.displayName} onChange={(event) => update('displayName', event.target.value)} maxLength={120} required placeholder="e.g. Alya S." /></Field>
          <Field label="Contact number" hint="Optional. Personal contact information is visible to your team."><input type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} maxLength={40} placeholder="+62…" /></Field>
          <div className="form-grid two-columns">
            <Field label="Source"><input value={form.source} onChange={(event) => update('source', event.target.value)} maxLength={80} required placeholder="Instagram, walk-in…" /></Field>
            <Field label="Current status"><Select value={form.status} onChange={(event) => update('status', event.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</Select></Field>
          </div>
          <label className="consent-check"><input type="checkbox" checked={form.whatsappAuthorized} onChange={(event) => update('whatsappAuthorized', event.target.checked)} /><span><strong>Lead authorized WhatsApp contact</strong><small>Enables a prefilled WhatsApp link for this lead. Nothing is sent automatically.</small></span></label>
        </div> : <div className="form-stack">
          <div className="form-grid two-columns">
            <Field label="Branch"><Select value={form.branchId} onChange={(event) => {
              update('branchId', event.target.value);
              const selectedCampaign = campaigns.find((campaign) => String(campaign.id) === form.campaignId);
              if (selectedCampaign && event.target.value && !selectedCampaign.branchIds.includes(Number(event.target.value))) update('campaignId', '');
              if (lead?.campaign_id && form.campaignId === String(lead.campaign_id) && event.target.value && Number(event.target.value) !== lead.branch_id && !selectedCampaign) update('campaignId', '');
            }}><option value="">Not assigned</option>{missingBranch && <option value={lead.branch_id}>{lead.branch_name} (archived)</option>}{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select></Field>
            <Field label="Campaign"><Select value={form.campaignId} onChange={(event) => update('campaignId', event.target.value)}><option value="">No campaign linked</option>{missingCampaign && <option value={lead.campaign_id}>{lead.campaign_name} (archived)</option>}{campaigns.filter((campaign) => !form.branchId || campaign.branchIds.includes(Number(form.branchId)) || campaign.id === lead?.campaign_id).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select></Field>
            <Field label="Assigned staff"><Select value={form.assigneeUserId} onChange={(event) => update('assigneeUserId', event.target.value)}><option value="">Unassigned</option>{missingMember && <option value={lead.assignee_user_id}>{lead.assignee_name} (inactive)</option>}{availableMembers.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.displayName}</option>)}</Select></Field>
            <Field label="Created date"><input type="date" value={form.createdDate} onChange={(event) => update('createdDate', event.target.value)} required /></Field>
            <Field label="Next follow-up"><input type="date" value={form.nextFollowUpDate} onChange={(event) => update('nextFollowUpDate', event.target.value)} /></Field>
          </div>
          <Field label="Operational note" hint="Keep notes short and focused on follow-up. Do not enter medical or treatment details."><textarea rows="3" value={form.notes} onChange={(event) => update('notes', event.target.value)} maxLength={500} placeholder="Optional" /></Field>
        </div>}
        <div className="modal-actions modal-actions-between">
          {step === 0 ? <span className="field-hint">Step 1 of 2</span> : <button type="button" className="text-button" onClick={() => { setStep(0); setError(''); }}>Back</button>}
          <div className="modal-actions-right"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{step === 0 ? 'Continue' : lead ? 'Save changes' : 'Add lead'}</Button></div>
        </div>
      </form>
    </Modal>
  );
}

function LeadDetail({ leadId, onClose, onEdit, onArchived, canArchive, organizationName, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true); setError('');
    api(`/api/leads/${leadId}`).then(setData).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [leadId]);
  useEffect(() => { load(); }, [load]);
  const lead = data?.lead;
  const whatsAppUrl = lead?.phone && lead?.whatsapp_authorized
    ? `https://wa.me/${lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${lead.display_name}, this is ${organizationName || 'the clinic team'}. We’re following up on your inquiry. Would you like help with your next step?`)}`
    : '';

  async function archive() {
    if (!window.confirm(`Archive “${lead.display_name}”?`)) return;
    try { await api(`/api/leads/${lead.id}`, { method: 'DELETE' }); notify('Lead archived'); onArchived(); }
    catch (requestError) { notify(requestError.message, 'error'); }
  }

  return (
    <Modal title={lead?.display_name || 'Lead details'} description={lead ? `${lead.branch_name || 'No branch'} · Added ${formatDate(lead.created_at)}` : 'Lead activity and transactions'} onClose={onClose} size="large">
      {loading && !data ? <LoadingState label="Loading lead…" /> : error ? <Alert>{error}</Alert> : lead && <div className="lead-detail-content">
        <div className="detail-topline"><StatusBadge status={lead.status} /><div className="detail-actions"><Button variant="secondary" size="small" onClick={() => onEdit(lead)}>Edit</Button>{canArchive && <Button variant="ghost-danger" size="small" onClick={archive}>Archive</Button>}</div></div>
        <div className="lead-facts"><div><span>Source</span><strong>{lead.source || '—'}</strong></div><div><span>Campaign</span><strong>{lead.campaign_name || 'Not linked'}</strong></div><div><span>Assigned staff</span><strong>{lead.assignee_name || 'Unassigned'}</strong></div><div><span>Next follow-up</span><strong>{formatDate(lead.next_follow_up_at)}</strong></div><div><span>Contact</span><strong>{lead.phone || 'Not provided'}</strong></div><div><span>WhatsApp authorization</span><strong>{lead.whatsapp_authorized ? 'Authorized' : 'Not recorded'}</strong></div></div>
        {whatsAppUrl && <a className="button button-secondary whatsapp-link" href={whatsAppUrl} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Open WhatsApp</a>}
        {lead.notes && <div className="lead-notes"><span>Operational note</span><p>{lead.notes}</p></div>}
        <div className="detail-columns">
          <section><h3>Activity</h3>{data.activities.length ? <div className="activity-list">{data.activities.map((activity) => <div className="activity-item" key={activity.id}><span className="activity-marker" /><div><strong>{activity.activity_type === 'status_changed' ? `${activity.from_status} → ${activity.to_status}` : activity.activity_type.replaceAll('_', ' ')}</strong><p>{activity.note}</p><small>{formatDate(activity.created_at, { hour: 'numeric', minute: '2-digit' })} · {activity.actor_name || 'System'}</small></div></div>)}</div> : <p className="muted">No activity recorded.</p>}</section>
          <section><h3>Transactions</h3>{data.transactions.length ? <div className="compact-record-list">{data.transactions.map((transaction) => <div key={transaction.id}><span><strong>{formatDate(transaction.transaction_date)}</strong><small>{transaction.reference || 'Transaction'}</small></span><span className="record-end"><StatusBadge status={transaction.status} /><strong>{formatIDR(transaction.amount_idr)}</strong></span></div>)}</div> : <p className="muted">No transactions linked.</p>}</section>
        </div>
      </div>}
    </Modal>
  );
}

export function LeadsPage({ user, navigate, notify, selectedId }) {
  const [leads, setLeads] = useState([]);
  const [branches, setBranches] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [source, setSource] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [detailId, setDetailId] = useState(selectedId ? Number(selectedId) : null);
  const [exportModal, setExportModal] = useState(null);
  const canArchive = ['owner_admin', 'manager'].includes(user.role);

  const load = useCallback(() => {
    setLoading(true); setError('');
    Promise.all([
      api(withQuery('/api/leads', { q: search, status, branchId, campaignId, source, assigneeId, from, to })),
      api('/api/branches'), api('/api/campaigns'),
      user.role === 'owner_admin' || user.role === 'manager' ? api('/api/team').catch(() => ({ members: [] })) : Promise.resolve({ members: [] })
    ]).then(([leadResult, branchResult, campaignResult, memberResult]) => {
      setLeads(leadResult.leads); setBranches(branchResult.branches); setCampaigns(campaignResult.campaigns); setMembers(memberResult.members);
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [search, status, branchId, campaignId, source, assigneeId, from, to, user.role]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDetailId(selectedId ? Number(selectedId) : null); }, [selectedId]);

  async function setLeadStatus(lead, nextStatus) {
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', json: {
        displayName: lead.display_name, phone: lead.phone, source: lead.source, campaignId: lead.campaign_id, branchId: lead.branch_id,
        assigneeUserId: lead.assignee_user_id, status: nextStatus, createdDate: lead.created_at.slice(0, 10),
        nextFollowUpDate: lead.next_follow_up_at, notes: lead.notes, whatsappAuthorized: Boolean(lead.whatsapp_authorized)
      } });
      notify(`Lead marked ${nextStatus.toLowerCase()}`); load();
    } catch (requestError) { notify(requestError.message, 'error'); }
  }

  function exportUrl() { return withQuery('/api/export/leads.csv', { q: search, branchId, campaignId, source, assigneeId, status, from, to }); }
  const sources = [...new Set(leads.map((lead) => lead.source).filter(Boolean))];

  return (
    <div className="page-content">
      <PageTitle eyebrow="Pipeline" title="Leads" description="Track source, status, ownership, and follow-up." actions={<>
        <Button variant="secondary" icon={Download} onClick={() => setExportModal({ title: 'Export Leads', url: exportUrl(), filename: 'leads' })}>Export Leads</Button>
        {canArchive && <Button variant="secondary" onClick={() => navigate('import/leads')}>Import CSV</Button>}
        <Button icon={Plus} onClick={() => { setEditingLead(null); setFormOpen(true); }}>Add lead</Button>
      </>} />
      <section className="filter-toolbar lead-filter-toolbar">
        <label className="search-box"><Search size={17} /><input aria-label="Search leads" placeholder="Search name, phone, or source" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="toolbar-select"><span className="sr-only">Lead status</span><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{statuses.map((item) => <option key={item}>{item}</option>)}</Select></label>
        <label className="toolbar-select"><span className="sr-only">Lead branch</span><Select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="toolbar-select"><span className="sr-only">Lead campaign</span><Select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">All campaigns</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="toolbar-select"><span className="sr-only">Lead source</span><Select value={source} onChange={(event) => setSource(event.target.value)}><option value="">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</Select></label>
        {members.length > 0 && <label className="toolbar-select"><span className="sr-only">Assigned staff</span><Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">All assignees</option>{members.map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}</Select></label>}
        <label className="date-filter"><span>From</span><input aria-label="Leads from date" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="date-filter"><span>To</span><input aria-label="Leads to date" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      </section>
      <div className="list-meta"><span><Users size={15} /> {leads.length} leads</span><span><Filter size={14} /> Filters update this list and export</span></div>
      {loading ? <LoadingState label="Loading leads…" /> : error ? <ErrorState message={error} onRetry={load} /> : leads.length ? <section className="panel table-panel">
        <TableWrap><thead><tr><th>Lead</th><th>Campaign / source</th><th>Branch</th><th>Status</th><th>Follow-up</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{leads.map((lead) => <tr key={lead.id}>
            <td><button className="table-primary-link" onClick={() => setDetailId(lead.id)}>{lead.display_name}</button><span className="table-subtext">{lead.phone || 'No contact number'}</span></td>
            <td><strong className="table-secondary-strong">{lead.campaign_name || lead.source || '—'}</strong><span className="table-subtext">{lead.campaign_name ? lead.source : 'No campaign linked'}</span></td>
            <td>{lead.branch_name || '—'}</td>
            <td><label className="sr-only" htmlFor={`lead-status-${lead.id}`}>Set status for {lead.display_name}</label><select id={`lead-status-${lead.id}`} className="status-select" value={lead.status} onChange={(event) => setLeadStatus(lead, event.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></td>
            <td><span className="followup-cell"><CalendarClock size={15} /> {formatDate(lead.next_follow_up_at)}</span></td><td>{formatDate(lead.created_at)}</td>
            <td><div className="table-actions"><button className="text-button" onClick={() => { setEditingLead(lead); setFormOpen(true); }}>Edit</button><button className="table-arrow" aria-label={`View ${lead.display_name}`} onClick={() => setDetailId(lead.id)}><ArrowRight size={17} /></button></div></td>
          </tr>)}</tbody>
        </TableWrap>
      </section> : <section className="panel"><EmptyState icon={UserRound} title={search || status || branchId || campaignId || source || assigneeId || from || to ? 'No leads match these filters' : 'Add your first lead'} description={search || status || branchId || campaignId || source || assigneeId || from || to ? 'Try changing a filter or search term.' : 'Link leads to campaigns and branches to understand where interest comes from.'} action={!search && !status && !branchId && !campaignId && !source && !assigneeId && !from && !to && <Button icon={Plus} onClick={() => setFormOpen(true)}>Add lead</Button>} /></section>}
      {formOpen && <LeadForm lead={editingLead} branches={branches} campaigns={campaigns} members={members} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} notify={notify} />}
      {detailId && <LeadDetail leadId={detailId} onClose={() => { setDetailId(null); navigate('leads'); }} onEdit={(lead) => { setDetailId(null); navigate('leads'); setEditingLead(lead); setFormOpen(true); }} onArchived={() => { setDetailId(null); navigate('leads'); load(); }} canArchive={canArchive} organizationName={user.organizationName} notify={notify} />}
      {exportModal && <Modal title={exportModal.title} description="Choose the file format for this export." onClose={() => setExportModal(null)}>
        <div className="export-choice-grid">
          <Button variant="secondary" onClick={() => { downloadCsv(exportModal.url, `${exportModal.filename}.csv`); setExportModal(null); }}>Download CSV</Button>
          <Button onClick={() => { downloadExcel(exportModal.url, `${exportModal.filename}.xlsx`); setExportModal(null); }}>Download Excel</Button>
        </div>
      </Modal>}
    </div>
  );
}
