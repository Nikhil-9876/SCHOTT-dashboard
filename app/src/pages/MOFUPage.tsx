import { useState, useMemo } from 'react';
import { useAdPerformance, useCampaignMetrics, useIngestionLog } from '../lib/queries';
import { formatEUR, formatEURCompact, formatNumber, formatPercent, computeDays, formatDays } from '../lib/formatters';
import { sum, wavg, isWebsiteVisitsCampaign, detectMofuObjective, shortLabel, MOFU_OBJECTIVES, MOFU_OBJECTIVE_ORDER } from '../lib/campaignUtils';
import type { MofuObjective } from '../lib/campaignUtils';
import { useFunnelAdTable } from '../hooks/useFunnelAdTable';
import MetricCard from '../components/ui/MetricCard';
import SectionHeader from '../components/ui/SectionHeader';
import ChartContainer from '../components/ui/ChartContainer';
import Badge from '../components/ui/Badge';
import BarChart from '../components/charts/BarChart';
import Footer from '../components/layout/Footer';
import { SkeletonCard, SkeletonChart } from '../components/ui/Skeleton';
import { AdAssetTable, DailyAdTable } from '../components/ui/FunnelTables';

// ── Component ──────────────────────────────────────────────────────────────
export default function MOFUPage() {
  const { data: mofuData, isLoading: mofuLoading, isError: mofuError, refetch } = useCampaignMetrics('MOFU');
  const { data: tofuData, isLoading: tofuLoading } = useCampaignMetrics('TOFU');
  const { data: mofuAdPerf = [], isLoading: mofuAdLoading } = useAdPerformance('MOFU');
  const { data: tofuAdPerf = [], isLoading: tofuAdLoading } = useAdPerformance('TOFU');
  const { data: logs } = useIngestionLog();

  const isLoading = mofuLoading || tofuLoading || mofuAdLoading || tofuAdLoading;
  const isError   = mofuError;

  // Show ALL campaigns tagged funnel_stage=MOFU in the DB.
  // Also bridge any WV-named campaigns still sitting in TOFU (backward compat
  // for campaigns ingested before the funnel_stage override was added).
  const allMofu    = mofuData ?? [];
  const mofuIds    = new Set(allMofu.map(c => c.id));
  const wvFromTofu = (tofuData ?? []).filter(c => isWebsiteVisitsCampaign(c.name) && !mofuIds.has(c.id));
  const data       = isLoading ? undefined : [...allMofu, ...wvFromTofu];

  // Ad rows: all MOFU campaigns + bridged WV-from-TOFU rows
  const allMofuIds = new Set([...allMofu, ...wvFromTofu].map(c => c.id));
  const wvAdPerf   = tofuAdPerf.filter(r => allMofuIds.has(r.campaign_id));
  const adPerformance = [...mofuAdPerf, ...wvAdPerf];

  // ── Objective filter ───────────────────────────────────────────────────────
  const [selectedObjective, setSelectedObjective] = useState<MofuObjective>('All');

  const campaignsWithObjective = useMemo(() => {
    if (!data) return [];
    return data.map(c => ({ ...c, objective: detectMofuObjective(c.name) }));
  }, [data]);

  // Only show pills for objectives that actually exist in the current data
  const presentObjectives = useMemo<MofuObjective[]>(() => {
    const present = new Set(campaignsWithObjective.map(c => c.objective));
    return MOFU_OBJECTIVES.filter(o => o === 'All' || present.has(o as Exclude<MofuObjective, 'All'>));
  }, [campaignsWithObjective]);

  const filteredCampaigns = useMemo(() => {
    const list = selectedObjective === 'All'
      ? campaignsWithObjective
      : campaignsWithObjective.filter(c => c.objective === selectedObjective);
    return [...list].sort((a, b) => MOFU_OBJECTIVE_ORDER.indexOf(a.objective) - MOFU_OBJECTIVE_ORDER.indexOf(b.objective));
  }, [campaignsWithObjective, selectedObjective]);

  // ── Shared ad-table hook (scoped to filtered campaigns) ───────────────────
  const filteredAdRows = useMemo(() => {
    const allowedIds = new Set(filteredCampaigns.map(c => c.id));
    return adPerformance.filter(r => allowedIds.has(r.campaign_id));
  }, [adPerformance, filteredCampaigns]);

  const adTable = useFunnelAdTable(filteredCampaigns, filteredAdRows);
  const { aggregatedAssets, sortedAssets, dailyAdRows, availableDates, selectedDate, setSelectedDate } = adTable;

  // ── Key metrics (scoped to filtered campaigns) ────────────────────────────
  const completed    = filteredCampaigns.filter(c => c.status === 'COMPLETED');
  const active       = filteredCampaigns.filter(c => c.status === 'ACTIVE');
  const completedAds = completed.reduce((a, c) => a + c.ad_count, 0);
  const activeAds    = active.reduce((a, c) => a + c.ad_count, 0);

  const totalAds         = filteredCampaigns.reduce((a, c) => a + c.ad_count, 0);
  const totalSpend       = sum(filteredCampaigns, 'spend_eur');
  const totalReach       = sum(filteredCampaigns, 'reach');
  const totalImpressions = sum(filteredCampaigns, 'impressions');
  const totalClicks      = sum(filteredCampaigns, 'clicks');
  const totalLeads       = sum(filteredCampaigns, 'leads');
  const avgCPM           = totalImpressions ? (totalSpend / totalImpressions) * 1000 : 0;
  const avgCPC           = totalClicks ? totalSpend / totalClicks : 0;
  const avgCTR           = wavg(filteredCampaigns, 'ctr', 'impressions');
  const avgEngRate       = wavg(filteredCampaigns, 'engagement_rate', 'impressions');

  // Website Visits / MOFU specific KPIs
  const totalLPC      = aggregatedAssets.reduce((acc, r) => acc + (r.landing_page_clicks ?? 0), 0);
  const avgCostPerLPC = totalLPC > 0 ? totalSpend / totalLPC : 0;

  // ── Loading / Error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="content">
        <div style={{ background: '#fff', border: '1px solid #E0E4EA', borderLeft: '4px solid #0050FF', padding: '1.25rem 1.75rem', marginBottom: '1.5rem' }}>
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
          <p style={{ marginBottom: '1rem' }}>Failed to load MOFU data.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    const hasSynced = logs && logs.length > 0;
    return (
      <div className="content">
        <div className="page-header page-header-mofu">
          <h2>FIOLAX Insight</h2>
          <p>MOFU • Consideration Stage</p>
        </div>
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA' }}>
          <p style={{ fontSize: '15px', marginBottom: '0.5rem', fontWeight: 600, color: '#062E62' }}>
            {hasSynced ? 'No MOFU campaigns found' : 'No data synced yet'}
          </p>
          {hasSynced && (
            <p style={{ marginBottom: '0.5rem' }}>
              A sync has been performed, but no campaigns matching the MOFU (Consideration) stage criteria were found.
            </p>
          )}
          <p>Click <strong>Sync Now</strong> in the header to {hasSynced ? 'refresh' : 'load your LinkedIn campaigns'}.</p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="content">
      {/* Page Header */}
      <div className="page-header page-header-mofu">
        <h2>FIOLAX Insight</h2>
        <p>MOFU • Consideration Stage</p>
      </div>

      {/* ── Filter Bar ── */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Filter</span>
          <div className="filter-pills">
            {presentObjectives.map(obj => (
              <button
                key={obj}
                className={`filter-pill${selectedObjective === obj ? ' active' : ''}`}
                onClick={() => { setSelectedObjective(obj); adTable.clearAdSelection(); setSelectedDate(''); }}
              >
                {obj}
              </button>
            ))}
          </div>
        </div>
        {selectedObjective !== 'All' && (
          <div className="filter-group" style={{ marginLeft: 'auto' }}>
            <button className="filter-clear" onClick={() => { setSelectedObjective('All'); adTable.clearAdSelection(); setSelectedDate(''); }}>
              ✕ Clear
            </button>
          </div>
        )}
      </div>

      {/* ── No results ── */}
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
            <MetricCard label="Spend"       value={formatEURCompact(totalSpend)} />
            <MetricCard label="Reach"       value={formatNumber(totalReach)} />
            <MetricCard label="Impressions" value={formatNumber(totalImpressions)} />
            <MetricCard label="CPM"         value={formatEUR(avgCPM)} />
            <MetricCard label="CTR"         value={formatPercent(avgCTR)} />
          </div>
          <div className="grid-4" style={{ marginBottom: '1rem' }}>
            <MetricCard label="Engagement Rate" value={formatPercent(avgEngRate)} />
            <MetricCard label="Ads"             value={formatNumber(totalAds)} />
            <MetricCard label="Clicks"          value={formatNumber(totalClicks)} />
            <MetricCard label="CPC"             value={formatEUR(avgCPC)} />
          </div>
          {/* MOFU specific KPIs */}
          <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
            <MetricCard label="Landing Page Clicks" value={formatNumber(totalLPC)} />
            <MetricCard label="Cost / LPC"          value={formatEUR(avgCostPerLPC)} />
            <MetricCard label="Leads"               value={formatNumber(totalLeads)} />
          </div>

          {/* Campaign Details */}
          <SectionHeader>Campaign Details</SectionHeader>
          <ChartContainer>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Campaign Name</th><th>Objective</th><th>Status</th><th className="td-num">Ads</th>
                    <th className="td-num" title="Total Spend in Euros">Spent</th>
                    <th className="td-num">Impressions</th>
                    <th className="td-num" title="Total Unique Reach">Reach</th>
                    <th className="td-num">Clicks</th>
                    <th className="td-num" title="Click-Through Rate">CTR</th>
                    <th className="td-num" title="Cost Per Mille">CPM</th>
                    <th className="td-num" title="Cost Per Click">CPC</th>
                    <th className="td-num" title="Landing Page Clicks">LPC</th>
                    <th className="td-num" title="Leads">Leads</th>
                    <th className="td-num" title="Days running">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map(c => {
                    const m           = c.latest_metric;
                    const spend       = m?.spend_eur   ?? 0;
                    const impressions = m?.impressions  ?? 0;
                    const clicks      = m?.clicks       ?? 0;
                    const cpm         = impressions ? (spend / impressions) * 1000 : 0;
                    const cpc         = clicks ? spend / clicks : 0;
                    const days        = formatDays(computeDays(m?.date_range_start, c.status === 'ACTIVE' ? undefined : m?.date_range_end));
                    const campLPC     = aggregatedAssets.filter(a => a.campaign_id === c.id).reduce((acc, a) => acc + (a.landing_page_clicks ?? 0), 0);
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td><span className={`objective-tag objective-${c.objective.toLowerCase().replace(/ /g, '-')}`}>{c.objective}</span></td>
                        <td><Badge status={c.status} /></td>
                        <td className="td-nowrap td-num">{c.ad_count}</td>
                        <td className="td-nowrap td-num">{formatEUR(spend)}</td>
                        <td className="td-nowrap td-num">{formatNumber(impressions)}</td>
                        <td className="td-nowrap td-num">{formatNumber(m?.reach ?? 0)}</td>
                        <td className="td-nowrap td-num">{formatNumber(clicks)}</td>
                        <td className="td-nowrap td-num">{formatPercent(m?.ctr ?? 0)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                        <td className="td-nowrap td-num">{formatNumber(campLPC)}</td>
                        <td className="td-nowrap td-num">{formatNumber(m?.leads ?? 0)}</td>
                        <td className="td-nowrap td-num">{days}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartContainer>

          {/* Impressions & CTR Charts */}
          {filteredCampaigns.length > 0 && (() => {
            let chartLabels: string[], chartColors: string[], impressionVals: number[], ctrVals: number[], chartTitle1: string, chartTitle2: string;

            if (selectedObjective === 'All') {
              const OBJECTIVE_COLORS: Record<string, string> = {
                'Website Visits':             '#0050FF',
                'Website Visits Retargeting': '#062E62',
                'Retargeting':                '#3B82F6',
                'Webinar':                    '#7C3AED',
                'Awareness':                  '#0891B2',
                'Engagement':                 '#059669',
                'Video Views':                '#D97706',
              };
              const grouped = new Map<string, { impressions: number; clicks: number }>();
              filteredCampaigns.forEach(c => {
                const obj = c.objective;
                const prev = grouped.get(obj) ?? { impressions: 0, clicks: 0 };
                grouped.set(obj, {
                  impressions: prev.impressions + (c.latest_metric?.impressions ?? 0),
                  clicks:      prev.clicks      + (c.latest_metric?.clicks      ?? 0),
                });
              });
              const activeKeys = MOFU_OBJECTIVE_ORDER.filter(k => grouped.has(k));
              chartLabels    = activeKeys;
              chartColors    = activeKeys.map(k => OBJECTIVE_COLORS[k] ?? '#0050FF');
              impressionVals = activeKeys.map(k => grouped.get(k)!.impressions);
              ctrVals        = activeKeys.map(k => {
                const { clicks, impressions } = grouped.get(k)!;
                return impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(3)) : 0;
              });
              chartTitle1 = 'Impressions by Objective';
              chartTitle2 = 'CTR by Objective';
            } else {
              chartLabels    = filteredCampaigns.map(c => shortLabel(c.name));
              chartColors    = filteredCampaigns.map(() => '#0050FF');
              impressionVals = filteredCampaigns.map(c => c.latest_metric?.impressions ?? 0);
              ctrVals        = filteredCampaigns.map(c => {
                const clicks      = c.latest_metric?.clicks      ?? 0;
                const impressions = c.latest_metric?.impressions ?? 0;
                return impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(3)) : 0;
              });
              chartTitle1 = `Impressions — ${selectedObjective}`;
              chartTitle2 = `CTR — ${selectedObjective}`;
            }

            return (
              <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
                <ChartContainer title={chartTitle1}>
                  <BarChart labels={chartLabels} values={impressionVals} colors={chartColors} height={280} textFormat={v => formatNumber(v)} />
                </ChartContainer>
                <ChartContainer title={chartTitle2}>
                  <BarChart labels={chartLabels} values={ctrVals} colors={chartColors} height={280} textFormat={v => `${v}%`} />
                </ChartContainer>
              </div>
            );
          })()}

          {/* Ad Performance by Asset */}
          <AdAssetTable
            sortedAssets={sortedAssets}
            aggregatedAssets={aggregatedAssets}
            selectedAdKeys={adTable.selectedAdKeys}
            setSelectedAdKeys={adTable.setSelectedAdKeys}
            clearAdSelection={adTable.clearAdSelection}
            toggleAdSelection={adTable.toggleAdSelection}
            handleSort={adTable.handleSort}
            renderSortIndicator={adTable.renderSortIndicator}
            isVideoObjective={false}
            videoMetricMode="general"
            setVideoMetricMode={() => {}}
            subtitle={<>Aggregated lifetime metrics per ad creative, mapped to the LinkedIn Asset ID.{selectedObjective !== 'All' && <> &nbsp;Showing: <strong>{selectedObjective}</strong> campaign ads</>}</>}
          />

          {/* Daily Ad Performance */}
          <DailyAdTable
            dailyAdRows={dailyAdRows}
            availableDates={availableDates}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            isVideoObjective={false}
            videoMetricMode="general"
            setVideoMetricMode={() => {}}
          />
        </>
      )}

      <Footer />
    </div>
  );
}
