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
import { isWebsiteVisitsCampaign } from './TOFUPage';
import type { CampaignWithMetrics, AdPerformanceMetric } from '../types';

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
  avg_watch_depth: number;
  video_duration_seconds: number | null;
}

function aggregateAdsByCreative(rows: AdPerformanceMetric[], campaignNameMap: Record<string, string>): AggregatedAd[] {
  const map = new Map<string, AggregatedAd>();
  const minDate = new Map<string, string>();
  const maxDate = new Map<string, string>();

  for (const row of rows) {
    const key = `${row.campaign_id}__${row.creative_id}`;
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
      if (existing.video_duration_seconds === null && row.video_duration_seconds != null) {
        existing.video_duration_seconds = row.video_duration_seconds;
      }
      if (!existing.thumbnail_url && row.thumbnail_url) existing.thumbnail_url = row.thumbnail_url;
      if (!existing.creative_url && row.creative_url) existing.creative_url = row.creative_url;
      existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
    } else {
      const vStarts = row.video_starts ?? 0;
      const vQ1 = row.video_first_quartile_completions ?? 0;
      const vQ2 = row.video_midpoint_completions ?? 0;
      const vQ3 = row.video_third_quartile_completions ?? 0;
      const vCompl = row.video_completions ?? 0;
      const vViews = row.video_views ?? 0;
      const initDepth = vViews > 0
        ? ((vViews - vQ1) * 0.125 + (vQ1 - vQ2) * 0.375 + (vQ2 - vQ3) * 0.625 + (vQ3 - vCompl) * 0.875 + vCompl * 1.0) / vViews
        : 0;
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
        days_running: null,
        video_views: vViews,
        video_completions: vCompl,
        video_starts: vStarts,
        video_first_quartile_completions: vQ1,
        video_midpoint_completions: vQ2,
        video_third_quartile_completions: vQ3,
        avg_watch_depth: initDepth,
        video_duration_seconds: row.video_duration_seconds ?? null,
      });
    }
  }

  for (const [key, ad] of map.entries()) {
    const start = minDate.get(key);
    const end = maxDate.get(key);
    if (start) {
      const useEnd = ad.status === 'ACTIVE' ? undefined : end;
      ad.days_running = computeDays(start, useEnd);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.impressions - a.impressions);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function MOFUPage() {
  const { data: mofuData, isLoading: mofuLoading, isError: mofuError, refetch } = useCampaignMetrics('MOFU');
  const { data: tofuData, isLoading: tofuLoading } = useCampaignMetrics('TOFU');
  const { data: mofuAdPerf = [], isLoading: mofuAdLoading } = useAdPerformance('MOFU');
  const { data: tofuAdPerf = [], isLoading: tofuAdLoading } = useAdPerformance('TOFU');
  const { data: logs } = useIngestionLog();

  const isLoading = mofuLoading || tofuLoading || mofuAdLoading || tofuAdLoading;
  const isError = mofuError;

  // Merge WV campaigns from TOFU stage into MOFU display
  const wvFromTofu = (tofuData ?? []).filter(c => isWebsiteVisitsCampaign(c.name));
  // MOFU only shows Website Visits — filter any non-WV campaigns that may be in MOFU stage
  const wvFromMofu = (mofuData ?? []).filter(c => isWebsiteVisitsCampaign(c.name));
  const data = isLoading ? undefined : [...wvFromMofu, ...wvFromTofu];

  // Ad rows: only WV campaigns
  const wvCampaignIds = new Set([...wvFromMofu, ...wvFromTofu].map(c => c.id));
  const wvAdPerf = tofuAdPerf.filter(r => wvCampaignIds.has(r.campaign_id));
  const adPerformance = [...mofuAdPerf.filter(r => wvCampaignIds.has(r.campaign_id)), ...wvAdPerf];

  const [selectedAdKeys, setSelectedAdKeys] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string>('');

  function toggleAdSelection(key: string) {
    setSelectedAdKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function clearAdSelection() { setSelectedAdKeys(new Set()); }

  const [sortField, setSortField] = useState<keyof AggregatedAd | 'cpm' | 'cpc'>('impressions');
  const [sortAscending, setSortAscending] = useState<boolean>(false);

  function handleSort(field: keyof AggregatedAd | 'cpm' | 'cpc') {
    if (sortField === field) { setSortAscending(prev => !prev); }
    else { setSortField(field); setSortAscending(['creative_name', 'campaign_name', 'status', 'creative_id'].includes(field as string)); }
  }
  function renderSortIndicator(field: keyof AggregatedAd | 'cpm' | 'cpc') {
    if (sortField !== field) return null;
    return sortAscending ? ' ▲' : ' ▼';
  }

  // All campaigns are Website Visits — no objective filtering needed
  const campaigns = data ?? [];

  const campaignNameMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    campaigns.forEach(c => { m[c.id] = c.name; });
    return m;
  }, [campaigns]);

  const campaignStatusMap = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    campaigns.forEach(c => { m[c.id] = c.status; });
    return m;
  }, [campaigns]);

  const adRows = useMemo(() => {
    return adPerformance.map(r => {
      const campStatus = campaignStatusMap[r.campaign_id];
      if (r.status === 'ACTIVE' && campStatus && campStatus !== 'ACTIVE') return { ...r, status: campStatus };
      return r;
    });
  }, [adPerformance, campaignStatusMap]);

  const aggregatedAssets = useMemo(() => aggregateAdsByCreative(adRows, campaignNameMap), [adRows, campaignNameMap]);

  const sortedAssets = useMemo(() => {
    return [...aggregatedAssets].sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === 'cpm') { aVal = a.impressions ? (a.spend_eur / a.impressions) * 1000 : 0; bVal = b.impressions ? (b.spend_eur / b.impressions) * 1000 : 0; }
      else if (sortField === 'cpc') { aVal = a.clicks ? a.spend_eur / a.clicks : 0; bVal = b.clicks ? b.spend_eur / b.clicks : 0; }
      else { aVal = a[sortField]; bVal = b[sortField]; }
      if (aVal === null || aVal === undefined) return sortAscending ? -1 : 1;
      if (bVal === null || bVal === undefined) return sortAscending ? 1 : -1;
      if (typeof aVal === 'string') return sortAscending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortAscending ? aVal - bVal : bVal - aVal;
    });
  }, [aggregatedAssets, sortField, sortAscending]);

  const availableDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of adRows) { if (r.date) s.add(r.date.slice(0, 10)); }
    return s;
  }, [adRows]);

  const dailyAdRows = useMemo(() => {
    let rows = adRows;
    if (selectedAdKeys.size > 0) rows = rows.filter(r => selectedAdKeys.has(`${r.campaign_id}__${r.creative_id}`));
    if (selectedDate) rows = rows.filter(r => r.date?.slice(0, 10) === selectedDate);
    return rows;
  }, [adRows, selectedAdKeys, selectedDate]);

  // ── Key metrics ──────────────────────────────────────────────────────────
  const completed = campaigns.filter(c => c.status === 'COMPLETED');
  const active = campaigns.filter(c => c.status === 'ACTIVE');
  const completedAds = completed.reduce((a, c) => a + c.ad_count, 0);
  const activeAds = active.reduce((a, c) => a + c.ad_count, 0);

  const totalAds = campaigns.reduce((a, c) => a + c.ad_count, 0);
  const totalSpend = sum(campaigns, 'spend_eur');
  const totalReach = sum(campaigns, 'reach');
  const totalImpressions = sum(campaigns, 'impressions');
  const totalClicks = sum(campaigns, 'clicks');
  const totalLeads = sum(campaigns, 'leads');
  const avgCPM = totalImpressions ? (totalSpend / totalImpressions) * 1000 : 0;
  const avgCPC = totalClicks ? totalSpend / totalClicks : 0;
  const avgCTR = wavg(campaigns, 'ctr', 'impressions');
  const avgEngRate = wavg(campaigns, 'engagement_rate', 'impressions');

  // Website Visits specific KPIs
  const totalLPC = aggregatedAssets.reduce((acc, r) => acc + (r.landing_page_clicks ?? 0), 0);
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
          <p>MOFU • Website Visits</p>
        </div>
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA' }}>
          <p style={{ fontSize: '15px', marginBottom: '0.5rem', fontWeight: 600, color: '#062E62' }}>
            {hasSynced ? 'No Website Visits campaigns found' : 'No data synced yet'}
          </p>
          {hasSynced && (
            <p style={{ marginBottom: '0.5rem' }}>
              A sync has been performed, but no campaigns matching the Website Visits criteria were found.
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
        <p>MOFU • Website Visits</p>
      </div>

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
      <div className="grid-4" style={{ marginBottom: '1rem' }}>
        <MetricCard label="Engagement Rate" value={formatPercent(avgEngRate)} />
        <MetricCard label="Ads" value={formatNumber(totalAds)} />
        <MetricCard label="Clicks" value={formatNumber(totalClicks)} />
        <MetricCard label="CPC" value={formatEUR(avgCPC)} />
      </div>
      {/* Website Visits specific KPIs */}
      <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
        <MetricCard label="Landing Page Clicks" value={formatNumber(totalLPC)} />
        <MetricCard label="Cost / LPC" value={formatEUR(avgCostPerLPC)} />
        <MetricCard label="Leads" value={formatNumber(totalLeads)} />
      </div>

      {/* Campaign Details */}
      <SectionHeader>Campaign Details</SectionHeader>
      <ChartContainer>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Campaign Name</th><th>Status</th><th className="td-num">Ads</th>
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
              {campaigns.map(c => {
                const m = c.latest_metric;
                const spend = m?.spend_eur ?? 0;
                const impressions = m?.impressions ?? 0;
                const clicks = m?.clicks ?? 0;
                const cpm = impressions ? (spend / impressions) * 1000 : 0;
                const cpc = clicks ? spend / clicks : 0;
                const days = formatDays(computeDays(m?.date_range_start, c.status === 'ACTIVE' ? undefined : m?.date_range_end));
                // LPC from ad-level aggregation for this campaign
                const campLPC = aggregatedAssets.filter(a => a.campaign_id === c.id).reduce((acc, a) => acc + (a.landing_page_clicks ?? 0), 0);
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
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

      {/* Impressions & CTR per campaign */}
      {campaigns.length > 1 && (() => {
        const shortLabel = (name: string) => {
          const parts = name.split('_');
          const meaningful = parts.filter(p => !/^\d{4}$/.test(p) && !/^\d{2}$/.test(p) && !p.includes('/'));
          const label = meaningful.join(' ').trim() || name;
          return label.length > 28 ? label.slice(0, 26) + '…' : label;
        };
        const labels = campaigns.map(c => shortLabel(c.name));
        const colors = campaigns.map(() => '#0050FF');
        const impressionVals = campaigns.map(c => c.latest_metric?.impressions ?? 0);
        const ctrVals = campaigns.map(c => {
          const clicks = c.latest_metric?.clicks ?? 0;
          const impr = c.latest_metric?.impressions ?? 0;
          return impr > 0 ? parseFloat(((clicks / impr) * 100).toFixed(3)) : 0;
        });
        return (
          <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
            <ChartContainer title="Impressions by Campaign">
              <BarChart labels={labels} values={impressionVals} colors={colors} height={280} textFormat={v => formatNumber(v)} />
            </ChartContainer>
            <ChartContainer title="CTR by Campaign">
              <BarChart labels={labels} values={ctrVals} colors={colors} height={280} textFormat={v => `${v}%`} />
            </ChartContainer>
          </div>
        );
      })()}

      {/* Ad Performance by Asset */}
      <SectionHeader>Ad Performance by Asset</SectionHeader>
      <div style={{ marginBottom: '0.5rem' }}>
        <p style={{ fontSize: 12, color: '#5A6577' }}>Aggregated lifetime metrics per ad creative, mapped to the LinkedIn Asset ID.</p>
      </div>
      <ChartContainer>
        <div className="table-wrapper">
          <table className="ad-asset-table">
            <colgroup>
              <col style={{ width: 36 }} /><col style={{ width: 64 }} /><col style={{ width: 108 }} />
              <col style={{ width: 160 }} /><col style={{ width: 62 }} /><col style={{ width: 68 }} /><col style={{ width: 68 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>
                  <input type="checkbox" title="Select / deselect all"
                    checked={selectedAdKeys.size === aggregatedAssets.length && aggregatedAssets.length > 0}
                    onChange={() => {
                      if (selectedAdKeys.size === aggregatedAssets.length) clearAdSelection();
                      else setSelectedAdKeys(new Set(aggregatedAssets.map(r => `${r.campaign_id}__${r.creative_id}`)));
                    }}
                  />
                </th>
                <th className="th-thumb">Preview</th>
                <th className="hide-md" onClick={() => handleSort('creative_id')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Asset ID{renderSortIndicator('creative_id')}</th>
                <th onClick={() => handleSort('creative_name')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Ad Name{renderSortIndicator('creative_name')}</th>
                <th className="hide-sm" onClick={() => handleSort('status')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Status{renderSortIndicator('status')}</th>
                <th className="th-num" onClick={() => handleSort('spend_eur')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Total Spend">Spend{renderSortIndicator('spend_eur')}</th>
                <th className="th-num" onClick={() => handleSort('impressions')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Impressions">Impr{renderSortIndicator('impressions')}</th>
                <th className="th-num hide-lg" onClick={() => handleSort('reach')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Reach">Reach{renderSortIndicator('reach')}</th>
                <th className="th-num-sm" onClick={() => handleSort('clicks')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Clicks{renderSortIndicator('clicks')}</th>
                <th className="th-num" onClick={() => handleSort('ctr')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>CTR{renderSortIndicator('ctr')}</th>
                <th className="th-num" onClick={() => handleSort('cpm')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>CPM{renderSortIndicator('cpm')}</th>
                <th className="th-num-xs" onClick={() => handleSort('cpc')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>CPC{renderSortIndicator('cpc')}</th>
                <th className="th-num-sm hide-md" onClick={() => handleSort('landing_page_clicks')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Landing Page Clicks">LPC{renderSortIndicator('landing_page_clicks')}</th>
                <th className="th-num-xs hide-md" onClick={() => handleSort('engagements')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Eng.{renderSortIndicator('engagements')}</th>
                <th className="th-num-xs" onClick={() => handleSort('days_running')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Days{renderSortIndicator('days_running')}</th>
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
                  <tr key={key} style={isChecked ? { background: '#F0F5FF' } : undefined}>
                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggleAdSelection(key)} title={`Select "${row.creative_name}" to filter daily view`} />
                    </td>
                    <td className="td-thumb"><AssetThumbnail thumbnailUrl={row.thumbnail_url} creativeName={row.creative_name} creativeUrl={row.creative_url} /></td>
                    <td className="td-asset-id hide-md"><code className="linkedin-id" title={row.creative_id}>{numericId}</code></td>
                    <td className="td-ad-name">
                      {row.creative_url ? (
                        <a href={row.creative_url} target="_blank" rel="noopener noreferrer" className="creative-link" title={`Preview ad on LinkedIn: ${row.creative_name}`} style={{ textDecoration: 'none', color: 'inherit', display: 'inline' }}>
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
                    <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach)}</td>
                    <td className="td-nowrap td-num">{formatNumber(row.clicks)}</td>
                    <td className="td-nowrap td-num">{formatPercent(row.ctr, 3)}</td>
                    <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                    <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                    <td className="td-nowrap td-num hide-md">{formatNumber(row.landing_page_clicks)}</td>
                    <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements)}</td>
                    <td className="td-nowrap td-num">{formatDays(row.days_running)}</td>
                  </tr>
                );
              })}
              {sortedAssets.length === 0 && (
                <tr><td colSpan={14} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>No ad data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartContainer>

      {/* Daily Ad Performance */}
      <div className="section-header-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>Daily Ad Performance</span>
        <DatePickerCalendar availableDates={availableDates} selectedDate={selectedDate} onSelect={setSelectedDate} onClear={() => setSelectedDate('')} />
      </div>

      <ChartContainer>
        <div className="table-wrapper">
          <table className="ad-asset-table">
            <colgroup>
              <col style={{ width: 78 }} /><col style={{ width: 64 }} /><col style={{ width: 108 }} />
              <col style={{ width: 160 }} /><col style={{ width: 62 }} /><col style={{ width: 68 }} /><col style={{ width: 68 }} /><col style={{ width: 68 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: 78 }}>Date</th>
                <th className="th-thumb">Preview</th>
                <th className="hide-md" style={{ width: 88 }}>Asset ID</th>
                <th>Ad Name</th>
                <th className="hide-sm">Status</th>
                <th className="th-num" title="Spend">Spend</th>
                <th className="th-num" title="Impressions">Impr.</th>
                <th className="th-num hide-lg" title="Reach">Reach</th>
                <th className="th-num-sm" title="Clicks">Clicks</th>
                <th className="th-num" title="CTR">CTR</th>
                <th className="th-num" title="CPM">CPM</th>
                <th className="th-num-xs" title="CPC">CPC</th>
                <th className="th-num-xs hide-lg" title="Landing Page Clicks">LPC</th>
                <th className="th-num-xs hide-md" title="Engagements">Eng.</th>
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
                    <td className="td-thumb"><AssetThumbnail thumbnailUrl={row.thumbnail_url} creativeName={row.creative_name} creativeUrl={row.creative_url} /></td>
                    <td className="td-asset-id hide-md"><code className="linkedin-id" title={row.creative_id}>{numericId}</code></td>
                    <td className="td-ad-name">
                      {row.creative_url ? (
                        <a href={row.creative_url} target="_blank" rel="noopener noreferrer" className="creative-link" title={`Preview ad on LinkedIn: ${row.creative_name}`} style={{ textDecoration: 'none', color: 'inherit', display: 'inline' }}>
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
                    <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach ?? 0)}</td>
                    <td className="td-nowrap td-num">{formatNumber(clicks)}</td>
                    <td className="td-nowrap td-num">{formatPercent(row.ctr ?? 0, 3)}</td>
                    <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                    <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                    <td className="td-nowrap td-num hide-lg">{formatNumber(row.landing_page_clicks ?? 0)}</td>
                    <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements ?? 0)}</td>
                  </tr>
                );
              })}
              {dailyAdRows.length === 0 && (
                <tr><td colSpan={13} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>No daily ad performance rows for the current selection.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartContainer>

      <Footer />
    </div>
  );
}
