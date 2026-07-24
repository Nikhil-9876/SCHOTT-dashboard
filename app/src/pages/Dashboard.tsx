import { useCampaignMetrics, useIngestionLog } from '../lib/queries';
import { formatEURCompact, formatNumber, formatPercent } from '../lib/formatters';
import SummaryCard from '../components/ui/SummaryCard';
import FunnelCard from '../components/ui/FunnelCard';
import SectionHeader from '../components/ui/SectionHeader';
import ChartContainer from '../components/ui/ChartContainer';
import BarChart from '../components/charts/BarChart';
import Footer from '../components/layout/Footer';
import { SkeletonCard, SkeletonChart } from '../components/ui/Skeleton';
import type { CampaignWithMetrics } from '../types';

function sumMetric(campaigns: CampaignWithMetrics[], key: keyof NonNullable<CampaignWithMetrics['latest_metric']>): number {
  return campaigns.reduce((acc, c) => acc + (Number(c.latest_metric?.[key]) || 0), 0);
}

export default function Dashboard() {
  const { data: all, isLoading, isError, refetch } = useCampaignMetrics();
  const { data: logs } = useIngestionLog();

  if (isLoading) {
    return (
      <div className="content">
        <SectionHeader>Campaign Summary</SectionHeader>
        <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
          <SkeletonCard height={60} />
          <SkeletonCard height={60} />
          <SkeletonCard height={60} />
        </div>
        <SectionHeader>Deep Dive by Funnel Stage</SectionHeader>
        <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
          <SkeletonCard height={80} />
          <SkeletonCard height={80} />
          <SkeletonCard height={80} />
        </div>
        <SkeletonChart height={380} />
        <Footer />
      </div>
    );
  }

  if (isError || !all) {
    return (
      <div className="content">
        <div style={{ padding: '2rem', textAlign: 'center', color: '#5A6577' }}>
          <p style={{ marginBottom: '1rem' }}>Failed to load campaign data.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  // If no data at all, show empty state
  if (all.length === 0) {
    const hasSynced = logs && logs.length > 0;
    return (
      <div className="content">
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA' }}>
          <p style={{ fontSize: '15px', marginBottom: '0.5rem', fontWeight: 600, color: '#062E62' }}>
            {hasSynced ? 'No campaign data found' : 'No data synced yet'}
          </p>
          {hasSynced && (
            <p style={{ marginBottom: '0.5rem' }}>
              A sync has been performed, but no campaign data was found.
            </p>
          )}
          <p>
            Click <strong>Sync Now</strong> in the header to {hasSynced ? 'refresh' : 'load your LinkedIn campaigns'}.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  // Aggregate totals
  const totalCampaigns = all.length;
  const activeCount = all.filter(c => c.status === 'ACTIVE').length;
  const completedCount = all.filter(c => c.status === 'COMPLETED').length;
  const totalAds = all.reduce((acc, campaign) => acc + campaign.ad_count, 0);
  const totalSpendEur = sumMetric(all, 'spend_eur');
  const totalReach = sumMetric(all, 'reach');
  const totalImpressions = sumMetric(all, 'impressions');
  const totalClicks = sumMetric(all, 'clicks');
  const totalLeads = sumMetric(all, 'leads');
  const avgCTR = totalImpressions ? totalClicks / totalImpressions : 0;

  const tofuImpressions = sumMetric(all.filter(c => c.funnel_stage === 'TOFU'), 'impressions');
  const mofuImpressions = sumMetric(all.filter(c => c.funnel_stage === 'MOFU'), 'impressions');
  const bofuImpressions = sumMetric(all.filter(c => c.funnel_stage === 'BOFU'), 'impressions');

  const maxImp = Math.max(tofuImpressions, mofuImpressions, bofuImpressions);

  return (
    <div className="content">
      <SectionHeader>Campaign Summary</SectionHeader>
      <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
        <SummaryCard
          label="Campaigns"
          value={totalCampaigns}
          detail={`${completedCount} Completed • ${activeCount} Active`}
        />
        <SummaryCard
          label="Total Spend"
          value={formatEURCompact(totalSpendEur)}
          detail="LinkedIn spend in EUR"
        />
        <SummaryCard
          label="Total Reach"
          value={formatNumber(totalReach)}
          detail="Total audience reached across campaigns"
        />
      </div>
      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        <SummaryCard
          label="Ads"
          value={totalAds}
          detail="Creatives linked to synced campaigns"
        />
        <SummaryCard
          label="Impressions"
          value={formatNumber(totalImpressions)}
          detail="Delivered impressions"
        />
        <SummaryCard
          label="Clicks"
          value={formatNumber(totalClicks)}
          detail={`CTR ${formatPercent(avgCTR)}`}
        />
        <SummaryCard
          label="Leads"
          value={formatNumber(totalLeads)}
          detail="Website conversions reported by LinkedIn"
        />
      </div>

      <SectionHeader>Deep Dive by Funnel Stage</SectionHeader>
      <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
        <FunnelCard
          variant="tofu"
          tag="TOFU"
          title="FIOLAX Confidence"
          description="Awareness — Brand reach &amp; impressions"
          route="/tofu"
        />
        <FunnelCard
          variant="mofu"
          tag="MOFU"
          title="FIOLAX Challenge"
          description="Web Traffic &amp; Lead Gen"
          route="/mofu"
        />
        <FunnelCard
          variant="bofu"
          tag="BOFU"
          title="FIOLAX Experience"
          description="Lead Gen — Lead generation &amp; capture"
          route="/bofu"
        />
      </div>

      <ChartContainer title="Funnel Performance Overview">
        <BarChart
          labels={['FIOLAX Confidence', 'FIOLAX Challenge', 'FIOLAX Experience']}
          values={[tofuImpressions, mofuImpressions, bofuImpressions]}
          colors={['#062E62', '#0050FF', '#3B82F6']}
          height={380}
          yAxisTitle="Impressions"
          yAxisRange={[0, Math.ceil(maxImp * 1.2)]}
          marginOverride={{ l: 60, r: 20, t: 40, b: 50 }}
        />
      </ChartContainer>

      <Footer />
    </div>
  );
}
