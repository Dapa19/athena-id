export function summarizeMetrics({ leads, transactions, campaigns, leadActivities = [], from, to, branchId }) {
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  const selectedLeads = leads.filter((lead) => !lead.archived_at
    && inRange(String(lead.created_at).slice(0, 10))
    && (!branchId || Number(lead.branch_id) === Number(branchId)));
  const cohortIds = new Set(selectedLeads.map((lead) => Number(lead.id)));
  const validTransactions = transactions.filter((tx) => tx.status === 'Paid'
    && inRange(tx.transaction_date)
    && (!branchId || Number(tx.branch_id) === Number(branchId)));
  const attributed = validTransactions.filter((tx) => tx.campaign_id != null);
  const paidLeadIds = new Set(transactions
    .filter((tx) => tx.status === 'Paid' && tx.lead_id != null && cohortIds.has(Number(tx.lead_id)))
    .map((tx) => Number(tx.lead_id)));
  const relevantCampaigns = campaigns.filter((campaign) => (!from || campaign.end_date >= from)
    && (!to || campaign.start_date <= to)
    && (!branchId || campaign.branch_ids?.some((id) => Number(id) === Number(branchId))));
  const hasRecordedSpend = relevantCampaigns.some((campaign) => campaign.actual_spend != null);
  const activeLeadById = new Map(leads.filter((lead) => !lead.archived_at).map((lead) => [Number(lead.id), lead]));
  const bookingEvents = leadActivities.filter((activity) => activity.activity_type === 'status_changed' && activity.to_status === 'Booked'
    && inRange(String(activity.created_at).slice(0, 10))
    && activeLeadById.has(Number(activity.lead_id))
    && (!branchId || Number(activeLeadById.get(Number(activity.lead_id)).branch_id) === Number(branchId)));
  const outcomesByLead = new Map();
  for (const activity of leadActivities.filter((item) => item.activity_type === 'status_changed' && ['Booked', 'Attended', 'No-show'].includes(item.to_status))) {
    const leadId = Number(activity.lead_id);
    if (!outcomesByLead.has(leadId)) outcomesByLead.set(leadId, []);
    outcomesByLead.get(leadId).push(activity);
  }
  for (const events of outcomesByLead.values()) events.sort((left, right) => left.created_at.localeCompare(right.created_at));
  const attendedBookings = bookingEvents.filter((booking) => {
    const events = outcomesByLead.get(Number(booking.lead_id)) || [];
    const nextOutcome = events.find((event) => event.created_at > booking.created_at);
    return nextOutcome?.to_status === 'Attended';
  }).length;
  const recordedSpend = hasRecordedSpend
    ? relevantCampaigns.reduce((sum, campaign) => sum + Number(campaign.actual_spend || 0), 0)
    : null;
  const attributedRevenue = attributed.reduce((sum, tx) => sum + Number(tx.amount_idr || 0), 0);

  return {
    campaignBudget: relevantCampaigns.length ? relevantCampaigns.reduce((sum, campaign) => sum + Number(campaign.planned_budget || 0), 0) : null,
    recordedSpend,
    attributedRevenue,
    leadCount: selectedLeads.length,
    convertedLeads: paidLeadIds.size,
    conversionRate: selectedLeads.length ? paidLeadIds.size / selectedLeads.length : null,
    roas: recordedSpend > 0 ? attributedRevenue / recordedSpend : null,
    showRate: bookingEvents.length ? attendedBookings / bookingEvents.length : null,
    campaignPerformance: relevantCampaigns.map((campaign) => {
      const campaignLeadRows = selectedLeads.filter((lead) => Number(lead.campaign_id) === Number(campaign.id));
      const campaignRevenue = attributed.filter((tx) => Number(tx.campaign_id) === Number(campaign.id))
        .reduce((sum, tx) => sum + Number(tx.amount_idr || 0), 0);
      return {
        id: campaign.id,
        name: campaign.name,
        channel: campaign.channel,
        status: campaign.status,
        leadCount: campaignLeadRows.length,
        revenue: campaignRevenue,
        spend: campaign.actual_spend == null ? null : Number(campaign.actual_spend),
        costPerLead: campaignLeadRows.length && campaign.actual_spend != null
          ? Number(campaign.actual_spend) / campaignLeadRows.length
          : null
      };
    }),
    funnel: ['New', 'Contacted', 'Booked', 'Attended', 'Purchased', 'Lost', 'No-show'].map((status) => ({
      status,
      count: selectedLeads.filter((lead) => lead.status === status).length
    }))
  };
}

export function sumPaidAttributedRevenue(transactions) {
  return transactions
    .filter((transaction) => transaction.status === 'Paid' && transaction.campaign_id != null)
    .reduce((sum, transaction) => sum + Number(transaction.amount_idr), 0);
}
