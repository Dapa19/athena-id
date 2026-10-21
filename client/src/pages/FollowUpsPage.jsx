import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Clock3, MessageCircle, RotateCcw, UserRound } from 'lucide-react';
import { api, formatDate, todayString } from '../lib/api.js';
import { Button, EmptyState, ErrorState, LoadingState, PageTitle, StatusBadge } from '../components/UI.jsx';

const addDays = (value, amount) => {
  const date = new Date(`${value}T12:00:00+07:00`);
  date.setDate(date.getDate() + amount);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function whatsappUrl(lead, organizationName) {
  if (!lead.phone || !lead.whatsapp_authorized) return '';
  const message = `Hi ${lead.display_name}, this is ${organizationName || 'the clinic team'}. We’re following up on your inquiry. Would you like help with your next step?`;
  return `https://wa.me/${lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

export function FollowUpsPage({ user, navigate, notify }) {
  const [followUps, setFollowUps] = useState([]);
  const [until, setUntil] = useState(addDays(todayString(), 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rescheduling, setRescheduling] = useState(null);
  const [nextDate, setNextDate] = useState('');
  const [savingId, setSavingId] = useState(null);
  const today = todayString();
  const load = useCallback(() => {
    setLoading(true); setError('');
    api(`/api/follow-ups?until=${encodeURIComponent(until)}`).then((result) => setFollowUps(result.followUps)).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [until]);
  useEffect(() => { load(); }, [load]);

  async function complete(id) {
    setSavingId(id);
    try { await api(`/api/leads/${id}/follow-up`, { method: 'POST', json: { date: null } }); notify('Follow-up completed'); load(); }
    catch (requestError) { notify(requestError.message, 'error'); }
    finally { setSavingId(null); }
  }
  async function reschedule(id) {
    if (!nextDate) return;
    setSavingId(id);
    try { await api(`/api/leads/${id}/follow-up`, { method: 'POST', json: { date: nextDate } }); notify('Follow-up rescheduled'); setRescheduling(null); setNextDate(''); load(); }
    catch (requestError) { notify(requestError.message, 'error'); }
    finally { setSavingId(null); }
  }

  const overdue = followUps.filter((item) => item.timing === 'overdue');
  const upcoming = followUps.filter((item) => item.timing === 'upcoming');

  function renderRow(lead) {
    const whatsApp = whatsappUrl(lead, user.organizationName);
    return <article className={`followup-card${lead.timing === 'overdue' ? ' followup-overdue' : ''}`} key={lead.id}>
      <span className="followup-person-icon"><UserRound size={18} /></span>
      <div className="followup-card-main"><div className="followup-card-title"><button className="table-primary-link" onClick={() => navigate(`leads/${lead.id}`)}>{lead.display_name}</button><StatusBadge status={lead.timing} /></div>
        <div className="followup-card-meta"><span>{lead.branch_name || 'No branch'}</span><span>·</span><span>{lead.campaign_name || lead.source}</span><span>·</span><span>{lead.assignee_name || 'Unassigned'}</span></div>
        <div className="followup-card-date"><Clock3 size={15} /><span>{lead.timing === 'overdue' ? 'Was due' : 'Due'} {formatDate(lead.next_follow_up_at)}</span><span className="followup-status">{lead.status}</span></div>
        {rescheduling === lead.id && <div className="reschedule-inline"><label><span>New date</span><input type="date" min={today} value={nextDate} onChange={(event) => setNextDate(event.target.value)} /></label><Button size="small" loading={savingId === lead.id} disabled={!nextDate} onClick={() => reschedule(lead.id)}>Save date</Button><button className="text-button" onClick={() => setRescheduling(null)}>Cancel</button></div>}
      </div>
      <div className="followup-card-actions">
        {whatsApp && <a className="icon-action whatsapp-action" href={whatsApp} target="_blank" rel="noreferrer" aria-label={`Open WhatsApp for ${lead.display_name}`} title="Open WhatsApp"><MessageCircle size={17} /><span>WhatsApp</span></a>}
        <button className="icon-action" onClick={() => { setRescheduling(lead.id); setNextDate(lead.next_follow_up_at > today ? lead.next_follow_up_at : addDays(today, 1)); }} aria-label={`Reschedule follow-up for ${lead.display_name}`}><RotateCcw size={17} /><span>Reschedule</span></button>
        <Button variant="secondary" size="small" icon={Check} loading={savingId === lead.id} onClick={() => complete(lead.id)}>Complete</Button>
      </div>
    </article>;
  }

  return (
    <div className="page-content">
      <PageTitle eyebrow="Operations" title="Follow-ups" description="Work through overdue and upcoming lead reminders." actions={<label className="followup-until"><span>Show through</span><input type="date" value={until} min={today} onChange={(event) => setUntil(event.target.value)} /></label>} />
      {loading ? <LoadingState label="Loading follow-ups…" /> : error ? <ErrorState message={error} onRetry={load} /> : followUps.length ? <div className="followup-queue">
        {overdue.length > 0 && <section><div className="section-heading"><div><h2>Overdue</h2><p>{overdue.length} reminders need attention</p></div><StatusBadge status="overdue" /></div><div className="followup-list">{overdue.map(renderRow)}</div></section>}
        {upcoming.length > 0 && <section><div className="section-heading"><div><h2>Upcoming</h2><p>Due by {formatDate(until)}</p></div><span className="section-count">{upcoming.length}</span></div><div className="followup-list">{upcoming.map(renderRow)}</div></section>}
      </div> : <section className="panel"><EmptyState icon={CalendarClock} title="No follow-ups due" description={`There are no overdue or upcoming reminders through ${formatDate(until)}.`} action={<Button variant="secondary" onClick={() => navigate('leads')}>View leads</Button>} /></section>}
      <div className="privacy-note">WhatsApp opens a prefilled message only when a contact number and authorization are recorded. The message is never sent automatically.</div>
    </div>
  );
}
