import AssetThumbnail from './AssetThumbnail';
import Badge from './Badge';
import { formatEUR, formatNumber, formatPercent, formatDays } from '../../lib/formatters';
import { computeWatchDepth, type AggregatedAd } from '../../lib/campaignUtils';
import VideoMetricToggle from './VideoMetricToggle';
import SectionHeader from './SectionHeader';
import ChartContainer from './ChartContainer';
import DatePickerCalendar from './DatePickerCalendar';
import type { AdPerformanceMetric } from '../../types';

// ── Shared column header cell ─────────────────────────────────────────────────
function SortTh({
  className = '',
  title,
  onClick,
  children,
}: {
  className?: string;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <th
      className={className}
      title={title}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}
    >
      {children}
    </th>
  );
}

// ── Ad name cell (link or plain) ──────────────────────────────────────────────
function AdNameCell({ creativeUrl, creativeName }: { creativeUrl: string | null; creativeName: string }) {
  if (creativeUrl) {
    return (
      <a
        href={creativeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="creative-link"
        title={`Preview ad on LinkedIn: ${creativeName}`}
        style={{ textDecoration: 'none', color: 'inherit', display: 'inline' }}
      >
        <span className="td-ad-name-inner" style={{ color: 'var(--color-blue)', fontWeight: 500 }}>{creativeName}</span>
        <span style={{ fontSize: '11px', color: 'var(--color-blue)', marginLeft: '3px' }}>↗</span>
      </a>
    );
  }
  return <div className="td-ad-name-inner" title={creativeName}>{creativeName}</div>;
}

// ── Status badge cell ─────────────────────────────────────────────────────────
function StatusCell({ status }: { status: string | null }) {
  if (!status) return <span className="td-dash">—</span>;
  const norm = status === 'ACTIVE' ? 'ACTIVE' : status === 'COMPLETED' ? 'COMPLETED' : 'PAUSED';
  return <Badge status={norm} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad Asset Table (aggregated lifetime metrics per creative)
// ─────────────────────────────────────────────────────────────────────────────

interface AdAssetTableProps {
  sortedAssets: AggregatedAd[];
  aggregatedAssets: AggregatedAd[];
  selectedAdKeys: Set<string>;
  setSelectedAdKeys: (s: Set<string>) => void;
  clearAdSelection: () => void;
  toggleAdSelection: (key: string) => void;
  handleSort: (field: keyof AggregatedAd | 'cpm' | 'cpc') => void;
  renderSortIndicator: (field: keyof AggregatedAd | 'cpm' | 'cpc') => string | null;
  isVideoObjective: boolean;
  videoMetricMode: 'video' | 'general';
  setVideoMetricMode: (mode: 'video' | 'general') => void;
  /** Optional subtitle line shown under the section header */
  subtitle?: React.ReactNode;
}

export function AdAssetTable({
  sortedAssets,
  aggregatedAssets,
  selectedAdKeys,
  setSelectedAdKeys,
  clearAdSelection,
  toggleAdSelection,
  handleSort,
  renderSortIndicator,
  isVideoObjective,
  videoMetricMode,
  setVideoMetricMode,
  subtitle,
}: AdAssetTableProps) {
  const isVideoMode = isVideoObjective && videoMetricMode === 'video';

  return (
    <>
      {/* Section header with optional video toggle */}
      {isVideoObjective ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', margin: '2rem 0 1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--color-navy)' }}>
          <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>Ad Performance by Asset</span>
          <VideoMetricToggle mode={videoMetricMode} onChange={setVideoMetricMode} />
        </div>
      ) : (
        <SectionHeader>Ad Performance by Asset</SectionHeader>
      )}

      {subtitle && (
        <div style={{ marginBottom: '0.5rem' }}>
          <p style={{ fontSize: 12, color: '#5A6577' }}>{subtitle}</p>
        </div>
      )}

      <ChartContainer>
        <div className="table-wrapper">
          <table className="ad-asset-table">
            <colgroup>
              <col style={{ width: 36 }} /><col style={{ width: 64 }} /><col style={{ width: 108 }} />
              <col style={{ width: 160 }} /><col style={{ width: 62 }} /><col style={{ width: 68 }} /><col style={{ width: 68 }} />
            </colgroup>
            <thead>
              <tr>
                {/* Select-all checkbox */}
                <th style={{ width: 36, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    title="Select / deselect all"
                    checked={selectedAdKeys.size === aggregatedAssets.length && aggregatedAssets.length > 0}
                    onChange={() => {
                      if (selectedAdKeys.size === aggregatedAssets.length) clearAdSelection();
                      else setSelectedAdKeys(new Set(aggregatedAssets.map(r => `${r.campaign_id}__${r.creative_id}`)));
                    }}
                  />
                </th>
                <th className="th-thumb">Preview</th>
                <SortTh className="hide-md" onClick={() => handleSort('creative_id')}>Asset ID{renderSortIndicator('creative_id')}</SortTh>
                <SortTh onClick={() => handleSort('creative_name')}>Ad Name{renderSortIndicator('creative_name')}</SortTh>
                <SortTh className="hide-sm" onClick={() => handleSort('status')}>Status{renderSortIndicator('status')}</SortTh>

                {/* Spend + Impr — hidden in video mode */}
                {!isVideoMode && <>
                  <SortTh className="th-num" title="Total Spend in Euros" onClick={() => handleSort('spend_eur')}>Spend{renderSortIndicator('spend_eur')}</SortTh>
                  <SortTh className="th-num" title="Total Impressions" onClick={() => handleSort('impressions')}>Impr{renderSortIndicator('impressions')}</SortTh>
                </>}

                {/* Metric columns depend on video mode */}
                {isVideoObjective ? (
                  videoMetricMode === 'video' ? (
                    <>
                      <SortTh className="th-num-xs metric-swap-cell" title="Total Video Views" onClick={() => handleSort('video_views')}>Views{renderSortIndicator('video_views')}</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" title="View Rate">VR%</SortTh>
                      <SortTh className="th-num-xs hide-md metric-swap-cell" title="Video Starts" onClick={() => handleSort('video_starts')}>VS{renderSortIndicator('video_starts')}</SortTh>
                      <SortTh className="th-num-xs hide-md metric-swap-cell" title="25% watched" onClick={() => handleSort('video_first_quartile_completions')}>25%{renderSortIndicator('video_first_quartile_completions')}</SortTh>
                      <SortTh className="th-num-xs hide-md metric-swap-cell" title="50% watched" onClick={() => handleSort('video_midpoint_completions')}>50%{renderSortIndicator('video_midpoint_completions')}</SortTh>
                      <SortTh className="th-num-xs hide-md metric-swap-cell" title="75% watched" onClick={() => handleSort('video_third_quartile_completions')}>75%{renderSortIndicator('video_third_quartile_completions')}</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" title="Completions" onClick={() => handleSort('video_completions')}>100%{renderSortIndicator('video_completions')}</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" title="Completion Rate">CR%</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" title="Cost Per View">CPV</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" title="Avg Watch Depth" onClick={() => handleSort('avg_watch_depth')}>AWD%{renderSortIndicator('avg_watch_depth')}</SortTh>
                    </>
                  ) : (
                    <>
                      <SortTh className="th-num-sm hide-lg metric-swap-cell" onClick={() => handleSort('reach')}>Reach{renderSortIndicator('reach')}</SortTh>
                      <SortTh className="th-num-sm metric-swap-cell" onClick={() => handleSort('clicks')}>Clicks{renderSortIndicator('clicks')}</SortTh>
                      <SortTh className="th-num metric-swap-cell" onClick={() => handleSort('ctr')}>CTR{renderSortIndicator('ctr')}</SortTh>
                      <SortTh className="th-num metric-swap-cell" onClick={() => handleSort('cpm')}>CPM{renderSortIndicator('cpm')}</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" onClick={() => handleSort('cpc')}>CPC{renderSortIndicator('cpc')}</SortTh>
                      <SortTh className="th-num-sm hide-md metric-swap-cell" onClick={() => handleSort('engagements')}>Eng.{renderSortIndicator('engagements')}</SortTh>
                      <SortTh className="th-num-sm hide-lg metric-swap-cell" onClick={() => handleSort('landing_page_clicks')}>LPC{renderSortIndicator('landing_page_clicks')}</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" title="Website Conversions (landing page registrations & actions)" onClick={() => handleSort('conversions')}>Conv.{renderSortIndicator('conversions')}</SortTh>
                      <SortTh className="th-num-xs metric-swap-cell" title="Leads (LinkedIn Lead Gen Form fills)" onClick={() => handleSort('leads')}>Leads{renderSortIndicator('leads')}</SortTh>
                    </>
                  )
                ) : (
                  <>
                    <SortTh className="th-num hide-lg" onClick={() => handleSort('reach')}>Reach{renderSortIndicator('reach')}</SortTh>
                    <SortTh className="th-num-sm" onClick={() => handleSort('clicks')}>Clicks{renderSortIndicator('clicks')}</SortTh>
                    <SortTh className="th-num" onClick={() => handleSort('ctr')}>CTR{renderSortIndicator('ctr')}</SortTh>
                    <SortTh className="th-num" onClick={() => handleSort('cpm')}>CPM{renderSortIndicator('cpm')}</SortTh>
                    <SortTh className="th-num-xs" onClick={() => handleSort('cpc')}>CPC{renderSortIndicator('cpc')}</SortTh>
                    <SortTh className="th-num-xs hide-md" onClick={() => handleSort('engagements')}>Eng.{renderSortIndicator('engagements')}</SortTh>
                    <SortTh className="th-num-xs hide-lg" onClick={() => handleSort('landing_page_clicks')}>LPC{renderSortIndicator('landing_page_clicks')}</SortTh>
                    <SortTh className="th-num-xs" title="Website Conversions (landing page registrations & actions)" onClick={() => handleSort('conversions')}>Conv.{renderSortIndicator('conversions')}</SortTh>
                    <SortTh className="th-num-xs" title="Leads (LinkedIn Lead Gen Form fills)" onClick={() => handleSort('leads')}>Leads{renderSortIndicator('leads')}</SortTh>
                  </>
                )}
                {!isVideoMode && (
                  <SortTh className="th-num-xs" title="Days running" onClick={() => handleSort('days_running')}>Days{renderSortIndicator('days_running')}</SortTh>
                )}
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
                    <td className="td-ad-name"><AdNameCell creativeUrl={row.creative_url} creativeName={row.creative_name} /></td>
                    <td className="td-nowrap hide-sm"><StatusCell status={row.status} /></td>

                    {!isVideoMode && <>
                      <td className="td-nowrap td-num">{formatEUR(row.spend_eur)}</td>
                      <td className="td-nowrap td-num">{formatNumber(row.impressions)}</td>
                    </>}

                    {isVideoObjective ? (
                      videoMetricMode === 'video' ? (() => {
                        const vViews  = row.video_views ?? 0;
                        const vStarts = row.video_starts ?? 0;
                        const vQ1     = row.video_first_quartile_completions ?? 0;
                        const vQ2     = row.video_midpoint_completions ?? 0;
                        const vQ3     = row.video_third_quartile_completions ?? 0;
                        const vCompl  = row.video_completions ?? 0;
                        const vViewRate = row.impressions > 0 ? vViews / row.impressions : 0;
                        const vCPV     = vViews > 0 ? row.spend_eur / vViews : 0;
                        const vDepth   = row.avg_watch_depth ?? 0;
                        return (<>
                          <td className="td-nowrap td-num metric-swap-cell">{formatNumber(vViews)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vViewRate)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vStarts)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ1)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ2)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ3)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatNumber(vCompl)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vViews > 0 ? vCompl / vViews : 0)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatEUR(vCPV)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vDepth)}</td>
                        </>);
                      })() : (<>
                        <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.reach)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatNumber(row.clicks)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatPercent(row.ctr, 3)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpm)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpc)}</td>
                        <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(row.engagements)}</td>
                        <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.landing_page_clicks)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatNumber(row.conversions ?? 0)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatNumber(row.leads ?? 0)}</td>
                      </>)
                    ) : (<>
                      <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach)}</td>
                      <td className="td-nowrap td-num">{formatNumber(row.clicks)}</td>
                      <td className="td-nowrap td-num">{formatPercent(row.ctr, 3)}</td>
                      <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                      <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                      <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements)}</td>
                      <td className="td-nowrap td-num hide-lg">{formatNumber(row.landing_page_clicks)}</td>
                      <td className="td-nowrap td-num">{formatNumber(row.conversions ?? 0)}</td>
                      <td className="td-nowrap td-num">{formatNumber(row.leads ?? 0)}</td>
                    </>)}
                    {!isVideoMode && <td className="td-nowrap td-num">{formatDays(row.days_running)}</td>}
                  </tr>
                );
              })}
              {sortedAssets.length === 0 && (
                <tr><td colSpan={isVideoMode ? 15 : 17} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>No ad data available for the current selection.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartContainer>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Ad Performance Table
// ─────────────────────────────────────────────────────────────────────────────

interface DailyAdTableProps {
  dailyAdRows: AdPerformanceMetric[];
  availableDates: Set<string>;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  isVideoObjective: boolean;
  videoMetricMode: 'video' | 'general';
  setVideoMetricMode: (mode: 'video' | 'general') => void;
}

export function DailyAdTable({
  dailyAdRows,
  availableDates,
  selectedDate,
  setSelectedDate,
  isVideoObjective,
  videoMetricMode,
  setVideoMetricMode,
}: DailyAdTableProps) {
  const isVideoMode = isVideoObjective && videoMetricMode === 'video';

  return (
    <>
      <div className="section-header-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>Daily Ad Performance</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          {isVideoObjective && (
            <VideoMetricToggle mode={videoMetricMode} onChange={setVideoMetricMode} />
          )}
          <DatePickerCalendar availableDates={availableDates} selectedDate={selectedDate} onSelect={setSelectedDate} onClear={() => setSelectedDate('')} />
        </div>
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
                {!isVideoMode && <>
                  <th className="th-num" title="Total Spend in Euros">Spend</th>
                  <th className="th-num" title="Total Delivered Impressions">Impr.</th>
                </>}
                {isVideoObjective ? (
                  videoMetricMode === 'video' ? (
                    <>
                      <th className="th-num-xs metric-swap-cell" title="Total Video Views">Views</th>
                      <th className="th-num-xs metric-swap-cell" title="View Rate = Video Views / Impressions">VR%</th>
                      <th className="th-num-xs hide-md metric-swap-cell" title="Video Starts">VS</th>
                      <th className="th-num-xs hide-md metric-swap-cell" title="25% of video watched">25%</th>
                      <th className="th-num-xs hide-md metric-swap-cell" title="50% of video watched">50%</th>
                      <th className="th-num-xs hide-md metric-swap-cell" title="75% of video watched">75%</th>
                      <th className="th-num-xs metric-swap-cell" title="Video Completions — count of viewers who watched 100%">100%</th>
                      <th className="th-num-xs metric-swap-cell" title="Completion Rate (completions / video views)">CR%</th>
                      <th className="th-num-xs metric-swap-cell" title="Cost Per View">CPV</th>
                      <th className="th-num-xs metric-swap-cell" title="Average Watch Depth — estimated average % of video watched per viewer">AWD%</th>
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
                      <th className="th-num-xs metric-swap-cell" title="Website Conversions (landing page registrations & actions)">Conv.</th>
                      <th className="th-num-xs metric-swap-cell" title="Leads (LinkedIn Lead Gen Form fills)">Leads</th>
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
                    <th className="th-num-xs" title="Website Conversions (landing page registrations & actions)">Conv.</th>
                    <th className="th-num-xs" title="Leads (LinkedIn Lead Gen Form fills)">Leads</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {dailyAdRows.map((row) => {
                const numericId  = row.creative_id.replace(/^urn:li:\w+:/, '');
                const spend      = row.spend_eur   ?? 0;
                const impressions = row.impressions ?? 0;
                const clicks     = row.clicks       ?? 0;
                const cpm        = impressions ? (spend / impressions) * 1000 : 0;
                const cpc        = clicks     ? spend / clicks : 0;
                return (
                  <tr key={`${row.campaign_id}-${row.creative_id}-${row.date}`}>
                    <td className="td-nowrap">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                    <td className="td-thumb"><AssetThumbnail thumbnailUrl={row.thumbnail_url} creativeName={row.creative_name} creativeUrl={row.creative_url} /></td>
                    <td className="td-asset-id hide-md"><code className="linkedin-id" title={row.creative_id}>{numericId}</code></td>
                    <td className="td-ad-name"><AdNameCell creativeUrl={row.creative_url} creativeName={row.creative_name} /></td>
                    <td className="td-nowrap hide-sm"><StatusCell status={row.status} /></td>

                    {!isVideoMode && <>
                      <td className="td-nowrap td-num">{formatEUR(spend)}</td>
                      <td className="td-nowrap td-num">{formatNumber(impressions)}</td>
                    </>}

                    {isVideoObjective ? (
                      videoMetricMode === 'video' ? (() => {
                        const vViews  = row.video_views ?? 0;
                        const vStarts = row.video_starts ?? 0;
                        const vQ1     = row.video_first_quartile_completions ?? 0;
                        const vQ2     = row.video_midpoint_completions ?? 0;
                        const vQ3     = row.video_third_quartile_completions ?? 0;
                        const vCompl  = row.video_completions ?? 0;
                        const vViewRate = impressions > 0 ? vViews / impressions : 0;
                        const vCPV     = vViews > 0 ? spend / vViews : 0;
                        const vDepth   = computeWatchDepth(vViews, vQ1, vQ2, vQ3, vCompl);
                        return (<>
                          <td className="td-nowrap td-num metric-swap-cell">{formatNumber(vViews)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vViewRate)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vStarts)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ1)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ2)}</td>
                          <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(vQ3)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatNumber(vCompl)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vViews > 0 ? vCompl / vViews : 0)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatEUR(vCPV)}</td>
                          <td className="td-nowrap td-num metric-swap-cell">{formatPercent(vDepth)}</td>
                        </>);
                      })() : (<>
                        <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.reach ?? 0)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatNumber(clicks)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatPercent(row.ctr ?? 0, 3)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpm)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatEUR(cpc)}</td>
                        <td className="td-nowrap td-num hide-md metric-swap-cell">{formatNumber(row.engagements ?? 0)}</td>
                        <td className="td-nowrap td-num hide-lg metric-swap-cell">{formatNumber(row.landing_page_clicks ?? 0)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatNumber(row.conversions ?? 0)}</td>
                        <td className="td-nowrap td-num metric-swap-cell">{formatNumber(row.leads ?? 0)}</td>
                      </>)
                    ) : (<>
                      <td className="td-nowrap td-num hide-lg">{formatNumber(row.reach ?? 0)}</td>
                      <td className="td-nowrap td-num">{formatNumber(clicks)}</td>
                      <td className="td-nowrap td-num">{formatPercent(row.ctr ?? 0, 3)}</td>
                      <td className="td-nowrap td-num">{formatEUR(cpm)}</td>
                      <td className="td-nowrap td-num">{formatEUR(cpc)}</td>
                      <td className="td-nowrap td-num hide-md">{formatNumber(row.engagements ?? 0)}</td>
                      <td className="td-nowrap td-num hide-lg">{formatNumber(row.landing_page_clicks ?? 0)}</td>
                      <td className="td-nowrap td-num">{formatNumber(row.conversions ?? 0)}</td>
                      <td className="td-nowrap td-num">{formatNumber(row.leads ?? 0)}</td>
                    </>)}
                  </tr>
                );
              })}
              {dailyAdRows.length === 0 && (
                <tr><td colSpan={isVideoMode ? 15 : 16} style={{ textAlign: 'center', color: '#5A6577', padding: '2rem' }}>No daily ad performance rows for the current selection.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartContainer>
    </>
  );
}
