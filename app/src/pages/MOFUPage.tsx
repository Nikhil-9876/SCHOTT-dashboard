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
  return campaigns.reduce((acc, c) => acc + (Number(c.latest_metric?.[key]) || 0) * (Number(c.latest_metric?.[weight]) || 0), 0) / totalW;
}

export default function MOFUPage() {
  const { data, isLoading, isError, refetch } = useCampaignMetrics('MOFU');

  if (isLoading) {
    return (
      <div className="content">
        <SkeletonChart height={100} />
        <div className="grid-4" style={{ marginBottom: '1rem' }}>
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} height={30} />)}
        </div>
        <div className="grid-3" style={{ marginBottom: '1rem' }}>
          {[...Array(3)].map((_, i) => <SkeletonCard key={i} height={30} />)}
        </div>
        <SkeletonChart height={280} />
        <Footer />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="content">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ marginBottom: '1rem', color: '#5A6577' }}>Failed to load MOFU data.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="content">
        <div className="page-header page-header-mofu">
          <h2>FIOLAX Challenge</h2>
          <p>MOFU • Web Traffic &amp; Lead Gen</p>
        </div>
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA' }}>
          No data synced yet. Click <strong>Sync Now</strong> to load your LinkedIn campaigns.
        </div>
        <Footer />
      </div>
    );
  }

  const completed    = data.filter(c => c.status === 'COMPLETED');
  const active       = data.filter(c => c.status === 'ACTIVE');
  const completedAds = completed.reduce((a, c) => a + c.ad_count, 0);
  const activeAds    = active.reduce((a, c) => a + c.ad_count, 0);

  const totalSpend  = sum(data, 'spend_inr');
  const totalClicks = sum(data, 'clicks');
  const totalLeads  = sum(data, 'leads');
  const avgEngRate  = wavg(data, 'engagement_rate', 'impressions');
  const avgCTR      = wavg(data, 'ctr', 'impressions');
  const avgCPC      = totalClicks ? totalSpend / totalClicks : 0;
  const avgCPL      = totalLeads  ? totalSpend / totalLeads  : 0;

  return (
    <div className="content">
      <div className="page-header page-header-mofu">
        <h2>FIOLAX Challenge</h2>
        <p>MOFU • Web Traffic &amp; Lead Gen</p>
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
      <div className="grid-4" style={{ marginBottom: '1rem' }}>
        <MetricCard label="Spends"          value={formatLakh(totalSpend)} />
        <MetricCard label="Clicks"          value={formatNumber(totalClicks)} />
        <MetricCard label="Engagement Rate" value={formatPercent(avgEngRate)} />
        <MetricCard label="CTR"             value={formatPercent(avgCTR)} />
      </div>
      <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
        <MetricCard label="CPC"   value={`₹${avgCPC.toFixed(2)}`} />
        <MetricCard label="Leads" value={formatNumber(totalLeads)} />
        <MetricCard label="CPL"   value={`₹${avgCPL.toFixed(2)}`} />
      </div>

      <SectionHeader>Campaign Details</SectionHeader>
      <ChartContainer>
        <table>
          <thead>
            <tr>
              <th>Campaign Name</th><th>Status</th><th>Ads</th>
              <th>Spends (₹)</th><th>Clicks</th><th>Eng. Rate %</th>
              <th>CTR %</th><th>CPC (₹)</th><th>Leads</th><th>CPL (₹)</th>
            </tr>
          </thead>
          <tbody>
            {data.map(c => {
              const m = c.latest_metric;
              const cpc = (m?.clicks && m?.spend_inr) ? (m.spend_inr / m.clicks).toFixed(2) : (m?.cpc_inr?.toFixed(2) ?? '—');
              const cpl = (m?.leads  && m?.spend_inr) ? (m.spend_inr / m.leads).toFixed(2)  : (m?.cpl_inr?.toFixed(2) ?? '—');
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><Badge status={c.status} /></td>
                  <td>{c.ad_count}</td>
                  <td>{formatNumber(m?.spend_inr ?? 0)}</td>
                  <td>{formatNumber(m?.clicks ?? 0)}</td>
                  <td>{formatPercent(m?.engagement_rate ?? 0)}</td>
                  <td>{formatPercent(m?.ctr ?? 0)}</td>
                  <td>{cpc}</td>
                  <td>{m?.leads ?? 0}</td>
                  <td>{cpl}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ChartContainer>

      <div className="grid-2">
        <ChartContainer title="Leads by Campaign">
          <BarChart
            labels={data.map(c => c.name)}
            values={data.map(c => c.latest_metric?.leads ?? 0)}
            colors={data.map((_, i) => i < data.length - 1 ? '#0050FF' : '#062E62')}
            height={280}
            textFormat={v => String(v)}
          />
        </ChartContainer>
        <ChartContainer title="CPL by Campaign">
          <BarChart
            labels={data.map(c => c.name)}
            values={data.map(c => {
              const m = c.latest_metric;
              return (m?.leads && m?.spend_inr) ? parseFloat((m.spend_inr / m.leads).toFixed(2)) : (m?.cpl_inr ?? 0);
            })}
            colors={data.map((_, i) => i < data.length - 1 ? '#0050FF' : '#062E62')}
            height={280}
            textFormat={v => `₹${v.toFixed(0)}`}
          />
        </ChartContainer>
      </div>

      <Footer />
    </div>
  );
}
