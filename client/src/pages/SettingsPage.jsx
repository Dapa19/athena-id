import { useCallback, useEffect, useState } from 'react';
import { Building2, ImagePlus, KeyRound, Plus, ShieldCheck, UserCog, Users } from 'lucide-react';
import { api, formatDate } from '../lib/api.js';
import { Badge, Button, EmptyState, ErrorState, Field, LoadingState, PageTitle, Select, TableWrap } from '../components/UI.jsx';
import { Modal } from '../components/Modal.jsx';

const TIMEZONE_OPTIONS = [
  'Africa/Johannesburg', 'America/Los_Angeles', 'America/New_York', 'Asia/Jakarta', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney', 'Europe/Berlin', 'Europe/London', 'Pacific/Auckland'
];

function MemberForm({ onClose, onSaved, notify }) {
  const [form, setForm] = useState({ displayName: '', email: '', password: '', role: 'staff' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await api('/api/team', { method: 'POST', json: form }); notify('Team member added'); onSaved(); }
    catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }
  return <Modal title="Add team member" description="Create an account for an existing teammate." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>{error && <div className="alert alert-error">{error}</div>}
      <Field label="Name"><input autoFocus value={form.displayName} onChange={(event) => update('displayName', event.target.value)} maxLength={100} required /></Field>
      <Field label="Work email"><input type="email" autoComplete="off" value={form.email} onChange={(event) => update('email', event.target.value)} maxLength={254} required /></Field>
      <Field label="Initial password" hint="At least 10 characters. Share it with the teammate through a secure channel."><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => update('password', event.target.value)} minLength={10} maxLength={200} required /></Field>
      <Field label="Role"><Select value={form.role} onChange={(event) => update('role', event.target.value)}><option value="staff">Staff</option><option value="manager">Manager</option><option value="owner_admin">Owner / Admin</option></Select></Field>
      <div className="permission-summary"><ShieldCheck size={17} /><span>Staff can update leads and transactions. Managers can manage campaigns and branches. Owner/Admin manages users and settings.</span></div>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Create account</Button></div>
    </form>
  </Modal>;
}

export function SettingsPage({ user, onUserUpdate, notify }) {
  const [organization, setOrganization] = useState(null);
  const [members, setMembers] = useState([]);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [logoError, setLogoError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [savingMember, setSavingMember] = useState(null);
  const load = useCallback(() => {
    setLoading(true); setError('');
    Promise.all([api('/api/settings'), api('/api/team')]).then(([settings, team]) => {
      const org = settings.organization || {};
      setOrganization(org); setName(org.name || ''); setTimezone(org.timezone || 'Asia/Jakarta'); setLogoDataUrl(org.logo_url || ''); setMembers(team.members);
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  function handleLogoSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setLogoError('Only PNG, JPG, GIF, or WEBP images are supported.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const isSquare = file.type !== 'image/svg+xml';
      if (isSquare && result.length > 0) {
        const image = new Image();
        image.onload = () => {
          if (image.width !== image.height) {
            setLogoError('Upload a square logo with a 1:1 ratio.');
            return;
          }
          setLogoError('');
          setLogoDataUrl(result);
        };
        image.onerror = () => setLogoError('Could not read the selected image.');
        image.src = result;
      } else {
        setLogoError('');
        setLogoDataUrl(result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveOrganization(event) {
    event.preventDefault(); setSavingOrg(true); setLogoError('');
    try {
      const result = await api('/api/settings', { method: 'PATCH', json: { name, timezone, logoDataUrl: logoDataUrl || undefined } });
      setOrganization(result.organization);
      setTimezone(result.organization.timezone || 'Asia/Jakarta');
      setLogoDataUrl(result.organization.logo_url || '');
      onUserUpdate?.({ organizationName: result.organization.name, organizationLogo: result.organization.logo_url || null });
      notify('Organization settings saved');
    }
    catch (requestError) { notify(requestError.message, 'error'); }
    finally { setSavingOrg(false); }
  }
  async function updateMember(member, payload) {
    setSavingMember(member.id);
    try { await api(`/api/team/${member.id}`, { method: 'PATCH', json: payload }); notify('Team access updated'); load(); }
    catch (requestError) { notify(requestError.message, 'error'); load(); }
    finally { setSavingMember(null); }
  }

  if (loading) return <div className="page-content"><LoadingState label="Loading organization settings…" /></div>;
  if (error) return <div className="page-content"><ErrorState message={error} onRetry={load} /></div>;

  return <div className="page-content">
    <PageTitle eyebrow="Workspace" title="Team & settings" description="Manage organization details and team access." />
    <section className="settings-section panel">
      <div className="settings-section-heading"><span className="settings-icon"><Building2 size={19} /></span><div><h2>Organization</h2><p>Workspace identity, branding, and timezone preference.</p></div></div>
      <form className="organization-form organization-form-stack" onSubmit={saveOrganization}>
        <Field label="Organization name"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></Field>
        <Field label="Default timezone"><Select value={timezone} onChange={(event) => setTimezone(event.target.value)}>{TIMEZONE_OPTIONS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select></Field>
        <div className="organization-logo-field">
          <span className="field-label">Organization logo</span>
          <div className="organization-logo-card">
            <div className="organization-logo-preview-shell">
              {logoDataUrl ? <img src={logoDataUrl} alt="Organization logo preview" className="organization-logo-preview" /> : <div className="organization-logo-empty"><ImagePlus size={18} /><span>Upload logo</span></div>}
            </div>
            <div className="organization-logo-actions">
              <label className="upload-button button button-secondary button-small" htmlFor="org-logo-upload">
                <input id="org-logo-upload" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleLogoSelect} />
                {logoDataUrl ? 'Change file' : 'Choose file'}
              </label>
              {logoDataUrl && <button type="button" className="text-button danger-text" onClick={() => { setLogoDataUrl(''); setLogoError(''); const input = document.getElementById('org-logo-upload'); if (input) input.value = ''; }}>Remove image</button>}
            </div>
          </div>
          {logoError && <span className="inline-error inline-error-small">{logoError}</span>}
          <span className="field-hint">Use a 1:1 image. PNG, JPG, GIF, and WEBP are supported.</span>
        </div>
        <div className="organization-save"><Button type="submit" loading={savingOrg}>Save settings</Button></div>
      </form>
      <div className="settings-created">Workspace created {formatDate(organization?.created_at)} · ID {organization?.id}</div>
    </section>

    <section className="settings-section panel">
      <div className="settings-section-heading settings-team-heading"><span className="settings-icon"><Users size={19} /></span><div><h2>Team members</h2><p>Only Owner/Admin can change roles or deactivate accounts.</p></div><Button icon={Plus} onClick={() => setFormOpen(true)}>Add member</Button></div>
      {members.length ? <TableWrap><thead><tr><th>Team member</th><th>Role</th><th>Status</th><th>Added</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {members.map((member) => <tr key={member.id} className={!member.is_active ? 'row-muted' : ''}>
          <td><strong className="table-secondary-strong">{member.display_name}{member.id === user.id && <span className="you-tag">You</span>}</strong><span className="table-subtext">{member.email}</span></td>
          <td><label className="sr-only" htmlFor={`member-role-${member.id}`}>Role for {member.display_name}</label><Select id={`member-role-${member.id}`} value={member.role} disabled={savingMember === member.id} onChange={(event) => updateMember(member, { role: event.target.value })}><option value="owner_admin">Owner / Admin</option><option value="manager">Manager</option><option value="staff">Staff</option></Select></td>
          <td><Badge tone={member.is_active ? 'green' : 'neutral'}>{member.is_active ? 'Active' : 'Inactive'}</Badge></td>
          <td>{formatDate(member.created_at)}</td><td>{member.id !== user.id && <button className={`text-button${member.is_active ? ' danger-text' : ''}`} disabled={savingMember === member.id} onClick={() => updateMember(member, { isActive: !member.is_active })}>{member.is_active ? 'Deactivate' : 'Reactivate'}</button>}</td>
        </tr>)}
      </tbody></TableWrap> : <EmptyState icon={UserCog} title="No other team members" description="Add staff and managers to share the workspace." action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Add member</Button>} />}
    </section>

    <section className="security-note"><KeyRound size={18} /><div><strong>Security and data handling</strong><p>Passwords are stored as hashes. Lead and transaction exports are available from their lists. Back up or delete the local SQLite database using the procedures in the README.</p></div></section>
    {formOpen && <MemberForm onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} notify={notify} />}
  </div>;
}
