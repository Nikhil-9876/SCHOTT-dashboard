import { useState, useMemo } from 'react';
import { useAdPerformance, useCampaignMetrics, useIngestionLog } from '../lib/queries';
import { formatEUR, formatEURCompact, formatNumber, formatPercent, computeDays, formatDays } from '../lib/formatters';
import MetricCard from '../components/ui/MetricCard';
import SectionHeader from '../components/ui/SectionHeader';
import ChartContainer from '../components/ui/ChartContainer';
import Badge from '../components/ui/Badge';
import BarChart from '../components/charts/BarChart';
import Footer from '../components/layout/Footer';
import { SkeletonCard, SkeletonChart } from '../components/ui/Skeleton';
import AssetThumbnail from '../components/ui/AssetThumbnail';
import DatePickerCalendar from '../components/ui/DatePickerCalendar';
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
  days_running: number | null;
  video_views: number;
  video_completions: number;
  video_starts: number;
  video_first_quartile_completions: number;
  video_midpoint_completions: number;
  video_third_quartile_completions: number;
}

function aggregateAdsByCreative(rows: AdPerformanceMetric[], campaignNameMap: Record<string, string>): AggregatedAd[] {
  const map = new Map<string, AggregatedAd>();
  // Track earliest and latest date per creative key
  const minDate = new Map<string, string>();
  const maxDate = new Map<string, string>();

  for (const row of rows) {
    const key = `${row.campaign_id}__${row.creative_id}`;
    // Track date range
    if (row.date) {
      const prev = minDate.get(key);
      if (!prev || row.date < prev) minDate.set(key, row.date);
      const prevMax = maxDate.get(key);
      if (!prevMax || row.date > prevMax) maxDate.set(key, row.date);
    }
    const existing = map.get(key);
    if (existing) {
      existing.spend_eur += row.spend_eur ?? 0;
      existing.impressions += row.impressions ?? 0;
      existing.reach += row.reach ?? 0;
      existing.clicks += row.clicks ?? 0;
      existing.engagements += row.engagements ?? 0;
      existing.landing_page_clicks += row.landing_page_clicks ?? 0;
      existing.video_views += row.video_views ?? 0;
      existing.video_completions += row.video_completions ?? 0;
      existing.video_starts += row.video_starts ?? 0;
      existing.video_first_quartile_completions += row.video_first_quartile_completions ?? 0;
      existing.video_midpoint_completions += row.video_midpoint_completions ?? 0;
      existing.video_third_quartile_completions += row.video_third_quartile_completions ?? 0;
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
        days_running: null, // filled below
        video_views: row.video_views ?? 0,
        video_completions: row.video_completions ?? 0,
        video_starts: row.video_starts ?? 0,
        video_first_quartile_completions: row.video_first_quartile_completions ?? 0,
        video_midpoint_completions: row.video_midpoint_completions ?? 0,
        video_third_quartile_completions: row.video_third_quartile_completions ?? 0,
      });
    }
  }

  // Compute days_running for each aggregated ad
  for (const [key, ad] of map.entries()) {
    const start = minDate.get(key);
    const end = maxDate.get(key);
    if (start) {
      // If the ad is still active, count up to today; otherwise use last data date
      const useEnd = ad.status === 'ACTIVE' ? undefined : end;
      ad.days_running = computeDays(start, useEnd);
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
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [videoMetricMode, setVideoMetricMode] = useState<'video' | 'general'>('video');

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

  // Sorting state for Ads by Asset table
  const [sortField, setSortField] = useState<keyof AggregatedAd | 'cpm' | 'cpc'>('impressions');
  const [sortAscending, setSortAscending] = useState<boolean>(false);

  function handleSort(field: keyof AggregatedAd | 'cpm' | 'cpc') {
    if (sortField === field) {
      setSortAscending(prev => !prev);
    } else {
      setSortField(field);
      const isStringField = field === 'creative_name' || field === 'campaign_name' || field === 'status' || field === 'creative_id';
      setSortAscending(isStringField);
    }
  }

  function renderSortIndicatorAd(field: keyof AggregatedAd | 'cpm' | 'cpc') {
    if (sortField !== field) return null;
    return sortAscending ? ' ▲' : ' ▼';
  }

  function renderSortIndicator(field: keyof AggregatedAd | 'cpm' | 'cpc') {
    if (sortField !== field) return null;
    return sortAscending ? ' ▲' : ' ▼';
  }

  // ── Derived: campaigns with objective label ─────────────────────────────
  const campaignsWithObjective = useMemo(() => {
    if (!data) return [];
    return data.map(c => ({ ...c, objective: detectObjective(c.name) }));
  }, [data]);

  // ── Filter by objective (1 campaign per objective, no sub-filter needed) ─
  // Also exclude known stale/old campaigns that should not appear on the dashboard
  const EXCLUDED_CAMPAIGN_NAMES = ['video views - jan 30, 2026', 'video views - jul 22, 2026'];
  const filteredCampaigns = useMemo(() => {
    let result = campaignsWithObjective.filter(
      c => !EXCLUDED_CAMPAIGN_NAMES.includes(c.name.toLowerCase())
    );
    if (selectedObjective === 'All') return result;
    return result.filter(c => c.objective === selectedObjective);
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

  // ── Sorted assets ───────────────────────────────────────────────────────
  const sortedAssets = useMemo(() => {
    return [...aggregatedAssets].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortField === 'cpm') {
        aVal = a.impressions ? (a.spend_eur / a.impressions) * 1000 : 0;
        bVal = b.impressions ? (b.spend_eur / b.impressions) * 1000 : 0;
      } else if (sortField === 'cpc') {
        aVal = a.clicks ? a.spend_eur / a.clicks : 0;
        bVal = b.clicks ? b.spend_eur / b.clicks : 0;
      } else {
        aVal = a[sortField];
        bVal = b[sortField];
      }

      if (aVal === null || aVal === undefined) return sortAscending ? -1 : 1;
      if (bVal === null || bVal === undefined) return sortAscending ? 1 : -1;

      if (typeof aVal === 'string') {
        return sortAscending
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      } else {
        return sortAscending
          ? aVal - bVal
          : bVal - aVal;
      }
    });
  }, [aggregatedAssets, sortField, sortAscending]);

  // ── Available dates for the date picker ───────────────────────────────────
  const availableDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of filteredAdRows) { if (r.date) s.add(r.date.slice(0, 10)); }
    return s;
  }, [filteredAdRows]);

  const minAvailableDate = useMemo(() => {
    if (availableDates.size === 0) return '';
    return Array.from(availableDates).sort()[0];
  }, [availableDates]);

  const maxAvailableDate = useMemo(() => {
    if (availableDates.size === 0) return '';
    return Array.from(availableDates).sort().slice(-1)[0];
  }, [availableDates]);

  // ── Daily rows filtered by selected ads + date ─────────────────────────────
  const dailyAdRows = useMemo(() => {
    let rows = filteredAdRows;
    if (selectedAdKeys.size > 0) rows = rows.filter(r => selectedAdKeys.has(`${r.campaign_id}__${r.creative_id}`));
    if (selectedDate) rows = rows.filter(r => r.date?.slice(0, 10) === selectedDate);
    return rows;
  }, [filteredAdRows, selectedAdKeys, selectedDate]);


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

  // ── Video KPIs (sourced from ad_performance_metrics via CREATIVE pivot) ───
  // LinkedIn's adAnalytics CAMPAIGN pivot does not return video fields.
  // We sum them from aggregatedAssets (ad-level creative data) instead.
  const totalVideoViews = aggregatedAssets.reduce((acc, r) => acc + (r.video_views ?? 0), 0);
  const totalVideoCompletions = aggregatedAssets.reduce((acc, r) => acc + (r.video_completions ?? 0), 0);
  const totalVideoQ1 = aggregatedAssets.reduce((acc, r) => acc + (r.video_first_quartile_completions ?? 0), 0);
  const totalVideoQ2 = aggregatedAssets.reduce((acc, r) => acc + (r.video_midpoint_completions ?? 0), 0);
  const totalVideoQ3 = aggregatedAssets.reduce((acc, r) => acc + (r.video_third_quartile_completions ?? 0), 0);
  const totalVideoStarts = aggregatedAssets.reduce((acc, r) => acc + (r.video_starts ?? 0), 0);
  const totalVideoSpend = aggregatedAssets.reduce((acc, r) => acc + (r.spend_eur ?? 0), 0);
  const totalVideoImpressions = aggregatedAssets.reduce((acc, r) => acc + (r.impressions ?? 0), 0);
  const avgViewRate = totalVideoImpressions > 0 ? totalVideoViews / totalVideoImpressions : 0;
  const avgCPV = totalVideoViews > 0 ? totalVideoSpend / totalVideoViews : 0;
  const videoCompletionRate = totalVideoViews > 0 ? totalVideoCompletions / totalVideoViews : 0;
  const isVideoObjective = selectedObjective === 'Video Views';

  // ── Per-campaign video totals (aggregated from ad_performance_metrics) ────
  // Used to populate per-row video metrics in the campaign table
  const campaignVideoTotals = useMemo(() => {
    const map = new Map<string, {
      video_views: number; video_starts: number; video_completions: number;
      video_q1: number; video_q2: number; video_q3: number;
      spend: number; impressions: number;
    }>();
    for (const row of filteredAdRows) {
      const id = row.campaign_id;
      const prev = map.get(id) ?? { video_views: 0, video_starts: 0, video_completions: 0, video_q1: 0, video_q2: 0, video_q3: 0, spend: 0, impressions: 0 };
      map.set(id, {
        video_views: prev.video_views + (row.video_views ?? 0),
        video_starts: prev.video_starts + (row.video_starts ?? 0),
        video_completions: prev.video_completions + (row.video_completions ?? 0),
        video_q1: prev.video_q1 + (row.video_first_quartile_completions ?? 0),
        video_q2: prev.video_q2 + (row.video_midpoint_completions ?? 0),
        video_q3: prev.video_q3 + (row.video_third_quartile_completions ?? 0),
        spend: prev.spend + (row.spend_eur ?? 0),
        impressions: prev.impressions + (row.impressions ?? 0),
      });
    }
    return map;
  }, [filteredAdRows]);

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
                onClick={() => {
                  setSelectedObjective(obj);
                  clearAdSelection();
                  setSelectedDate('');
                }}
              >
                {obj}
              </button>
            ))}
          </div>
        </div>

        {selectedObjective !== 'All' && (
          <div className="filter-group" style={{ marginLeft: 'auto' }}>
            <button
              className="filter-clear"
              onClick={() => {
                setSelectedObjective('All');
                clearAdSelection();
                setSelectedDate('');
              }}
            >
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
          <div className="grid-4" style={{ marginBottom: isVideoObjective ? '1rem' : '1.5rem' }}>
            <MetricCard label="Engagement Rate" value={formatPercent(avgEngRate)} />
            <MetricCard label="Ads" value={formatNumber(totalAds)} />
            <MetricCard label="Clicks" value={formatNumber(totalClicks)} />
            <MetricCard label="CPC" value={formatEUR(avgCPC)} />
          </div>
          {isVideoObjective && (
            <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
              <MetricCard label="Video Views" value={formatNumber(totalVideoViews)} />
              <MetricCard label="View Rate" value={formatPercent(avgViewRate)} />
              <MetricCard label="CPV" value={formatEUR(avgCPV)} />
              <MetricCard label="Completion Rate" value={formatPercent(videoCompletionRate)} />
            </div>
          )}

          {/* Campaign Details */}
          {isVideoObjective ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', margin: '2rem 0 1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--color-navy)' }}>
              <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>Campaign Details</span>
              <div className="filter-group" style={{ margin: 0 }}>
                <span className="filter-label" style={{ fontSize: 11, fontWeight: 700 }}>VIEW METRICS:</span>
                <div className="filter-pills">
                  <button
                    className={`filter-pill ${videoMetricMode === 'general' ? 'active' : ''}`}
                    onClick={() => setVideoMetricMode('general')}
                    style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
                  >
                    General
                  </button>
                  <button
                    className={`filter-pill ${videoMetricMode === 'video' ? 'active' : ''}`}
                    onClick={() => setVideoMetricMode('video')}
                    style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
                  >
                    Video Specific
                  </button>
                </div>
              </div>
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
                    <th className="td-num" title="Total Spend in Euros">Spent</th><th className="td-num">Impressions</th>
                    {isVideoObjective && videoMetricMode === 'video' ? (
                      <><th className="td-num" title="Total Video Views">Video Views</th><th className="td-num" title="Video View Rate (Views / Impressions)">VR%</th><th className="td-num" title="Video Starts">VS</th><th className="td-num" title="25% of video watched">25%</th><th className="td-num" title="50% of video watched">50%</th><th className="td-num" title="75% of video watched">75%</th><th className="td-num" title="Video Completion Rate">CR%</th><th className="td-num" title="Cost Per View">CPV</th><th className="td-num" title="Number of days the campaign has been or was running">Days</th></>
                    ) : (
                      <><th className="td-num" title="Total Unique Reach">Reach</th><th className="td-num">Clicks</th><th className="td-num" title="Click-Through Rate">CTR</th><th className="td-num" title="Cost Per Mille (Cost Per Thousand Impressions)">CPM</th><th className="td-num" title="Cost Per Click">CPC</th><th className="td-num">Leads</th><th className="td-num" title="Number of days the campaign has been or was running">Days</th></>
                    )}
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
                    const days = formatDays(computeDays(m?.date_range_start, c.status === 'ACTIVE' ? undefined : m?.date_range_end));

                    if (isVideoObjective && videoMetricMode === 'video') {
                      const v = campaignVideoTotals.get(c.id) ?? { video_views: 0, video_starts: 0, video_completions: 0, video_q1: 0, video_q2: 0, video_q3: 0, spend: 0, impressions: 0 };
                      const vImpr = v.impressions || impressions;
                      const vViewRate = vImpr > 0 ? v.video_views / vImpr : 0;
                      const vCPV = v.video_views > 0 ? v.spend / v.video_views : 0;
                      const vComplRate = v.video_views > 0 ? v.video_completions / v.video_views : 0;
                      return (
                        <tr key={c.id}>
                          <td>{c.name}</td>
                          <td><span className={`objective-tag objective-${c.objective.toLowerCase().replace(' ', '-')}`}>{c.objective}</span></td>
                          <td><Badge status={c.status} /></td>
                          <td className="td-nowrap td-num">{c.ad_count}</td>
                          <td className="td-nowrap td-num">{formatEUR(v.spend || spend)}</td>
                          <td className="td-nowrap td-num">{formatNumber(vImpr)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_views)}</td>
                          <td className="td-nowrap td-num">{formatPercent(vViewRate)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_starts)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_q1)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_q2)}</td>
                          <td className="td-nowrap td-num">{formatNumber(v.video_q3)}</td>
                          <td className="td-nowrap td-num">{formatPercent(vComplRate)}</td>
                          <td className="td-nowrap td-num">{formatEUR(vCPV)}</td>
                          <td className="td-nowrap td-num">{days}</td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>
                          <span className={`objective-tag objective-${c.objective.toLowerCase().replace(' ', '-')}`}>
                            {c.objective}
                          </span>
                        </td>
                        <td><Badge status={c.status} /></td>
                        <td className="td-nowrap td-num">{c.ad_count}</td>
                        <td className="td-nowrap td-num">{formatEUR(spend)}</td>
                        <td className="td-nowrap td-num">{formatNumber(impressions)}</td>
                        <td className="td-nowrap td-num">{formatNumber(m?.reach ?? 0)}</td>
                        <td className="td-nowrap td-num">{formatNumber(clicks)}</td>
                        <td className="td-nowrap td-num">{formatPercent(m?.ctr ?? 0)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                        <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                        <td className="td-nowrap td-num">{formatNumber(m?.leads ?? 0)}</td>
                        <td className="td-nowrap td-num">{days}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartContainer>

          {/* ── Impressions & CTR charts ── */}
          {filteredCampaigns.length > 0 && (() => {
            let chartLabels: string[];
            let chartColors: string[];
            let impressionVals: number[];
            let ctrVals: number[];
            let chartTitle1: string;
            let chartTitle2: string;

            if (selectedObjective === 'All') {
              // ── All tab: group by objective type ──────────────────────────
              const OBJECTIVE_COLORS: Record<string, string> = {
                'Awareness': '#062E62',
                'Engagement': '#0050FF',
                'Video Views': '#3B82F6',
              };
              type ObjKey = 'Awareness' | 'Engagement' | 'Video Views';
              const objKeys: ObjKey[] = ['Awareness', 'Engagement', 'Video Views'];

              const grouped = objKeys.reduce<Record<ObjKey, { impressions: number; clicks: number }>>((acc, k) => {
                acc[k] = { impressions: 0, clicks: 0 };
                return acc;
              }, {} as any);

              filteredCampaigns.forEach(c => {
                const obj = c.objective as ObjKey;
                if (!grouped[obj]) return;
                grouped[obj].impressions += c.latest_metric?.impressions ?? 0;
                grouped[obj].clicks += c.latest_metric?.clicks ?? 0;
              });

              const activeKeys = objKeys.filter(k => grouped[k].impressions > 0 || grouped[k].clicks > 0);
              chartLabels = activeKeys;
              chartColors = activeKeys.map(k => OBJECTIVE_COLORS[k]);
              impressionVals = activeKeys.map(k => grouped[k].impressions);
              ctrVals = activeKeys.map(k => {
                const { clicks, impressions } = grouped[k];
                return impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(3)) : 0;
              });
              chartTitle1 = 'Impressions by Objective';
              chartTitle2 = 'CTR by Objective';
            } else {
              // ── Specific tab: one bar per campaign ────────────────────────
              const shortLabel = (name: string) => {
                const parts = name.split('_');
                const meaningful = parts.filter(p => !/^\d{4}$/.test(p) && !/^\d{2}$/.test(p) && !p.includes('/'));
                const label = meaningful.join(' ').trim() || name;
                return label.length > 28 ? label.slice(0, 26) + '…' : label;
              };

              chartLabels = filteredCampaigns.map(c => shortLabel(c.name));
              chartColors = filteredCampaigns.map(() => '#0050FF');
              impressionVals = filteredCampaigns.map(c => c.latest_metric?.impressions ?? 0);
              ctrVals = filteredCampaigns.map(c => {
                const clicks = c.latest_metric?.clicks ?? 0;
                const impressions = c.latest_metric?.impressions ?? 0;
                return impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(3)) : 0;
              });
              chartTitle1 = `Impressions — ${selectedObjective}`;
              chartTitle2 = `CTR — ${selectedObjective}`;
            }

            return (
              <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
                <ChartContainer title={chartTitle1}>
                  <BarChart
                    labels={chartLabels}
                    values={impressionVals}
                    colors={chartColors}
                    height={280}
                    textFormat={v => formatNumber(v)}
                  />
                </ChartContainer>
                <ChartContainer title={chartTitle2}>
                  <BarChart
                    labels={chartLabels}
                    values={ctrVals}
                    colors={chartColors}
                    height={280}
                    textFormat={v => `${v}%`}
                  />
                </ChartContainer>
              </div>
            );
          })()}

          {/* ── Ad Performance by Asset (Aggregated) ── */}
          {isVideoObjective ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', margin: '2rem 0 1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--color-navy)' }}>
              <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>Ad Performance by Asset</span>
              <div className="filter-group" style={{ margin: 0 }}>
                <span className="filter-label" style={{ fontSize: 11, fontWeight: 700 }}>VIEW METRICS:</span>
                <div className="filter-pills">
                  <button
                    className={`filter-pill ${videoMetricMode === 'general' ? 'active' : ''}`}
                    onClick={() => setVideoMetricMode('general')}
                    style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
                  >
                    General
                  </button>
                  <button
                    className={`filter-pill ${videoMetricMode === 'video' ? 'active' : ''}`}
                    onClick={() => setVideoMetricMode('video')}
                    style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
                  >
                    Video Specific
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <SectionHeader>Ad Performance by Asset</SectionHeader>
          )}

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
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 64 }} />
                  <col style={{ width: 108 }} />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 62 }} />
                  <col style={{ width: 68 }} />
                  <col style={{ width: 68 }} />
                </colgroup>
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
                    <th className="hide-md" onClick={() => handleSort('creative_id')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                      Asset ID{renderSortIndicator('creative_id')}
                    </th>
                    <th onClick={() => handleSort('creative_name')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                      Ad Name{renderSortIndicator('creative_name')}
                    </th>

                    <th className="hide-sm" onClick={() => handleSort('status')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                      Status{renderSortIndicator('status')}
                    </th>
                    <th className="th-num" onClick={() => handleSort('spend_eur')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Spend in Euros">
                      Spend{renderSortIndicator('spend_eur')}
                    </th>
                    <th className="th-num" onClick={() => handleSort('impressions')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Delivered Impressions">
                      Impr{renderSortIndicator('impressions')}
                    </th>

                    {isVideoObjective ? (
                      videoMetricMode === 'video' ? (
                        <>
                          <th className="th-num-xs metric-swap-cell" onClick={() => handleSort('video_views')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Video Views">
                            Views{renderSortIndicatorAd('video_views')}
                          </th>
                          <th className="th-num-xs metric-swap-cell" style={{ whiteSpace: 'nowrap' }} title="View Rate = Video Views / Impressions">VR%</th>
                          <th className="th-num-xs hide-md metric-swap-cell" onClick={() => handleSort('video_starts')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Video Starts">
                            VS{renderSortIndicatorAd('video_starts')}
                          </th>
                          <th className="th-num-xs hide-md metric-swap-cell" onClick={() => handleSort('video_first_quartile_completions')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="25% of video watched">
                            25%{renderSortIndicatorAd('video_first_quartile_completions')}
                          </th>
                          <th className="th-num-xs hide-md metric-swap-cell" onClick={() => handleSort('video_midpoint_completions')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="50% of video watched">
                            50%{renderSortIndicatorAd('video_midpoint_completions')}
                          </th>
                          <th className="th-num-xs hide-md metric-swap-cell" onClick={() => handleSort('video_third_quartile_completions')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="75% of video watched">
                            75%{renderSortIndicatorAd('video_third_quartile_completions')}
                          </th>
                          <th className="th-num-xs metric-swap-cell" onClick={() => handleSort('video_completions')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Completion Rate (100% watched)">
                            CR%{renderSortIndicatorAd('video_completions')}
                          </th>
                          <th className="th-num-xs metric-swap-cell" style={{ whiteSpace: 'nowrap' }} title="Cost Per View">CPV</th>
                        </>
                      ) : (
                        <>
                          <th className="th-num-sm hide-lg metric-swap-cell" onClick={() => handleSort('reach')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Unique Reach">
                            Reach{renderSortIndicator('reach')}
                          </th>
                          <th className="th-num-sm metric-swap-cell" onClick={() => handleSort('clicks')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Clicks">
                            Clicks{renderSortIndicator('clicks')}
                          </th>
                          <th className="th-num metric-swap-cell" onClick={() => handleSort('ctr')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Click-Through Rate">
                            CTR{renderSortIndicator('ctr')}
                          </th>
                          <th className="th-num metric-swap-cell" onClick={() => handleSort('cpm')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Cost Per Mille">
                            CPM{renderSortIndicator('cpm')}
                          </th>
                          <th className="th-num-xs metric-swap-cell" onClick={() => handleSort('cpc')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Cost Per Click">
                            CPC{renderSortIndicatorAd('cpc')}
                          </th>
                          <th className="th-num-sm hide-md metric-swap-cell" onClick={() => handleSort('engagements')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Engagements">
                            Eng.{renderSortIndicatorAd('engagements')}
                          </th>
                          <th className="th-num-sm hide-lg metric-swap-cell" onClick={() => handleSort('landing_page_clicks')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Landing Page Clicks">
                            LPC{renderSortIndicatorAd('landing_page_clicks')}
                          </th>
                        </>
                      )
                    ) : (
                      <>
                        <th className="th-num hide-lg" onClick={() => handleSort('reach')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Unique Reach">
                          Reach{renderSortIndicator('reach')}
                        </th>
                        <th className="th-num-sm" onClick={() => handleSort('clicks')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Clicks">
                          Clicks{renderSortIndicator('clicks')}
                        </th>
                        <th className="th-num" onClick={() => handleSort('ctr')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Click-Through Rate">
                          CTR{renderSortIndicator('ctr')}
                        </th>
                        <th className="th-num" onClick={() => handleSort('cpm')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Cost Per Mille">
                          CPM{renderSortIndicator('cpm')}
                        </th>
                        <th className="th-num-xs" onClick={() => handleSort('cpc')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Cost Per Click">
                          CPC{renderSortIndicatorAd('cpc')}
                        </th>
                        <th className="th-num-xs hide-md" onClick={() => handleSort('engagements')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Engagements">
                          Eng.{renderSortIndicatorAd('engagements')}
                        </th>
                        <th className="th-num-xs hide-lg" onClick={() => handleSort('landing_page_clicks')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Landing Page Clicks">
                          LPC{renderSortIndicatorAd('landing_page_clicks')}
                        </th>
                      </>
                    )}
                    <th className="th-num-xs" onClick={() => handleSort('days_running')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Days running">
                      Days{renderSortIndicatorAd('days_running')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAssets.map(row => {
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
                          <AssetThumbnail
                            thumbnailUrl={row.thumbnail_url}
                            creativeName={row.creative_name}
                            creativeUrl={row.creative_url}
                          />
                        </td>
                        <td className="td-asset-id hide-md">
                          <code className="linkedin-id" title={row.creative_id}>{numericId}</code>
                        </td>
                        <td className="td-ad-name">
                          {row.creative_url ? (
                            <a
                              href={row.creative_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="creative-link"
                              title={`Preview ad on LinkedIn: ${row.creative_name}`}
                              style={{ textDecoration: 'none', color: 'inherit', display: 'inline' }}
                            >
                              <span className="td-ad-name-inner" style={{ color: 'var(--color-blue)', fontWeight: 500 }}>{row.creative_name}</span>
                              <span style={{ fontSize: '11px', color: 'var(--color-blue)', marginLeft: '3px' }}>↗</span>
                            </a>
                          ) : (
                            <div className="td-ad-name-inner" title={row.creative_name}>{row.creative_name}</div>
                          )}
                        </td>

                        <td className="td-nowrap hide-sm">{row.status ? <Badge status={row.status === 'ACTIVE' ? 'ACTIVE' : row.status === 'COMPLETED' ? 'COMPLETED' : 'PAUSED'} /> : <span className="td-dash">—</span>}</td>
                        <td className="td-nowrap td-num">{formatEUR(row.spend_eur)}</td>
                        <td className="td-nowrap td-num">{formatNumber(row.impressions)}</td>

                        {isVideoObjective ? (
                          videoMetricMode === 'video' ? (() => {
                            const vViews = row.video_views ?? 0;
                            const vStarts = row.video_starts ?? 0;
                            const vQ1 = row.video_first_quartile_completions ?? 0;
                            const vQ2 = row.video_midpoint_completions ?? 0;
                            const vQ3 = row.video_third_quartile_completions ?? 0;
                            const vCompl = row.video_completions ?? 0;
                            const vViewRate = row.impressions > 0 ? vViews / row.impressions : 0;
                            const vComplRate = vViews > 0 ? vCompl / vViews : 0;
                            const vCPV = vViews > 0 ? row.spend_eur / vViews : 0;
                            return (<>
                              <td className="td-nowrap td-num metric-swap-cell">{formatNumber(vViews)}</td>
                              <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vViewRate)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vStarts)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ1)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ2)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ3)}</td>
                              <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vComplRate)}</td>
                              <td className="td-nowrap td-num metric-swap-cell">{formatEUR(vCPV)}</td>
                            </>);
                          })() : (<>
                            <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.reach)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatNumber(row.clicks)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatPercent(row.ctr, 3)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpm)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpc)}</td>
                            <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(row.engagements)}</td>
                            <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.landing_page_clicks)}</td>
                          </>)
                        ) : (<>
                          <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach)}</td>
                          <td className="td-nowrap td-num">{formatNumber(row.clicks)}</td>
                          <td className="td-nowrap td-num">{formatPercent(row.ctr, 3)}</td>
                          <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                          <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                          <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements)}</td>
                          <td className="td-nowrap td-num hide-lg">{formatNumber(row.landing_page_clicks)}</td>
                        </>)}
                        <td className="td-nowrap td-num">{formatDays(row.days_running)}</td>
                      </tr>
                    );
                  })}
                  {sortedAssets.length === 0 && (
                    <tr>
                      <td colSpan={isVideoObjective && videoMetricMode === 'video' ? 16 : 15} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>
                        No ad data available for the current selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ChartContainer>

          {/* ── Daily Ad Performance (Raw) ── */}
          <div className="section-header-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>Daily Ad Performance</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              {isVideoObjective && (
                <div className="filter-group" style={{ margin: 0 }}>
                  <span className="filter-label" style={{ fontSize: 11, fontWeight: 700 }}>VIEW METRICS:</span>
                  <div className="filter-pills">
                    <button
                      className={`filter-pill ${videoMetricMode === 'general' ? 'active' : ''}`}
                      onClick={() => setVideoMetricMode('general')}
                      style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
                    >
                      General
                    </button>
                    <button
                      className={`filter-pill ${videoMetricMode === 'video' ? 'active' : ''}`}
                      onClick={() => setVideoMetricMode('video')}
                      style={{ fontSize: 11, padding: '0.2rem 0.65rem' }}
                    >
                      Video Specific
                    </button>
                  </div>
                </div>
              )}

              <DatePickerCalendar
                availableDates={availableDates}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
                onClear={() => setSelectedDate('')}
              />
            </div>
          </div>

          <ChartContainer>
            <div className="table-wrapper">
              <table className="ad-asset-table">
                <colgroup>
                  <col style={{ width: 78 }} />
                  <col style={{ width: 64 }} />
                  <col style={{ width: 108 }} />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 62 }} />
                  <col style={{ width: 68 }} />
                  <col style={{ width: 68 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ width: 78 }}>Date</th>
                    <th className="th-thumb">Preview</th>
                    <th className="hide-md" style={{ width: 88 }}>Asset ID</th>
                    <th>Ad Name</th>
                    <th className="hide-sm">Status</th>
                    <th className="th-num" title="Total Spend in Euros">Spend</th>
                    <th className="th-num" title="Total Delivered Impressions">Impr.</th>
                    {isVideoObjective ? (
                      videoMetricMode === 'video' ? (
                        <>
                          <th className="th-num-xs metric-swap-cell" title="Total Video Views">Views</th>
                          <th className="th-num-xs metric-swap-cell" title="View Rate = Video Views / Impressions">VR%</th>
                          <th className="th-num-xs hide-md metric-swap-cell" title="Video Starts">VS</th>
                          <th className="th-num-xs hide-md metric-swap-cell" title="25% of video watched">25%</th>
                          <th className="th-num-xs hide-md metric-swap-cell" title="50% of video watched">50%</th>
                          <th className="th-num-xs hide-md metric-swap-cell" title="75% of video watched">75%</th>
                          <th className="th-num-xs metric-swap-cell" title="Completion Rate (100% watched)">CR%</th>
                          <th className="th-num-xs metric-swap-cell" title="Cost Per View">CPV</th>
                        </>
                      ) : (
                        <>
                          <th className="th-num hide-lg metric-swap-cell" title="Total Unique Reach">Reach</th>
                          <th className="th-num-sm metric-swap-cell" title="Total Clicks">Clicks</th>
                          <th className="th-num metric-swap-cell" title="Click-Through Rate">CTR</th>
                          <th className="th-num metric-swap-cell" title="Cost Per Mille (Cost Per Thousand Impressions)">CPM</th>
                          <th className="th-num-xs metric-swap-cell" title="Cost Per Click">CPC</th>
                          <th className="th-num-xs hide-md metric-swap-cell" title="Total Engagements">Eng.</th>
                          <th className="th-num-xs hide-lg metric-swap-cell" title="Landing Page Clicks">LPC</th>
                        </>
                      )
                    ) : (
                      <>
                        <th className="th-num hide-lg" title="Total Unique Reach">Reach</th>
                        <th className="th-num-sm" title="Total Clicks">Clicks</th>
                        <th className="th-num" title="Click-Through Rate">CTR</th>
                        <th className="th-num" title="Cost Per Mille (Cost Per Thousand Impressions)">CPM</th>
                        <th className="th-num-xs" title="Cost Per Click">CPC</th>
                        <th className="th-num-xs hide-md" title="Total Engagements">Eng.</th>
                        <th className="th-num-xs hide-lg" title="Landing Page Clicks">LPC</th>
                      </>
                    )}
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
                          <AssetThumbnail
                            thumbnailUrl={row.thumbnail_url}
                            creativeName={row.creative_name}
                            creativeUrl={row.creative_url}
                          />
                        </td>
                        <td className="td-asset-id hide-md">
                          <code className="linkedin-id" title={row.creative_id}>{numericId}</code>
                        </td>
                        <td className="td-ad-name">
                          {row.creative_url ? (
                            <a
                              href={row.creative_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="creative-link"
                              title={`Preview ad on LinkedIn: ${row.creative_name}`}
                              style={{ textDecoration: 'none', color: 'inherit', display: 'inline' }}
                            >
                              <span className="td-ad-name-inner" style={{ color: 'var(--color-blue)', fontWeight: 500 }}>{row.creative_name}</span>
                              <span style={{ fontSize: '11px', color: 'var(--color-blue)', marginLeft: '3px' }}>↗</span>
                            </a>
                          ) : (
                            <div className="td-ad-name-inner" title={row.creative_name}>{row.creative_name}</div>
                          )}
                        </td>
                        <td className="td-nowrap hide-sm">{row.status ? <Badge status={row.status === 'ACTIVE' ? 'ACTIVE' : row.status === 'COMPLETED' ? 'COMPLETED' : 'PAUSED'} /> : <span className="td-dash">—</span>}</td>
                        <td className="td-nowrap td-num">{formatEUR(spend)}</td>
                        <td className="td-nowrap td-num">{formatNumber(impressions)}</td>
                        {isVideoObjective ? (
                          videoMetricMode === 'video' ? (() => {
                            const vViews = row.video_views ?? 0;
                            const vStarts = row.video_starts ?? 0;
                            const vQ1 = row.video_first_quartile_completions ?? 0;
                            const vQ2 = row.video_midpoint_completions ?? 0;
                            const vQ3 = row.video_third_quartile_completions ?? 0;
                            const vCompl = row.video_completions ?? 0;
                            const vViewRate = impressions > 0 ? vViews / impressions : 0;
                            const vComplRate = vViews > 0 ? vCompl / vViews : 0;
                            const vCPV = vViews > 0 ? spend / vViews : 0;
                            return (<>
                              <td className="td-nowrap td-num metric-swap-cell">{formatNumber(vViews)}</td>
                              <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vViewRate)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vStarts)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ1)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ2)}</td>
                              <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ3)}</td>
                              <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vComplRate)}</td>
                              <td className="td-nowrap td-num metric-swap-cell">{formatEUR(vCPV)}</td>
                            </>);
                          })() : (<>
                            <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.reach ?? 0)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatNumber(clicks)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatPercent(row.ctr ?? 0, 3)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpm)}</td>
                            <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpc)}</td>
                            <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(row.engagements ?? 0)}</td>
                            <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.landing_page_clicks ?? 0)}</td>
                          </>)
                        ) : (<>
                          <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach ?? 0)}</td>
                          <td className="td-nowrap td-num">{formatNumber(clicks)}</td>
                          <td className="td-nowrap td-num">{formatPercent(row.ctr ?? 0, 3)}</td>
                          <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                          <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                          <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements ?? 0)}</td>
                          <td className="td-nowrap td-num hide-lg">{formatNumber(row.landing_page_clicks ?? 0)}</td>
                        </>)}
                      </tr>
                    );
                  })}
                  {dailyAdRows.length === 0 && (
                    <tr>
                      <td colSpan={isVideoObjective && videoMetricMode === 'video' ? 15 : 14} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>
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
