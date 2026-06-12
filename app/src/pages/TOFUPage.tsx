import { useCampaignMetrics } from '../lib/queries';
import { formatLakh, formatNumber, formatPercent } from '../lib/formatters';
import MetricCard from '../components/ui/MetricCard';
import SectionHeader from '../components/ui/SectionHeader';
import ChartContainer from '../components/ui/ChartContainer';
import Badge from '../components/ui/Badge';
import BarChart from '../components/charts/BarChart';
import Footer from '../components/layout/Footer';
import { SkeletonCard, SkeletonChart } from '../components/ui/Skeleton';
import type { CampaignWithMetrics } from '../types';

function sum(campaigns: CampaignWithMetrics[], key: keyof NonNullable<CampaignWithMetrics['latest_metric']>): number {
  return campaigns.reduce((acc, c) => acc + (Number(c.latest_metric?.[key]) || 0), 0);
}
function wavg(campaigns: CampaignWithMetrics[], key: keyof NonNullable<CampaignWithMetrics['latest_metric']>, weight: keyof NonNullable<CampaignWithMetrics['latest_metric']>): number {
  const totalW = sum(campaigns, weight);
  if (!totalW) return 0;
  return campaigns.reduce((acc, c) => {
    const w = Number(c.latest_metric?.[weight]) || 0;
    const v = Number(c.latest_metric?.[key]) || 0;
    return acc + v * w;
  }, 0) / totalW;
}

export default function TOFUPage() {
  const { data, isLoading, isError, refetch } = useCampaignMetrics('TOFU');

  if (isLoading) {
    return (
      <div className="content">
        <div style={{ background: '#fff', border: '1px solid #E0E4EA', borderLeft: '4px solid #062E62', padding: '1.25rem 1.75rem', marginBottom: '1.5rem' }}>
          <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 14, width: '25%' }} />
        </div>
        <SkeletonChart height={100} />
        <div className="grid-5" style={{ marginBottom: '1rem' }}>
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} height={30} />)}
        </div>
        <SkeletonChart height={280} />
        <Footer />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="content">
        <div style={{ padding: '2rem', textAlign: 'center', color: '#5A6577' }}>
          <p style={{ marginBottom: '1rem' }}>Failed to load TOFU data.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="content">
        <div className="page-header page-header-tofu">
          <h2>FIOLAX Confidence</h2>
          <p>TOFU • Awareness Stage</p>
        </div>
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA' }}>
          No data synced yet. Click <strong>Sync Now</strong> to load your LinkedIn campaigns.
        </div>
        <Footer />
      </div>
    );
  }

  const completed = data.filter(c => c.status === 'COMPLETED');
  const active    = data.filter(c => c.status === 'ACTIVE');
  const completedAds = completed.reduce((a, c) => a + c.ad_count, 0);
  const activeAds    = active.reduce((a, c) => a + c.ad_count, 0);

  const totalSpend       = sum(data, 'spend_inr');
  const totalReach       = sum(data, 'reach');
  const totalImpressions = sum(data, 'impressions');
  const avgCPM           = sum(data, 'cpm_inr') / data.length;
  const avgCTR           = wavg(data, 'ctr', 'impressions');
  const avgEngRate       = wavg(data, 'engagement_rate', 'impressions');

  return (
    <div className="content">
      <div className="page-header page-header-tofu">
        <h2>FIOLAX Confidence</h2>
        <p>TOFU • Awareness Stage</p>
      </div>

      <ChartContainer title="Campaign Summary">
        <table>
          <thead><tr><th></th><th>Campaigns</th><th>Ads</th></tr></thead>
          <tbody>
            <tr><td>Completed</td><td>{completed.length}</td><td>{completedAds}</td></tr>
            <tr><td>Active</td><td>{active.length}</td><td>{activeAds}</td></tr>
          </tbody>
        </table>
      </ChartContainer>

      <SectionHeader>Key Metrics</SectionHeader>
      <div className="grid-5" style={{ marginBottom: '1rem' }}>
        <MetricCard label="Spends"      value={formatLakh(totalSpend)} />
        <MetricCard label="Reach"       value={formatNumber(totalReach)} />
        <MetricCard label="Impressions" value={formatNumber(totalImpressions)} />
        <MetricCard label="CPM"         value={`₹${avgCPM.toFixed(2)}`} />
        <MetricCard label="CTR"         value={formatPercent(avgCTR)} />
      </div>
      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        <MetricCard label="Engagement Rate" value={formatPercent(avgEngRate)} />
      </div>

      <SectionHeader>Campaign Details</SectionHeader>
      <ChartContainer>
        <table>
          <thead>
            <tr>
              <th>Campaign Name</th><th>Status</th><th>Ads</th>
              <th>Impressions</th><th>Reach</th><th>CPM (₹)</th>
              <th>Eng. Rate %</th><th>CTR %</th>
            </tr>
          </thead>
          <tbody>
            {data.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><Badge status={c.status} /></td>
                <td>{c.ad_count}</td>
                <td>{formatNumber(c.latest_metric?.impressions ?? 0)}</td>
                <td>{formatNumber(c.latest_metric?.reach ?? 0)}</td>
                <td>{(c.latest_metric?.cpm_inr ?? 0).toFixed(2)}</td>
                <td>{formatPercent(c.latest_metric?.engagement_rate ?? 0)}</td>
                <td>{formatPercent(c.latest_metric?.ctr ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartContainer>

      <div className="grid-2">
        <ChartContainer title="Impressions by Campaign">
          <BarChart
            labels={data.map(c => c.name)}
            values={data.map(c => c.latest_metric?.impressions ?? 0)}
            colors={data.map((_, i) => i === 0 ? '#062E62' : '#0050FF')}
            height={280}
          />
        </ChartContainer>
        <ChartContainer title="CTR by Campaign">
          <BarChart
            labels={data.map(c => c.name)}
            values={data.map(c => parseFloat(((c.latest_metric?.ctr ?? 0) * 100).toFixed(2)))}
            colors={data.map((_, i) => i === 0 ? '#062E62' : '#0050FF')}
            height={280}
            textFormat={v => `${v.toFixed(2)}%`}
            yAxisRange={[0, Math.max(...data.map(c => (c.latest_metric?.ctr ?? 0) * 100)) * 1.4]}
          />
        </ChartContainer>
      </div>

      <Footer />
    </div>
  );
}
