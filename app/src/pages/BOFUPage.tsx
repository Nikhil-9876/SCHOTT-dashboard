import { useState, useMemo } from 'react';
import { useAdPerformance, useCampaignMetrics, useIngestionLog } from '../lib/queries';
import { formatEUR, formatEURCompact, formatNumber, formatPercent, computeDays, formatDays, formatDuration } from '../lib/formatters';
import {
  detectObjective,
  sum, wavg,
  computeVideoKPIs, buildCampaignVideoTotals, computeWatchDepth,
  shortLabel,
  type Objective,
  OBJECTIVES, OBJECTIVE_ORDER,
} from '../lib/campaignUtils';
import { useFunnelAdTable } from '../hooks/useFunnelAdTable';
import MetricCard from '../components/ui/MetricCard';
import SectionHeader from '../components/ui/SectionHeader';
import ChartContainer from '../components/ui/ChartContainer';
import Badge from '../components/ui/Badge';
import BarChart from '../components/charts/BarChart';
import Footer from '../components/layout/Footer';
import { SkeletonCard, SkeletonChart } from '../components/ui/Skeleton';
import VideoMetricToggle from '../components/ui/VideoMetricToggle';
import { AdAssetTable, DailyAdTable } from '../components/ui/FunnelTables';

// ── Component ──────────────────────────────────────────────────────────────
export default function BOFUPage() {
  const { data, isLoading, isError, refetch } = useCampaignMetrics('BOFU');
  const { data: adPerformance = [] } = useAdPerformance('BOFU');
  const { data: logs } = useIngestionLog();

  const [selectedObjective, setSelectedObjective] = useState<Objective>('All');
  const [videoMetricMode, setVideoMetricMode] = useState<'video' | 'general'>('video');

  // ── Campaigns with objective labels ──────────────────────────────────────
  const campaignsWithObjective = useMemo(() => {
    if (!data) return [];
    return data.map(c => ({ ...c, objective: detectObjective(c.name) }));
  }, [data]);

  const filteredCampaigns = useMemo(() => {
    const list = selectedObjective === 'All'
      ? campaignsWithObjective
      : campaignsWithObjective.filter(c => c.objective === selectedObjective);
    return [...list].sort((a, b) => OBJECTIVE_ORDER.indexOf(a.objective) - OBJECTIVE_ORDER.indexOf(b.objective));
  }, [campaignsWithObjective, selectedObjective]);

  // ── Status map for ad-row normalisation ──────────────────────────────────
  const campaignStatusMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    (data ?? []).forEach(c => { m[c.id] = c.status; });
    return m;
  }, [data]);

  const filteredAdRows = useMemo(() => {
    const allowedIds = new Set(filteredCampaigns.map(c => c.id));
    return adPerformance
      .filter(r => allowedIds.has(r.campaign_id))
      .map(r => {
        const campStatus = campaignStatusMap[r.campaign_id];
        if (r.status === 'ACTIVE' && campStatus && campStatus !== 'ACTIVE') return { ...r, status: campStatus };
        return r;
      });
  }, [adPerformance, filteredCampaigns, campaignStatusMap]);

  // ── Shared ad-table hook ──────────────────────────────────────────────────
  const adTable = useFunnelAdTable(filteredCampaigns, filteredAdRows);
  const { aggregatedAssets, sortedAssets, dailyAdRows, availableDates, selectedDate, setSelectedDate, clearAdSelection } = adTable;

  // ── Key metrics ───────────────────────────────────────────────────────────
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
  const avgCPL           = totalLeads ? totalSpend / totalLeads : 0;
  const convRate         = totalClicks ? (totalLeads / totalClicks) * 100 : 0;

  // ── Video KPIs ────────────────────────────────────────────────────────────
  const videoKPIs = useMemo(() => computeVideoKPIs(aggregatedAssets), [aggregatedAssets]);
  const { totalVideoViews, totalVideoCompletions, totalVideoQ1, totalVideoQ2, totalVideoQ3,
          totalVideoStarts, avgViewRate, avgCPV, videoCompletionRate, avgWatchDepth } = videoKPIs;

  const isVideoObjective = selectedObjective === 'Video Views';

  // ── Per-campaign video totals ─────────────────────────────────────────────
  const campaignVideoTotals = useMemo(() => buildCampaignVideoTotals(filteredAdRows), [filteredAdRows]);

  // ── Loading / Error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="content">
        <div style={{ background: '#fff', border: '1px solid #E0E4EA', borderLeft: '4px solid #3B82F6', padding: '1.25rem 1.75rem', marginBottom: '1.5rem' }}>
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
          <p style={{ marginBottom: '1rem' }}>Failed to load BOFU data.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    const hasSynced = logs && logs.length > 0;
    return (
      <div className="content">
        <div className="page-header page-header-bofu">
          <h2>FIOLAX Experience</h2>
          <p>BOFU • Lead Gen</p>
        </div>
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA' }}>
          <p style={{ fontSize: '15px', marginBottom: '0.5rem', fontWeight: 600, color: '#062E62' }}>
            {hasSynced ? 'No matching campaign data found' : 'No data synced yet'}
          </p>
          {hasSynced && (
            <p style={{ marginBottom: '0.5rem' }}>
              A sync has been performed, but no campaigns matching the BOFU (Lead Gen) stage criteria were found.
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
      <div className="page-header page-header-bofu">
        <h2>FIOLAX Experience</h2>
        <p>BOFU • Lead Gen</p>
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
                onClick={() => { setSelectedObjective(obj); clearAdSelection(); setSelectedDate(''); }}
              >
                {obj}
              </button>
            ))}
          </div>
        </div>
        {selectedObjective !== 'All' && (
          <div className="filter-group" style={{ marginLeft: 'auto' }}>
            <button className="filter-clear" onClick={() => { setSelectedObjective('All'); clearAdSelection(); setSelectedDate(''); }}>
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
          {/* BOFU-specific: Lead Gen KPIs */}
          <div className="grid-3" style={{ marginBottom: isVideoObjective ? '1rem' : '1.5rem' }}>
            <MetricCard label="Leads"      value={formatNumber(totalLeads)} />
            <MetricCard label="CPL"        value={formatEUR(avgCPL)} />
            <MetricCard label="Conv. Rate" value={`${convRate.toFixed(1)}%`} />
          </div>
          {isVideoObjective && (
            <div className="grid-5" style={{ marginBottom: '1.5rem' }}>
              <MetricCard label="Video Views"  value={formatNumber(totalVideoViews)} />
              <MetricCard label="Video Starts" value={formatNumber(totalVideoStarts)} />
              <MetricCard label="View Rate"    value={formatPercent(avgViewRate)} />
              <MetricCard label="Completions"  value={formatNumber(totalVideoCompletions)} />
              <MetricCard label="CPV"          value={formatEUR(avgCPV)} />
            </div>
          )}
          {isVideoObjective && <>
            <div className="grid-5" style={{ marginBottom: '1.5rem' }}>
              <MetricCard label="25% Completions" value={formatNumber(totalVideoQ1)} />
              <MetricCard label="50% Completions" value={formatNumber(totalVideoQ2)} />
              <MetricCard label="75% Completions" value={formatNumber(totalVideoQ3)} />
              <MetricCard label="CR%"             value={formatPercent(videoCompletionRate)} />
              <MetricCard label="Avg Watch Depth" value={formatPercent(avgWatchDepth)} />
            </div>
          </>}

          {/* Campaign Details */}
          {isVideoObjective ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', margin: '2rem 0 1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--color-navy)' }}>
              <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>Campaign Details</span>
              <VideoMetricToggle mode={videoMetricMode} onChange={setVideoMetricMode} />
            </div>
          ) : (
            <SectionHeader>Campaign Details</SectionHeader>
          )}
          <ChartContainer>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Campaign Name</th><th>Objective</th><th>Status</th><th className="td-num">Ads</th>
                    {!(isVideoObjective && videoMetricMode === 'video') && <><th className="td-num" title="Total Spend in Euros">Spent</th><th className="td-num">Impressions</th></>}
                    {isVideoObjective && videoMetricMode === 'video' ? (
                      <><th className="td-num" title="Video Views">Video Views</th><th className="td-num" title="View Rate">VR%</th><th className="td-num" title="Video Starts">VS</th><th className="td-num" title="25% watched">25%</th><th className="td-num" title="50% watched">50%</th><th className="td-num" title="75% watched">75%</th><th className="td-num" title="Completions">100%</th><th className="td-num" title="Completion Rate">CR%</th><th className="td-num" title="Cost Per View">CPV</th><th className="td-num" title="Avg Watch Depth">AWD%</th></>
                    ) : (
                      <><th className="td-num" title="Reach">Reach</th><th className="td-num">Clicks</th><th className="td-num" title="CTR">CTR</th><th className="td-num" title="CPM">CPM</th><th className="td-num" title="CPC">CPC</th><th className="td-num">Leads</th><th className="td-num" title="CPL">CPL</th><th className="td-num" title="Days running">Days</th></>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map(c => {
                    const m           = c.latest_metric;
                    const spend       = m?.spend_eur   ?? 0;
                    const impressions = m?.impressions  ?? 0;
                    const clicks      = m?.clicks       ?? 0;
                    const leads       = m?.leads        ?? 0;
                    const cpm         = impressions ? (spend / impressions) * 1000 : 0;
                    const cpc         = clicks ? spend / clicks : 0;
                    const cpl         = leads ? spend / leads : 0;
                    const days        = formatDays(computeDays(m?.date_range_start, c.status === 'ACTIVE' ? undefined : m?.date_range_end));

                    if (isVideoObjective && videoMetricMode === 'video') {
                      const v = campaignVideoTotals.get(c.id) ?? { video_views: 0, video_starts: 0, video_completions: 0, video_q1: 0, video_q2: 0, video_q3: 0, spend: 0, impressions: 0 };
                      const vImpr      = v.impressions || impressions;
                      const vViewRate  = vImpr > 0 ? v.video_views / vImpr : 0;
                      const vCPV       = v.video_views > 0 ? v.spend / v.video_views : 0;
                      const vComplRate = v.video_views > 0 ? v.video_completions / v.video_views : 0;
                      const vDepth     = computeWatchDepth(v.video_views, v.video_q1, v.video_q2, v.video_q3, v.video_completions);
                      return (
                        <tr key={c.id}>
                          <td>{c.name}</td>
                          <td><span className={`objective-tag objective-${c.objective.toLowerCase().replace(' ', '-')}`}>{c.objective}</span></td>
                          <td><Badge status={c.status} /></td>
                          <td className="td-nowrap td-num">{c.ad_count}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_views)}</td>
                          <td className="td-nowrap td-num">{formatPercent(vViewRate)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_starts)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_q1)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_q2)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_q3)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_completions)}</td>
                          <td className="td-nowrap td-num">{formatPercent(vComplRate)}</td>
                          <td className="td-nowrap td-num">{formatEUR(vCPV)}</td>
                          <td className="td-nowrap td-num">{formatPercent(vDepth)}</td>
                          <td className="td-nowrap td-num">{(() => {
                            const assets = aggregatedAssets.filter(a => a.campaign_id === c.id);
                            const { wDur, wViews } = assets.reduce((acc, a) => {
                              if (a.video_duration_seconds != null && a.video_views > 0) {
                                acc.wDur   += a.avg_watch_depth * a.video_duration_seconds * a.video_views;
                                acc.wViews += a.video_views;
                              }
                              return acc;
                            }, { wDur: 0, wViews: 0 });
                            return formatDuration(wViews > 0 ? wDur / wViews : null);
                          })()}</td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td><span className={`objective-tag objective-${c.objective.toLowerCase().replace(' ', '-')}`}>{c.objective}</span></td>
                        <td><Badge status={c.status} /></td>
                        <td className="td-nowrap td-num">{c.ad_count}</td>
                        <td className="td-nowrap td-num">{formatEUR(spend)}</td>
                        <td className="td-nowrap td-num">{formatNumber(impressions)}</td>
                        <td className="td-nowrap td-num">{formatNumber(m?.reach ?? 0)}</td>
                        <td className="td-nowrap td-num">{formatNumber(clicks)}</td>
                        <td className="td-nowrap td-num">{formatPercent(m?.ctr ?? 0)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                        <td className="td-nowrap td-num">{formatNumber(leads)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpl)}</td>
                        <td className="td-nowrap td-num">{days}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartContainer>

          {/* ── Impressions & CTR Charts ── */}
          {filteredCampaigns.length > 0 && (() => {
            let chartLabels: string[], chartColors: string[], impressionVals: number[], ctrVals: number[], chartTitle1: string, chartTitle2: string;

            if (selectedObjective === 'All') {
              const OBJECTIVE_COLORS: Record<string, string> = {
                'Awareness': '#062E62', 'Engagement': '#0050FF', 'Video Views': '#3B82F6',
              };
              type ObjKey = 'Awareness' | 'Engagement' | 'Video Views';
              const objKeys: ObjKey[] = ['Awareness', 'Engagement', 'Video Views'];
              const grouped = objKeys.reduce<Record<ObjKey, { impressions: number; clicks: number }>>((acc, k) => {
                acc[k] = { impressions: 0, clicks: 0 }; return acc;
              }, {} as any);
              filteredCampaigns.forEach(c => {
                const obj = c.objective as ObjKey;
                if (!grouped[obj]) return;
                grouped[obj].impressions += c.latest_metric?.impressions ?? 0;
                grouped[obj].clicks      += c.latest_metric?.clicks      ?? 0;
              });
              const activeKeys = objKeys.filter(k => grouped[k].impressions > 0 || grouped[k].clicks > 0);
              chartLabels    = activeKeys;
              chartColors    = activeKeys.map(k => OBJECTIVE_COLORS[k]);
              impressionVals = activeKeys.map(k => grouped[k].impressions);
              ctrVals        = activeKeys.map(k => {
                const { clicks, impressions } = grouped[k];
                return impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(3)) : 0;
              });
              chartTitle1 = 'Impressions by Objective';
              chartTitle2 = 'CTR by Objective';
            } else {
              chartLabels    = filteredCampaigns.map(c => shortLabel(c.name));
              chartColors    = filteredCampaigns.map(() => '#3B82F6');
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

          {/* ── BOFU: Conversion Funnel Summary ── */}
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

          {/* ── Ad Performance by Asset ── */}
          <AdAssetTable
            sortedAssets={sortedAssets}
            aggregatedAssets={aggregatedAssets}
            selectedAdKeys={adTable.selectedAdKeys}
            setSelectedAdKeys={adTable.setSelectedAdKeys}
            clearAdSelection={adTable.clearAdSelection}
            toggleAdSelection={adTable.toggleAdSelection}
            handleSort={adTable.handleSort}
            renderSortIndicator={adTable.renderSortIndicator}
            isVideoObjective={isVideoObjective}
            videoMetricMode={videoMetricMode}
            setVideoMetricMode={setVideoMetricMode}
            subtitle={<>Aggregated lifetime metrics per ad creative, mapped to the LinkedIn Asset ID.{selectedObjective !== 'All' && <> &nbsp;Showing: <strong>{selectedObjective}</strong> campaign ads</>}</>}
          />

          {/* ── Daily Ad Performance ── */}
          <DailyAdTable
            dailyAdRows={dailyAdRows}
            availableDates={availableDates}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            isVideoObjective={isVideoObjective}
            videoMetricMode={videoMetricMode}
            setVideoMetricMode={setVideoMetricMode}
          />
        </>
      )}

      <Footer />
    </div>
  );
}
