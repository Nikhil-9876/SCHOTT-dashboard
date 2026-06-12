import { useCampaignMetrics } from '../lib/queries';
import { formatLakh, formatNumber, formatPercent } from '../lib/formatters';
import MetricCard from '../components/ui/MetricCard';
import SectionHeader from '../components/ui/SectionHeader';
import ChartContainer from '../components/ui/ChartContainer';
import Badge from '../components/ui/Badge';
import BarChart from '../components/charts/BarChart';
import ScatterChart from '../components/charts/ScatterChart';
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

export default function BOFUPage() {
  const { data, isLoading, isError, refetch } = useCampaignMetrics('BOFU');

  if (isLoading) {
    return (
      <div className="content">
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
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ marginBottom: '1rem', color: '#5A6577' }}>Failed to load BOFU data.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="content">
        <div className="page-header page-header-bofu">
          <h2>FIOLAX Experience</h2>
          <p>BOFU • Lead Gen</p>
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
  const avgCTR      = wavg(data, 'ctr', 'impressions');
  const avgCPL      = totalLeads ? totalSpend / totalLeads : 0;
  const convRate    = totalClicks ? (totalLeads / totalClicks) * 100 : 0;

  const barColors = ['#062E62', '#0050FF', '#3B82F6'];

  const scatterPoints = data.map((c, i) => ({
    x: parseFloat(((c.latest_metric?.ctr ?? 0) * 100).toFixed(2)),
    y: c.latest_metric?.leads ?? 0,
    label: c.name,
    size: 14 + i * 2,
  }));

  return (
    <div className="content">
      <div className="page-header page-header-bofu">
        <h2>FIOLAX Experience</h2>
        <p>BOFU • Lead Gen</p>
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
      <div className="grid-5" style={{ marginBottom: '1.5rem' }}>
        <MetricCard label="Spends" value={formatLakh(totalSpend)} />
        <MetricCard label="Clicks" value={formatNumber(totalClicks)} />
        <MetricCard label="CTR"    value={formatPercent(avgCTR)} />
        <MetricCard label="Leads"  value={formatNumber(totalLeads)} />
        <MetricCard label="CPL"    value={`₹${avgCPL.toFixed(2)}`} />
      </div>

      <SectionHeader>Campaign Details</SectionHeader>
      <ChartContainer>
        <table>
          <thead>
            <tr>
              <th>Campaign Name</th><th>Status</th><th>Ads</th>
              <th>Spends (₹)</th><th>Clicks</th><th>CTR %</th>
              <th>Leads</th><th>CPL (₹)</th>
            </tr>
          </thead>
          <tbody>
            {data.map(c => {
              const m = c.latest_metric;
              const cpl = (m?.leads && m?.spend_inr) ? (m.spend_inr / m.leads).toFixed(2) : (m?.cpl_inr?.toFixed(2) ?? '—');
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><Badge status={c.status} /></td>
                  <td>{c.ad_count}</td>
                  <td>{formatNumber(m?.spend_inr ?? 0)}</td>
                  <td>{formatNumber(m?.clicks ?? 0)}</td>
                  <td>{formatPercent(m?.ctr ?? 0)}</td>
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
            colors={data.map((_, i) => barColors[i % barColors.length])}
            height={280}
            textFormat={v => String(v)}
          />
        </ChartContainer>
        <ChartContainer title="CTR vs Leads">
          <ScatterChart points={scatterPoints} height={280} />
        </ChartContainer>
      </div>

      <ChartContainer title="Conversion Funnel Summary">
        <div className="grid-3">
          <div className="conv-stat">
            <div className="conv-label">Total Clicks</div>
            <div className="conv-value">{formatNumber(totalClicks)}</div>
          </div>
          <div className="conv-stat">
            <div className="conv-label">Converted to Leads</div>
            <div className="conv-value conv-value-accent">{formatNumber(totalLeads)}</div>
          </div>
          <div className="conv-stat">
            <div className="conv-label">Conversion Rate</div>
            <div className="conv-value conv-value-success">{convRate.toFixed(1)}%</div>
          </div>
        </div>
      </ChartContainer>

      <Footer />
    </div>
  );
}
