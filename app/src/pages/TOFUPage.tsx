import { useState, useMemo } from 'react';
import { useAdPerformance, useCampaignMetrics, useIngestionLog } from '../lib/queries';
import { formatEUR, formatEURCompact, formatNumber, formatPercent } from '../lib/formatters';
import MetricCard from '../components/ui/MetricCard';
import SectionHeader from '../components/ui/SectionHeader';
import ChartContainer from '../components/ui/ChartContainer';
import Badge from '../components/ui/Badge';
import BarChart from '../components/charts/BarChart';
import Footer from '../components/layout/Footer';
import { SkeletonCard, SkeletonChart } from '../components/ui/Skeleton';
import type { CampaignWithMetrics, AdPerformanceMetric } from '../types';

// ── Objective detection ────────────────────────────────────────────────────
type Objective = 'All' | 'Awareness' | 'Engagement' | 'Video Views';

function detectObjective(campaignName: string): Exclude<Objective, 'All'> {
  const n = campaignName.toLowerCase();
  if (n.includes('_vv_') || n.includes('_videoview') || n.includes('video view')) return 'Video Views';
  if (n.includes('_eng_') || n.includes('_engagement') || n.includes('engagement')) return 'Engagement';
  // Default to Awareness (covers _aw_ and anything else)
  return 'Awareness';
}

// ── Aggregation helpers ────────────────────────────────────────────────────
function sum(campaigns: CampaignWithMetrics[], key: keyof NonNullable<CampaignWithMetrics['latest_metric']>): number {
  return campaigns.reduce((acc, c) => acc + (Number(c.latest_metric?.[key]) || 0), 0);
}
function wavg(
  campaigns: CampaignWithMetrics[],
  key: keyof NonNullable<CampaignWithMetrics['latest_metric']>,
  weight: keyof NonNullable<CampaignWithMetrics['latest_metric']>,
): number {
  const totalW = sum(campaigns, weight);
  if (!totalW) return 0;
  return campaigns.reduce((acc, c) => {
    const w = Number(c.latest_metric?.[weight]) || 0;
    const v = Number(c.latest_metric?.[key]) || 0;
    return acc + v * w;
  }, 0) / totalW;
}

// ── Aggregate daily ad rows → one row per unique creative ──────────────────
interface AggregatedAd {
  creative_id: string;
  creative_name: string;
  campaign_name: string;
  campaign_id: string;
  status: string | null;
  spend_eur: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  engagements: number;
  landing_page_clicks: number;
  creative_url: string | null;
  reference: string | null;
  thumbnail_url: string | null;
}

function aggregateAdsByCreative(rows: AdPerformanceMetric[], campaignNameMap: Record<string, string>): AggregatedAd[] {
  const map = new Map<string, AggregatedAd>();

  for (const row of rows) {
    const key = `${row.campaign_id}__${row.creative_id}`;
    const existing = map.get(key);
    if (existing) {
      existing.spend_eur += row.spend_eur ?? 0;
      existing.impressions += row.impressions ?? 0;
      existing.reach += row.reach ?? 0;
      existing.clicks += row.clicks ?? 0;
      existing.engagements += row.engagements ?? 0;
      existing.landing_page_clicks += row.landing_page_clicks ?? 0;
      // Recalculate CTR from totals
      existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
    } else {
      map.set(key, {
        creative_id: row.creative_id,
        creative_name: row.creative_name,
        campaign_id: row.campaign_id,
        campaign_name: campaignNameMap[row.campaign_id] ?? '—',
        status: row.status ?? null,
        spend_eur: row.spend_eur ?? 0,
        impressions: row.impressions ?? 0,
        reach: row.reach ?? 0,
        clicks: row.clicks ?? 0,
        ctr: row.ctr ?? 0,
        engagements: row.engagements ?? 0,
        landing_page_clicks: row.landing_page_clicks ?? 0,
        creative_url: row.creative_url ?? null,
        reference: row.reference ?? null,
        thumbnail_url: row.thumbnail_url ?? null,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.impressions - a.impressions);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function TOFUPage() {
  const { data, isLoading, isError, refetch } = useCampaignMetrics('TOFU');
  const { data: adPerformance = [] } = useAdPerformance('TOFU');
  const { data: logs } = useIngestionLog();

  const [selectedObjective, setSelectedObjective] = useState<Objective>('All');
  const [selectedAdKeys, setSelectedAdKeys] = useState<Set<string>>(new Set());

  // Toggle a single ad selection
  function toggleAdSelection(key: string) {
    setSelectedAdKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearAdSelection() {
    setSelectedAdKeys(new Set());
  }

  // ── Derived: campaigns with objective label ─────────────────────────────
  const campaignsWithObjective = useMemo(() => {
    if (!data) return [];
    return data.map(c => ({ ...c, objective: detectObjective(c.name) }));
  }, [data]);

  // ── Filter by objective (1 campaign per objective, no sub-filter needed) ─
  const filteredCampaigns = useMemo(() => {
    if (selectedObjective === 'All') return campaignsWithObjective;
    return campaignsWithObjective.filter(c => c.objective === selectedObjective);
  }, [campaignsWithObjective, selectedObjective]);

  // ── Campaign name lookup map (for ad table) ─────────────────────────────
  const campaignNameMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    (data ?? []).forEach(c => { m[c.id] = c.name; });
    return m;
  }, [data]);

  // ── Filtered ad rows ────────────────────────────────────────────────────
  const filteredAdRows = useMemo(() => {
    const allowedIds = new Set(filteredCampaigns.map(c => c.id));
    return adPerformance.filter(r => allowedIds.has(r.campaign_id));
  }, [adPerformance, filteredCampaigns]);

  // ── Aggregated assets ───────────────────────────────────────────────────
  const aggregatedAssets = useMemo(() => aggregateAdsByCreative(filteredAdRows, campaignNameMap), [filteredAdRows, campaignNameMap]);

  // ── Daily rows filtered by selected ads ─────────────────────────────────
  const dailyAdRows = useMemo(() => {
    if (selectedAdKeys.size === 0) return filteredAdRows;
    return filteredAdRows.filter(r => selectedAdKeys.has(`${r.campaign_id}__${r.creative_id}`));
  }, [filteredAdRows, selectedAdKeys]);


  // Show Campaign column only when multiple campaigns are visible (All objectives)
  const showCampaignCol = filteredCampaigns.length > 1;

  // ── Key metrics ─────────────────────────────────────────────────────────
  const completed = filteredCampaigns.filter(c => c.status === 'COMPLETED');
  const active = filteredCampaigns.filter(c => c.status === 'ACTIVE');
  const completedAds = completed.reduce((a, c) => a + c.ad_count, 0);
  const activeAds = active.reduce((a, c) => a + c.ad_count, 0);

  const totalAds = filteredCampaigns.reduce((a, c) => a + c.ad_count, 0);
  const totalSpend = sum(filteredCampaigns, 'spend_eur');
  const totalReach = sum(filteredCampaigns, 'reach');
  const totalImpressions = sum(filteredCampaigns, 'impressions');
  const totalClicks = sum(filteredCampaigns, 'clicks');
  const avgCPM = totalImpressions ? (totalSpend / totalImpressions) * 1000 : 0;
  const avgCPC = totalClicks ? totalSpend / totalClicks : 0;
  const avgCTR = wavg(filteredCampaigns, 'ctr', 'impressions');
  const avgEngRate = wavg(filteredCampaigns, 'engagement_rate', 'impressions');

  // ── Loading / Error states ──────────────────────────────────────────────
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
    const hasSynced = logs && logs.length > 0;
    return (
      <div className="content">
        <div className="page-header page-header-tofu">
          <h2>FIOLAX Confidence</h2>
          <p>TOFU • Awareness Stage</p>
        </div>
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA' }}>
          <p style={{ fontSize: '15px', marginBottom: '0.5rem', fontWeight: 600, color: '#062E62' }}>
            {hasSynced ? 'No matching campaign data found' : 'No data synced yet'}
          </p>
          {hasSynced && (
            <p style={{ marginBottom: '0.5rem' }}>
              A sync has been performed, but no campaigns matching the TOFU (Awareness) stage criteria were found.
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

  const OBJECTIVES: Objective[] = ['All', 'Awareness', 'Engagement', 'Video Views'];

  return (
    <div className="content">
      {/* Page Header */}
      <div className="page-header page-header-tofu">
        <h2>FIOLAX Confidence</h2>
        <p>TOFU • Awareness Stage</p>
      </div>

      {/* ── Filter Bar ── */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Filter</span>
          <div className="filter-pills">
            {OBJECTIVES.map(obj => (
              <button
                key={obj}
                className={`filter-pill${selectedObjective === obj ? ' active' : ''}`}
                onClick={() => setSelectedObjective(obj)}
              >
                {obj}
              </button>
            ))}
          </div>
        </div>

        {selectedObjective !== 'All' && (
          <div className="filter-group" style={{ marginLeft: 'auto' }}>
            <button className="filter-clear" onClick={() => setSelectedObjective('All')}>
              ✕ Clear
            </button>
          </div>
        )}
      </div>


      {/* ── No results state ── */}
      {filteredCampaigns.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA', marginBottom: '1.25rem' }}>
          No campaigns match the selected filters.
        </div>
      ) : (
        <>
          {/* Campaign Summary */}
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
            <MetricCard label="Spend" value={formatEURCompact(totalSpend)} />
            <MetricCard label="Reach" value={formatNumber(totalReach)} />
            <MetricCard label="Impressions" value={formatNumber(totalImpressions)} />
            <MetricCard label="CPM" value={formatEUR(avgCPM)} />
            <MetricCard label="CTR" value={formatPercent(avgCTR)} />
          </div>
          <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
            <MetricCard label="Engagement Rate" value={formatPercent(avgEngRate)} />
            <MetricCard label="Ads" value={formatNumber(totalAds)} />
            <MetricCard label="Clicks" value={formatNumber(totalClicks)} />
            <MetricCard label="CPC" value={formatEUR(avgCPC)} />
          </div>

          {/* Campaign Details */}
          <SectionHeader>Campaign Details</SectionHeader>
          <ChartContainer>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Campaign Name</th><th>Objective</th><th>Status</th><th>Ads</th>
                    <th title="Total Spend in Euros">Spent</th><th>Impressions</th><th title="Total Unique Reach">Reach</th><th>Clicks</th>
                    <th title="Click-Through Rate">CTR</th><th title="Cost Per Mille (Cost Per Thousand Impressions)">CPM</th><th title="Cost Per Click">CPC</th><th>Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map(c => {
                    const m = c.latest_metric;
                    const spend = m?.spend_eur ?? 0;
                    const impressions = m?.impressions ?? 0;
                    const clicks = m?.clicks ?? 0;
                    const cpm = impressions ? (spend / impressions) * 1000 : 0;
                    const cpc = clicks ? spend / clicks : 0;
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>
                          <span className={`objective-tag objective-${c.objective.toLowerCase().replace(' ', '-')}`}>
                            {c.objective}
                          </span>
                        </td>
                        <td><Badge status={c.status} /></td>
                        <td>{c.ad_count}</td>
                        <td>{formatEUR(spend)}</td>
                        <td>{formatNumber(impressions)}</td>
                        <td>{formatNumber(m?.reach ?? 0)}</td>
                        <td>{formatNumber(clicks)}</td>
                        <td>{formatPercent(m?.ctr ?? 0)}</td>
                        <td>{formatEUR(cpm)}</td>
                        <td>{formatEUR(cpc)}</td>
                        <td>{formatNumber(m?.leads ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartContainer>

          {/* Charts */}
          <div className="grid-2">
            <ChartContainer title="Impressions by Campaign">
              <BarChart
                labels={filteredCampaigns.map(c => c.objective)}
                values={filteredCampaigns.map(c => c.latest_metric?.impressions ?? 0)}
                colors={filteredCampaigns.map((_, i) => i === 0 ? '#062E62' : '#0050FF')}
                height={280}
              />
            </ChartContainer>
            <ChartContainer title="CTR by Campaign">
              <BarChart
                labels={filteredCampaigns.map(c => c.objective)}
                values={filteredCampaigns.map(c => parseFloat(((c.latest_metric?.ctr ?? 0) * 100).toFixed(2)))}
                colors={filteredCampaigns.map((_, i) => i === 0 ? '#062E62' : '#0050FF')}
                height={280}
                textFormat={v => `${v.toFixed(2)}%`}
                yAxisRange={[0, Math.max(...filteredCampaigns.map(c => (c.latest_metric?.ctr ?? 0) * 100), 0.01) * 1.4]}
              />
            </ChartContainer>
          </div>

          {/* ── Ad Performance by Asset (Aggregated) ── */}
          <SectionHeader>Ad Performance by Asset</SectionHeader>
          <div style={{ marginBottom: '0.5rem' }}>
            <p style={{ fontSize: 12, color: '#5A6577' }}>
              Aggregated lifetime metrics per ad creative, mapped to the LinkedIn Asset ID.
              {selectedObjective !== 'All' && (
                <> &nbsp;Showing: <strong>{selectedObjective}</strong> campaign ads</>
              )}
            </p>
          </div>
          <ChartContainer>
            <div className="table-wrapper">
              <table className="ad-asset-table">
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        title="Select / deselect all"
                        checked={selectedAdKeys.size === aggregatedAssets.length && aggregatedAssets.length > 0}
                        onChange={() => {
                          if (selectedAdKeys.size === aggregatedAssets.length) {
                            clearAdSelection();
                          } else {
                            setSelectedAdKeys(new Set(aggregatedAssets.map(r => `${r.campaign_id}__${r.creative_id}`)));
                          }
                        }}
                      />
                    </th>
                    <th className="th-thumb">Preview</th>
                    <th className="hide-md">Asset ID</th>
                    <th>Ad Name</th>
                    {showCampaignCol && <th className="hide-lg">Campaign</th>}
                    <th className="hide-sm">Status</th>
                    <th className="th-num" title="Total Spend in Euros">Spend (€)</th>
                    <th className="th-num" title="Total Delivered Impressions">Impressions</th>
                    <th className="th-num hide-lg" title="Total Unique Reach">Reach</th>
                    <th className="th-num" title="Total Clicks">Clicks</th>
                    <th className="th-num" title="Click-Through Rate">CTR</th>
                    <th className="th-num" title="Cost Per Mille (Cost Per Thousand Impressions)">CPM</th>
                    <th className="th-num" title="Cost Per Click">CPC</th>
                    <th className="th-num hide-md" title="Total Engagements">Eng.</th>
                    <th className="th-num hide-lg" title="Landing Page Clicks">LPC</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregatedAssets.map(row => {
                    const key = `${row.campaign_id}__${row.creative_id}`;
                    const isChecked = selectedAdKeys.has(key);
                    const numericId = row.creative_id.replace(/^urn:li:\w+:/, '');
                    const cpm = row.impressions ? (row.spend_eur / row.impressions) * 1000 : 0;
                    const cpc = row.clicks ? row.spend_eur / row.clicks : 0;
                    return (
                      <tr
                        key={key}
                        style={isChecked ? { background: '#F0F5FF' } : undefined}
                      >
                        <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleAdSelection(key)}
                            title={`Select "${row.creative_name}" to filter daily view`}
                          />
                        </td>
                        <td className="td-thumb">
                          {row.creative_url ? (
                            <a href={row.creative_url} target="_blank" rel="noopener noreferrer" title={`Preview: ${row.creative_name}`}>
                              {row.thumbnail_url ? (
                                <img src={row.thumbnail_url} alt={row.creative_name} className="ad-thumb" />
                              ) : (
                                <span className="ad-thumb-placeholder" title="No preview available">🖼️</span>
                              )}
                            </a>
                          ) : (
                            row.thumbnail_url ? (
                              <img src={row.thumbnail_url} alt={row.creative_name} className="ad-thumb" />
                            ) : (
                              <span className="ad-thumb-placeholder">🖼️</span>
                            )
                          )}
                        </td>
                        <td className="td-asset-id hide-md">
                          <code className="linkedin-id" title={row.creative_id}>{numericId}</code>
                        </td>
                        <td>
                          {row.creative_url ? (
                            <a
                              href={row.creative_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="creative-link"
                              title={`Preview ad on LinkedIn: ${row.creative_name}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', color: 'inherit' }}
                            >
                              <div className="td-truncate-inner" style={{ color: 'var(--color-blue)', fontWeight: 500 }}>{row.creative_name}</div>
                              <span style={{ fontSize: '11px', color: 'var(--color-blue)' }}>↗</span>
                            </a>
                          ) : (
                            <div className="td-truncate-inner" title={row.creative_name}>{row.creative_name}</div>
                          )}
                        </td>
                        {showCampaignCol && (
                          <td className="hide-lg">
                            <div className="td-truncate-inner campaign-name" title={row.campaign_name}>{row.campaign_name}</div>
                          </td>
                        )}
                        <td className="td-nowrap hide-sm">{row.status ? <Badge status={row.status === 'ACTIVE' ? 'ACTIVE' : row.status === 'COMPLETED' ? 'COMPLETED' : 'PAUSED'} /> : <span className="td-dash">—</span>}</td>
                        <td className="td-nowrap td-num">{formatEUR(row.spend_eur)}</td>
                        <td className="td-nowrap td-num">{formatNumber(row.impressions)}</td>
                        <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach)}</td>
                        <td className="td-nowrap td-num">{formatNumber(row.clicks)}</td>
                        <td className="td-nowrap td-num">{formatPercent(row.ctr, 3)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                        <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements)}</td>
                        <td className="td-nowrap td-num hide-lg">{formatNumber(row.landing_page_clicks)}</td>
                      </tr>
                    );
                  })}
                  {aggregatedAssets.length === 0 && (
                    <tr>
                      <td colSpan={showCampaignCol ? 15 : 14} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>
                        No ad data available for the current selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ChartContainer>

          {/* ── Daily Ad Performance (Raw) ── */}
          <SectionHeader>Daily Ad Performance</SectionHeader>

          <ChartContainer>
            <div className="table-wrapper">
              <table className="ad-asset-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="th-thumb">Preview</th>
                    <th className="hide-md">Asset ID</th>
                    <th>Ad Name</th>
                    <th className="hide-sm">Status</th>
                    <th className="th-num" title="Total Spend in Euros">Spend (€)</th>
                    <th className="th-num" title="Total Delivered Impressions">Impressions</th>
                    <th className="th-num hide-lg" title="Total Unique Reach">Reach</th>
                    <th className="th-num" title="Total Clicks">Clicks</th>
                    <th className="th-num" title="Click-Through Rate">CTR</th>
                    <th className="th-num" title="Cost Per Mille (Cost Per Thousand Impressions)">CPM</th>
                    <th className="th-num" title="Cost Per Click">CPC</th>
                    <th className="th-num hide-md" title="Total Engagements">Eng.</th>
                    <th className="th-num hide-lg" title="Landing Page Clicks">LPC</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyAdRows.map((row) => {
                    const numericId = row.creative_id.replace(/^urn:li:\w+:/, '');
                    const spend = row.spend_eur ?? 0;
                    const impressions = row.impressions ?? 0;
                    const clicks = row.clicks ?? 0;
                    const cpm = impressions ? (spend / impressions) * 1000 : 0;
                    const cpc = clicks ? spend / clicks : 0;
                    return (
                      <tr key={`${row.campaign_id}-${row.creative_id}-${row.date}`}>
                        <td className="td-nowrap">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                        <td className="td-thumb">
                          {row.creative_url ? (
                            <a href={row.creative_url} target="_blank" rel="noopener noreferrer" title={`Preview: ${row.creative_name}`}>
                              {row.thumbnail_url ? (
                                <img src={row.thumbnail_url} alt={row.creative_name} className="ad-thumb" />
                              ) : (
                                <span className="ad-thumb-placeholder">🖼️</span>
                              )}
                            </a>
                          ) : (
                            row.thumbnail_url ? (
                              <img src={row.thumbnail_url} alt={row.creative_name} className="ad-thumb" />
                            ) : (
                              <span className="ad-thumb-placeholder">🖼️</span>
                            )
                          )}
                        </td>
                        <td className="td-asset-id hide-md">
                          <code className="linkedin-id" title={row.creative_id}>{numericId}</code>
                        </td>
                        <td>
                          {row.creative_url ? (
                            <a
                              href={row.creative_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="creative-link"
                              title={`Preview ad on LinkedIn: ${row.creative_name}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', color: 'inherit' }}
                            >
                              <div className="td-truncate-inner" style={{ color: 'var(--color-blue)', fontWeight: 500 }}>{row.creative_name}</div>
                              <span style={{ fontSize: '11px', color: 'var(--color-blue)' }}>↗</span>
                            </a>
                          ) : (
                            <div className="td-truncate-inner" title={row.creative_name}>{row.creative_name}</div>
                          )}
                        </td>
                        <td className="td-nowrap hide-sm">{row.status ? <Badge status={row.status === 'ACTIVE' ? 'ACTIVE' : row.status === 'COMPLETED' ? 'COMPLETED' : 'PAUSED'} /> : <span className="td-dash">—</span>}</td>
                        <td className="td-nowrap td-num">{formatEUR(spend)}</td>
                        <td className="td-nowrap td-num">{formatNumber(impressions)}</td>
                        <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach ?? 0)}</td>
                        <td className="td-nowrap td-num">{formatNumber(clicks)}</td>
                        <td className="td-nowrap td-num">{formatPercent(row.ctr ?? 0, 3)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                        <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements ?? 0)}</td>
                        <td className="td-nowrap td-num hide-lg">{formatNumber(row.landing_page_clicks ?? 0)}</td>
                      </tr>
                    );
                  })}
                  {dailyAdRows.length === 0 && (
                    <tr>
                      <td colSpan={14} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>
                        No daily ad performance rows for the current selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ChartContainer>
        </>
      )}

      <Footer />
    </div>
  );
}
