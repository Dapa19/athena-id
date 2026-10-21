import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Banknote, CalendarDays, ContactRound, Percent, TrendingUp } from 'lucide-react';
import { api, formatDate, formatIDR, todayString, withQuery } from '../lib/api.js';
import { Badge, EmptyState, ErrorState, LoadingState, PageTitle, StatusBadge } from '../components/UI.jsx';

function daysBefore(value, count) {
  const date = new Date(`${value}T12:00:00+07:00`);
  date.setDate(date.getDate() - count);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'blue' }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-icon-${tone}`}><Icon size={19} strokeWidth={1.9} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}

export function OverviewPage({ navigate }) {
  const today = useMemo(todayString, []);
  const [from, setFrom] = useState(daysBefore(today, 29));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    api('/api/branches').then((result) => setBranches(result.branches)).catch(() => {});
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    api(withQuery('/api/dashboard', { from, to, branchId }))
      .then((result) => { if (current) setData(result); })
      .catch((requestError) => { if (current) setError(requestError.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [from, to, branchId, reloadToken]);

  const metrics = data?.metrics;
  const maxLeads = Math.max(1, ...(metrics?.funnel?.map((item) => item.count) || [1]));
  const maxBranchRevenue = Math.max(1, ...(data?.branchPerformance?.map((branch) => branch.revenue) || [1]));

  return (
    <div className="page-content">
      <PageTitle eyebrow="Overview" title="Performance at a glance" description="See how campaigns are moving leads toward paid outcomes." actions={
        <button className="button button-secondary" onClick={() => navigate('campaigns')}><span>Explore campaigns</span><ArrowRight size={16} /></button>
      } />

      <section className="filter-bar" aria-label="Dashboard filters">
        <div className="filter-bar-title"><CalendarDays size={17} /><span>Date range</span></div>
        <label className="filter-control"><span className="sr-only">From date</span><input aria-label="From date" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <span className="date-separator">to</span>
        <label className="filter-control"><span className="sr-only">To date</span><input aria-label="To date" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="filter-control filter-branch"><span className="sr-only">Branch filter</span>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)} aria-label="Filter by branch"><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
        </label>
        <div className="filter-spacer" />
        {metrics && <div className="budget-summary"><span>Campaign budget</span><strong>{formatIDR(metrics.campaignBudget)}</strong></div>}
      </section>

      {loading && !data ? <LoadingState label="Loading performance…" /> : error && !data ? <ErrorState message={error} onRetry={() => setReloadToken((value) => value + 1)} /> : (
        <>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <section className="metric-grid" aria-label="Key metrics">
            <MetricCard label="Recorded spend" value={metrics?.recordedSpend == null ? 'Unavailable' : formatIDR(metrics.recordedSpend, true)} detail={metrics?.recordedSpend == null ? 'No actual spend entered' : 'Campaign totals overlapping this range'} icon={Banknote} />
            <MetricCard label="Attributed revenue" value={formatIDR(metrics?.attributedRevenue || 0, true)} detail="Paid, campaign-linked transactions" icon={TrendingUp} tone="green" />
            <MetricCard label="Leads" value={new Intl.NumberFormat('en').format(metrics?.leadCount || 0)} detail="Created in selected period" icon={ContactRound} tone="purple" />
            <MetricCard label="Lead-to-purchase" value={metrics?.conversionRate == null ? '—' : `${(metrics.conversionRate * 100).toFixed(1)}%`} detail={`${metrics?.convertedLeads || 0} of ${metrics?.leadCount || 0} leads converted`} icon={Percent} tone="orange" />
          </section>
          <div className="metric-footnote">Revenue counts paid transactions explicitly linked to a campaign. Cancelled and refunded transactions are excluded.</div>

          <section className="dashboard-grid">
            <article className="panel campaign-panel">
              <div className="panel-heading"><div><h2>Campaign performance</h2><p>Leads and paid revenue in this date range</p></div><button className="text-button" onClick={() => navigate('campaigns')}>View all <ArrowRight size={15} /></button></div>
              {metrics?.campaignPerformance?.length ? (
                <div className="performance-list">
                  {metrics.campaignPerformance.slice(0, 5).map((campaign) => {
                    const high = Math.max(1, ...metrics.campaignPerformance.map((item) => item.revenue));
                    return <button className="performance-row" key={campaign.id} onClick={() => navigate(`campaigns/${campaign.id}`)}>
                      <span className="performance-main"><span className="performance-name">{campaign.name}</span><span className="performance-meta">{campaign.channel} <span>·</span> {campaign.leadCount} leads <span>·</span> CPL {campaign.costPerLead == null ? '—' : formatIDR(campaign.costPerLead, true)}</span></span>
                      <span className="performance-bar-wrap"><span className="performance-bar" style={{ width: `${campaign.revenue ? Math.max(3, campaign.revenue / high * 100) : 0}%` }} /></span>
                      <span className="performance-revenue">{formatIDR(campaign.revenue, true)}</span>
                    </button>;
                  })}
                </div>
              ) : <EmptyState title="No campaign results yet" description="Create a campaign and link leads and paid transactions to see performance." action={<button className="button button-secondary button-small" onClick={() => navigate('campaigns')}>Create campaign</button>} />}
              <div className="panel-footnote">Recorded spend is available for {metrics?.campaignPerformance?.filter((item) => item.spend != null).length || 0} of {metrics?.campaignPerformance?.length || 0} campaigns.</div>
            </article>

            <article className="panel funnel-panel">
              <div className="panel-heading"><div><h2>Lead pipeline</h2><p>Current status of leads created in this period</p></div><Badge tone="neutral">{metrics?.leadCount || 0} total</Badge></div>
              {(metrics?.leadCount || 0) ? <div className="funnel-list">
                {metrics.funnel.filter((item) => !['Lost', 'No-show'].includes(item.status)).map((item) => <div className="funnel-row" key={item.status}>
                  <span>{item.status}</span><span className="funnel-track"><span style={{ width: `${Math.max(item.count ? 3 : 0, item.count / maxLeads * 100)}%` }} /></span><strong>{item.count}</strong>
                </div>)}
                <div className="funnel-outcomes">{metrics.funnel.filter((item) => ['Lost', 'No-show'].includes(item.status)).map((item) => <div key={item.status}><span>{item.status}</span><strong>{item.count}</strong></div>)}</div>
              </div> : <EmptyState title="No leads in this period" description="Add a lead to start tracking the pipeline." action={<button className="button button-secondary button-small" onClick={() => navigate('leads')}>Add a lead</button>} />}
            </article>
          </section>

          <section className="dashboard-grid dashboard-grid-lower">
            <article className="panel branch-panel">
              <div className="panel-heading"><div><h2>Branch comparison</h2><p>Campaign-linked paid revenue and leads</p></div><button className="text-button" onClick={() => navigate('branches')}>Branches <ArrowRight size={15} /></button></div>
              {(data?.branchPerformance?.length || 0) > 1 ? <div className="branch-list">
                {data.branchPerformance.map((branch) => <div className="branch-performance-row" key={branch.id}>
                  <div className="branch-performance-name"><span className="branch-avatar">{branch.name.slice(0, 1)}</span><strong>{branch.name}</strong><span>{branch.leads} leads</span></div>
                  <div className="branch-revenue-track"><span style={{ width: `${Math.max(branch.revenue ? 3 : 0, branch.revenue / maxBranchRevenue * 100)}%` }} /></div>
                  <strong className="branch-revenue-value">{formatIDR(branch.revenue, true)}</strong>
                </div>)}
              </div> : <EmptyState title="Add another branch to compare performance" description="Branch comparison appears once there is more than one active branch." action={<button className="button button-secondary button-small" onClick={() => navigate('branches')}>Manage branches</button>} />}
            </article>

            <article className="panel followup-panel">
              <div className="panel-heading"><div><h2>Needs attention</h2><p>Overdue and due in the next 7 days</p></div><button className="text-button" onClick={() => navigate('follow-ups')}>Open queue <ArrowRight size={15} /></button></div>
              {data?.followUps?.length ? <div className="attention-list">{data.followUps.map((lead) => <button key={lead.id} className="attention-row" onClick={() => navigate(`leads/${lead.id}`)}>
                <span className="attention-avatar">{lead.display_name.slice(0, 1)}</span><span className="attention-copy"><strong>{lead.display_name}</strong><span>{lead.branch_name || 'Unassigned branch'} · {formatDate(lead.next_follow_up_at)}</span></span><StatusBadge status={lead.next_follow_up_at < today ? 'overdue' : 'upcoming'} />
              </button>)}</div> : <EmptyState title="You’re up to date" description="Upcoming and overdue reminders will appear here." />}
            </article>
          </section>
          <div className="efficiency-strip"><div><span>Show rate</span><strong>{metrics?.showRate == null ? '—' : `${(metrics.showRate * 100).toFixed(1)}%`}</strong></div><div><span>ROAS</span><strong>{metrics?.roas == null ? '—' : `${metrics.roas.toFixed(2)}×`}</strong></div><p>Spend uses whole-campaign totals for campaigns overlapping this range. Show rate uses booked-to-attended history. ROAS is not profit.</p></div>
        </>
      )}
    </div>
  );
}
