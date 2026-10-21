import { useCallback, useEffect, useState } from 'react';
import { Building2, MapPin, Plus, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, EmptyState, ErrorState, Field, LoadingState, PageTitle, TableWrap } from '../components/UI.jsx';
import { Modal } from '../components/Modal.jsx';

function BranchForm({ branch, onClose, onSaved, notify }) {
  const [name, setName] = useState(branch?.name || '');
  const [city, setCity] = useState(branch?.city || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api(branch ? `/api/branches/${branch.id}` : '/api/branches', { method: branch ? 'PATCH' : 'POST', json: { name, city } });
      notify(branch ? 'Branch updated' : 'Branch created'); onSaved();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }
  return <Modal title={branch ? 'Edit branch' : 'Add branch'} description="Branch names are used to filter campaign and lead reporting." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>{error && <div className="alert alert-error">{error}</div>}
      <Field label="Branch name"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required placeholder="e.g. Kemang" /></Field>
      <Field label="City"><input value={city} onChange={(event) => setCity(event.target.value)} maxLength={100} placeholder="Optional" /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{branch ? 'Save changes' : 'Add branch'}</Button></div>
    </form>
  </Modal>;
}

export function BranchesPage({ user, notify }) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const canManage = ['owner_admin', 'manager'].includes(user.role);
  const load = useCallback(() => {
    setLoading(true); setError('');
    api('/api/branches').then((result) => setBranches(result.branches)).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  async function archive(branch) {
    if (!window.confirm(`Archive “${branch.name}”? Existing lead and transaction records will remain.`)) return;
    try { await api(`/api/branches/${branch.id}`, { method: 'DELETE' }); notify('Branch archived'); load(); }
    catch (requestError) { notify(requestError.message, 'error'); }
  }

  return <div className="page-content">
    <PageTitle eyebrow="Organization" title="Branches" description="Manage locations used for campaign and lead reporting." actions={canManage && <Button icon={Plus} onClick={() => { setEditing(null); setFormOpen(true); }}>Add branch</Button>} />
    <div className="branch-summary-strip"><span><Building2 size={17} /> <strong>{branches.length}</strong> active branches</span><span><Users size={17} /> Branch filters apply to leads and transactions</span></div>
    {loading ? <LoadingState label="Loading branches…" /> : error ? <ErrorState message={error} onRetry={load} /> : branches.length ? <section className="panel table-panel">
      <TableWrap><thead><tr><th>Branch</th><th>City</th><th>Leads recorded</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}>
        <td><span className="branch-name-cell"><span className="branch-avatar"><Building2 size={16} /></span><strong>{branch.name}</strong></span></td>
        <td><span className="muted-inline">{branch.city ? <><MapPin size={14} /> {branch.city}</> : '—'}</span></td><td>{branch.lead_count}</td>
        <td><div className="table-actions">{canManage && <><button className="text-button" onClick={() => { setEditing(branch); setFormOpen(true); }}>Edit</button><button className="text-button danger-text" onClick={() => archive(branch)}>Archive</button></>}</div></td>
      </tr>)}</tbody></TableWrap>
    </section> : <section className="panel"><EmptyState icon={Building2} title="Add your first branch" description="Branches help your team compare campaign outcomes across locations." action={canManage && <Button icon={Plus} onClick={() => setFormOpen(true)}>Add branch</Button>} /></section>}
    {formOpen && <BranchForm branch={editing} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} notify={notify} />}
  </div>;
}
