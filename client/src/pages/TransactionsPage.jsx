import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CircleDollarSign, Download, Plus, Search } from 'lucide-react';
import { api, downloadCsv, formatDate, formatIDR, todayString, withQuery } from '../lib/api.js';
import { Button, EmptyState, ErrorState, Field, LoadingState, PageTitle, Select, StatusBadge, TableWrap } from '../components/UI.jsx';
import { Modal } from '../components/Modal.jsx';

function TransactionForm({ transaction, leads, branches, campaigns, onClose, onSaved, notify }) {
  const missingLead = transaction?.lead_id && !leads.some((lead) => lead.id === transaction.lead_id);
  const missingBranch = transaction?.branch_id && !branches.some((branch) => branch.id === transaction.branch_id);
  const missingCampaign = transaction?.campaign_id && !campaigns.some((campaign) => campaign.id === transaction.campaign_id);
  const [form, setForm] = useState({
    leadId: transaction?.lead_id ? String(transaction.lead_id) : '',
    branchId: transaction?.branch_id ? String(transaction.branch_id) : branches[0]?.id ? String(branches[0].id) : '',
    campaignId: transaction?.campaign_id ? String(transaction.campaign_id) : '',
    transactionDate: transaction?.transaction_date || todayString(),
    amountIdr: transaction?.amount_idr ?? '', status: transaction?.status || 'Paid', reference: transaction?.reference || ''
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      await api(transaction ? `/api/transactions/${transaction.id}` : '/api/transactions', {
        method: transaction ? 'PATCH' : 'POST', json: { ...form, leadId: form.leadId || null, campaignId: form.campaignId || null, amountIdr: Number(form.amountIdr) }
      });
      notify(transaction ? 'Transaction updated' : 'Transaction recorded'); onSaved();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={transaction ? 'Edit transaction' : 'Record transaction'} description="Record the payment outcome and connect it to a lead or campaign." onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {error && <div className="alert alert-error">{error}</div>}
        <Field label="Branch"><Select value={form.branchId} onChange={(event) => {
          update('branchId', event.target.value);
          const selectedCampaign = campaigns.find((campaign) => String(campaign.id) === form.campaignId);
          if (selectedCampaign && event.target.value && !selectedCampaign.branchIds.includes(Number(event.target.value))) update('campaignId', '');
          if (transaction?.campaign_id && form.campaignId === String(transaction.campaign_id) && event.target.value && Number(event.target.value) !== transaction.branch_id && !selectedCampaign) update('campaignId', '');
        }} required><option value="">Select branch</option>{missingBranch && <option value={transaction.branch_id}>{transaction.branch_name} (archived)</option>}{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select></Field>
        <div className="form-grid two-columns">
          <Field label="Lead reference"><Select value={form.leadId} onChange={(event) => {
            const selected = leads.find((lead) => String(lead.id) === event.target.value);
            update('leadId', event.target.value);
            if (selected?.campaign_id) update('campaignId', String(selected.campaign_id));
            if (selected?.branch_id) update('branchId', String(selected.branch_id));
          }}><option value="">No linked lead</option>{missingLead && <option value={transaction.lead_id}>{transaction.lead_name} (archived)</option>}{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.display_name}{lead.phone ? ` · ${lead.phone}` : ''}</option>)}</Select></Field>
          <Field label="Campaign"><Select value={form.campaignId} onChange={(event) => update('campaignId', event.target.value)}><option value="">No campaign linked</option>{missingCampaign && <option value={transaction.campaign_id}>{transaction.campaign_name} (archived)</option>}{campaigns.filter((campaign) => !form.branchId || campaign.branchIds.includes(Number(form.branchId)) || campaign.id === transaction?.campaign_id).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select></Field>
          <Field label="Transaction date"><input type="date" value={form.transactionDate} onChange={(event) => update('transactionDate', event.target.value)} required /></Field>
          <Field label="Amount (IDR)"><input type="number" inputMode="numeric" min="0" step="1" value={form.amountIdr} onChange={(event) => update('amountIdr', event.target.value)} required /></Field>
          <Field label="Status"><Select value={form.status} onChange={(event) => update('status', event.target.value)}>{['Paid', 'Refunded', 'Cancelled'].map((status) => <option key={status}>{status}</option>)}</Select></Field>
          <Field label="Receipt / reference"><input value={form.reference} onChange={(event) => update('reference', event.target.value)} maxLength={80} placeholder="Optional" /></Field>
        </div>
        <div className="form-note">Paid transactions update a linked lead to Purchased. Refunded and cancelled records are excluded from revenue.</div>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={!branches.length}>{transaction ? 'Save changes' : 'Save transaction'}</Button></div>
      </form>
    </Modal>
  );
}

export function TransactionsPage({ user, navigate, notify }) {
  const [transactions, setTransactions] = useState([]);
  const [leads, setLeads] = useState([]);
  const [branches, setBranches] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError('');
    Promise.all([
      api(withQuery('/api/transactions', { q: search, status, branchId, campaignId, from, to })),
      api('/api/leads'), api('/api/branches'), api('/api/campaigns')
    ]).then(([txResult, leadResult, branchResult, campaignResult]) => {
      setTransactions(txResult.transactions); setLeads(leadResult.leads); setBranches(branchResult.branches); setCampaigns(campaignResult.campaigns);
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [search, status, branchId, campaignId, from, to]);
  useEffect(() => { load(); }, [load]);

  const visible = transactions;
  const paidTotal = visible.filter((item) => item.status === 'Paid' && item.campaign_id != null).reduce((sum, item) => sum + item.amount_idr, 0);

  return (
    <div className="page-content">
      <PageTitle eyebrow="Revenue records" title="Transactions" description="Record payment outcomes linked to leads, campaigns, and branches." actions={<>
        <Button variant="secondary" icon={Download} onClick={() => downloadCsv(withQuery('/api/export/transactions.csv', { q: search, status, branchId, campaignId, from, to }))}>Export CSV</Button>
        {['owner_admin', 'manager'].includes(user.role) && <Button variant="secondary" onClick={() => navigate('import/transactions')}>Import CSV</Button>}
        <Button icon={Plus} onClick={() => { setEditing(null); setFormOpen(true); }}>Record transaction</Button>
      </>} />
      <section className="filter-toolbar">
        <label className="search-box"><Search size={17} /><input aria-label="Search transactions" placeholder="Search lead, campaign, or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="toolbar-select"><span className="sr-only">Transaction status</span><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['Paid', 'Refunded', 'Cancelled'].map((item) => <option key={item}>{item}</option>)}</Select></label>
        <label className="toolbar-select"><span className="sr-only">Transaction branch</span><Select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="toolbar-select"><span className="sr-only">Transaction campaign</span><Select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">All campaigns</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="date-filter"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} aria-label="Transactions from date" /></label>
        <label className="date-filter"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} aria-label="Transactions to date" /></label>
      </section>
      <div className="list-meta"><span><CircleDollarSign size={16} /> {visible.length} transactions</span><span>Campaign-linked paid revenue in view <strong>{formatIDR(paidTotal)}</strong></span></div>
      {loading ? <LoadingState label="Loading transactions…" /> : error ? <ErrorState message={error} onRetry={load} /> : visible.length ? <section className="panel table-panel">
        <TableWrap><thead><tr><th>Date</th><th>Lead / reference</th><th>Campaign</th><th>Branch</th><th>Amount</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {visible.map((item) => <tr key={item.id}>
            <td>{formatDate(item.transaction_date)}</td><td><strong className="table-secondary-strong">{item.lead_name || item.reference || 'Unlinked'}</strong>{item.reference && item.lead_name && <span className="table-subtext">{item.reference}</span>}</td>
            <td>{item.campaign_name || '—'}</td><td>{item.branch_name || '—'}</td><td><strong>{formatIDR(item.amount_idr)}</strong></td><td><StatusBadge status={item.status} /></td>
            <td><div className="table-actions"><button className="text-button" onClick={() => { setEditing(item); setFormOpen(true); }}>Edit</button><button className="table-arrow" aria-label={`Edit transaction ${item.id}`} onClick={() => { setEditing(item); setFormOpen(true); }}><ArrowRight size={17} /></button></div></td>
          </tr>)}
        </tbody></TableWrap>
      </section> : <section className="panel"><EmptyState icon={CircleDollarSign} title="No transactions found" description="Record paid, refunded, or cancelled transactions without storing payment credentials." action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Record transaction</Button>} /></section>}
      {formOpen && <TransactionForm transaction={editing} leads={leads} branches={branches} campaigns={campaigns} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} notify={notify} />}
    </div>
  );
}
