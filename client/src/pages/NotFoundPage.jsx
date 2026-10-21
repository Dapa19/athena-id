import { CircleHelp } from 'lucide-react';
import { Button, EmptyState, PageTitle } from '../components/UI.jsx';

export function NotFoundPage({ navigate }) {
  return <div className="page-content"><PageTitle eyebrow="Not found" title="This page isn’t available" description="The link may be outdated or the page may have moved." /><section className="panel"><EmptyState icon={CircleHelp} title="Return to your workspace" description="Open the overview and continue from the main navigation." action={<Button onClick={() => navigate('overview')}>Go to overview</Button>} /></section></div>;
}
