// ── Shared campaign utility types and pure functions ──────────────────────────
// Extracted from TOFUPage / MOFUPage / BOFUPage to avoid duplication.
// All functions here are pure — no React, no hooks.

import { computeDays } from './formatters';
import type { CampaignWithMetrics, AdPerformanceMetric } from '../types';

// ── TOFU Objective ────────────────────────────────────────────────────────────
// Naming tokens: _aw_ → Awareness | _eng_ → Engagement | _vv_ → Video Views
export type Objective = 'All' | 'Awareness' | 'Engagement' | 'Video Views';
export const OBJECTIVE_ORDER: Exclude<Objective, 'All'>[] = ['Awareness', 'Engagement', 'Video Views'];
export const OBJECTIVES: Objective[] = ['All', 'Awareness', 'Engagement', 'Video Views'];

export function detectObjective(campaignName: string): Exclude<Objective, 'All'> {
  const n = campaignName.toLowerCase();
  if (n.includes('_vv_') || n.includes('_videoview') || n.includes('video view')) return 'Video Views';
  if (n.includes('_eng_') || n.includes('_engagement') || n.includes('engagement')) return 'Engagement';
  // _aw_ is explicit awareness; everything else also defaults to Awareness
  return 'Awareness';
}

// ── MOFU Objective ────────────────────────────────────────────────────────────
// Naming tokens:
//   _wv_         → Website Visits
//   _retargeting / retargeting → Retargeting
//   _wv_ + retargeting        → Website Visits Retargeting (more specific match wins)
//   webinar                   → Webinar
//   _eng_                     → Engagement
//   _vv_                      → Video Views
//   _aw_ / default            → Awareness
export type MofuObjective = 'All' | 'Website Visits' | 'Website Visits Retargeting' | 'Retargeting' | 'Webinar' | 'Awareness' | 'Engagement' | 'Video Views';
export const MOFU_OBJECTIVE_ORDER: Exclude<MofuObjective, 'All'>[] = [
  'Website Visits', 'Website Visits Retargeting', 'Retargeting', 'Webinar', 'Awareness', 'Engagement', 'Video Views',
];
export const MOFU_OBJECTIVES: MofuObjective[] = ['All', 'Website Visits', 'Website Visits Retargeting', 'Retargeting', 'Webinar', 'Awareness', 'Engagement', 'Video Views'];

export function detectMofuObjective(campaignName: string): Exclude<MofuObjective, 'All'> {
  const n = campaignName.toLowerCase();
  const hasWv          = n.includes('_wv_') || n.includes('website visit') || n.includes('websitevisit');
  const hasRetargeting = n.includes('retargeting');
  // Most-specific match first
  if (hasWv && hasRetargeting)    return 'Website Visits Retargeting';
  if (hasWv)                      return 'Website Visits';
  if (hasRetargeting)             return 'Retargeting';
  if (n.includes('webinar'))      return 'Webinar';
  if (n.includes('_vv_') || n.includes('_videoview') || n.includes('video view')) return 'Video Views';
  if (n.includes('_eng_') || n.includes('_engagement') || n.includes('engagement')) return 'Engagement';
  return 'Awareness';
}

// Campaigns matching these name patterns belong to MOFU (Website Visits), not TOFU.
export function isWebsiteVisitsCampaign(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('_wv_') || n.includes('_wv ') || n.includes('websitevisit')
    || n.includes('website visit') || n.includes('web visit');
}

// ── Aggregation helpers ───────────────────────────────────────────────────────
export function sum(
  campaigns: CampaignWithMetrics[],
  key: keyof NonNullable<CampaignWithMetrics['latest_metric']>,
): number {
  return campaigns.reduce((acc, c) => acc + (Number(c.latest_metric?.[key]) || 0), 0);
}

export function wavg(
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

// ── Watch depth formula ───────────────────────────────────────────────────────
/**
 * Incremental-band formula for average watch depth (returns 0–1).
 * Assigns each viewer the midpoint of the band they dropped off in:
 *   0–25% → 12.5%  |  25–50% → 37.5%  |  50–75% → 62.5%  |  75–100% → 87.5%  |  completed → 100%
 */
export function computeWatchDepth(
  views: number,
  q1: number,
  q2: number,
  q3: number,
  completions: number,
): number {
  if (views <= 0) return 0;
  return (
    (views - q1)       * 0.125 +
    (q1    - q2)       * 0.375 +
    (q2    - q3)       * 0.625 +
    (q3    - completions) * 0.875 +
     completions       * 1.0
  ) / views;
}

// ── Aggregated ad type ────────────────────────────────────────────────────────
export interface AggregatedAd {
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
  conversions: number;
  leads: number;
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

/** Aggregate daily ad-performance rows → one row per unique creative. */
export function aggregateAdsByCreative(
  rows: AdPerformanceMetric[],
  campaignNameMap: Record<string, string>,
): AggregatedAd[] {
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
      existing.spend_eur   += row.spend_eur   ?? 0;
      existing.impressions += row.impressions ?? 0;
      existing.reach       += row.reach       ?? 0;
      existing.clicks      += row.clicks      ?? 0;
      existing.engagements += row.engagements ?? 0;
      existing.landing_page_clicks              += row.landing_page_clicks              ?? 0;
      existing.conversions                      += row.conversions                      ?? 0;
      existing.leads                            += row.leads                            ?? 0;
      existing.video_views                      += row.video_views                      ?? 0;
      existing.video_completions                += row.video_completions                ?? 0;
      existing.video_starts                     += row.video_starts                     ?? 0;
      existing.video_first_quartile_completions += row.video_first_quartile_completions ?? 0;
      existing.video_midpoint_completions       += row.video_midpoint_completions       ?? 0;
      existing.video_third_quartile_completions += row.video_third_quartile_completions ?? 0;
      // Carry forward metadata (first non-null wins)
      if (existing.video_duration_seconds === null && row.video_duration_seconds != null) {
        existing.video_duration_seconds = row.video_duration_seconds;
      }
      if (!existing.thumbnail_url && row.thumbnail_url) existing.thumbnail_url = row.thumbnail_url;
      if (!existing.creative_url  && row.creative_url)  existing.creative_url  = row.creative_url;
      // Recalculate derived fields from totals
      existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
      existing.avg_watch_depth = computeWatchDepth(
        existing.video_views,
        existing.video_first_quartile_completions,
        existing.video_midpoint_completions,
        existing.video_third_quartile_completions,
        existing.video_completions,
      );
    } else {
      const vStarts = row.video_starts                     ?? 0;
      const vQ1     = row.video_first_quartile_completions ?? 0;
      const vQ2     = row.video_midpoint_completions       ?? 0;
      const vQ3     = row.video_third_quartile_completions ?? 0;
      const vCompl  = row.video_completions                ?? 0;
      const vViews  = row.video_views                      ?? 0;
      map.set(key, {
        creative_id:   row.creative_id,
        creative_name: row.creative_name,
        campaign_id:   row.campaign_id,
        campaign_name: campaignNameMap[row.campaign_id] ?? '—',
        status:        row.status  ?? null,
        spend_eur:     row.spend_eur ?? 0,
        impressions:   row.impressions ?? 0,
        reach:         row.reach  ?? 0,
        clicks:        row.clicks ?? 0,
        ctr:           row.ctr    ?? 0,
        engagements:   row.engagements ?? 0,
        landing_page_clicks:              row.landing_page_clicks              ?? 0,
        conversions:                      row.conversions                      ?? 0,
        leads:                            row.leads                            ?? 0,
        creative_url:  row.creative_url  ?? null,
        reference:     row.reference     ?? null,
        thumbnail_url: row.thumbnail_url ?? null,
        days_running:  null,
        video_views:                      vViews,
        video_completions:                vCompl,
        video_starts:                     vStarts,
        video_first_quartile_completions: vQ1,
        video_midpoint_completions:       vQ2,
        video_third_quartile_completions: vQ3,
        avg_watch_depth:     computeWatchDepth(vViews, vQ1, vQ2, vQ3, vCompl),
        video_duration_seconds: row.video_duration_seconds ?? null,
      });
    }
  }

  for (const [key, ad] of map.entries()) {
    const start = minDate.get(key);
    const end   = maxDate.get(key);
    if (start) {
      const useEnd = ad.status === 'ACTIVE' ? undefined : end;
      ad.days_running = computeDays(start, useEnd);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.impressions - a.impressions);
}

// ── Short chart label helper ──────────────────────────────────────────────────
export function shortLabel(name: string, maxLen = 28): string {
  const parts = name.split('_');
  const meaningful = parts.filter(p => !/^\d{4}$/.test(p) && !/^\d{2}$/.test(p) && !p.includes('/'));
  const label = meaningful.join(' ').trim() || name;
  return label.length > maxLen ? label.slice(0, maxLen - 2) + '…' : label;
}

// ── Video KPI aggregation ─────────────────────────────────────────────────────
export interface VideoKPIs {
  totalVideoViews: number;
  totalVideoCompletions: number;
  totalVideoQ1: number;
  totalVideoQ2: number;
  totalVideoQ3: number;
  totalVideoStarts: number;
  totalVideoSpend: number;
  totalVideoImpressions: number;
  avgViewRate: number;
  avgCPV: number;
  videoCompletionRate: number;
  avgWatchDepth: number;
  avgWatchDurationSec: number | null;
  hasVideoData: boolean;
}

export function computeVideoKPIs(aggregatedAssets: AggregatedAd[]): VideoKPIs {
  const totalVideoViews        = aggregatedAssets.reduce((acc, r) => acc + (r.video_views        ?? 0), 0);
  const totalVideoCompletions  = aggregatedAssets.reduce((acc, r) => acc + (r.video_completions  ?? 0), 0);
  const totalVideoQ1           = aggregatedAssets.reduce((acc, r) => acc + (r.video_first_quartile_completions ?? 0), 0);
  const totalVideoQ2           = aggregatedAssets.reduce((acc, r) => acc + (r.video_midpoint_completions       ?? 0), 0);
  const totalVideoQ3           = aggregatedAssets.reduce((acc, r) => acc + (r.video_third_quartile_completions ?? 0), 0);
  const totalVideoStarts       = aggregatedAssets.reduce((acc, r) => acc + (r.video_starts       ?? 0), 0);
  const totalVideoSpend        = aggregatedAssets.reduce((acc, r) => acc + (r.spend_eur          ?? 0), 0);
  const totalVideoImpressions  = aggregatedAssets.reduce((acc, r) => acc + (r.impressions        ?? 0), 0);

  const avgViewRate         = totalVideoImpressions > 0 ? totalVideoViews / totalVideoImpressions : 0;
  const avgCPV              = totalVideoViews > 0 ? totalVideoSpend / totalVideoViews : 0;
  const videoCompletionRate = totalVideoViews > 0 ? totalVideoCompletions / totalVideoViews : 0;
  const avgWatchDepth       = computeWatchDepth(totalVideoViews, totalVideoQ1, totalVideoQ2, totalVideoQ3, totalVideoCompletions);

  const { totalViewWeightedDur, totalViewsWithDur } = aggregatedAssets.reduce(
    (acc, r) => {
      if (r.video_duration_seconds != null && r.video_views > 0) {
        acc.totalViewWeightedDur += r.avg_watch_depth * r.video_duration_seconds * r.video_views;
        acc.totalViewsWithDur    += r.video_views;
      }
      return acc;
    },
    { totalViewWeightedDur: 0, totalViewsWithDur: 0 },
  );
  const avgWatchDurationSec: number | null = totalViewsWithDur > 0 ? totalViewWeightedDur / totalViewsWithDur : null;

  return {
    totalVideoViews, totalVideoCompletions,
    totalVideoQ1, totalVideoQ2, totalVideoQ3,
    totalVideoStarts, totalVideoSpend, totalVideoImpressions,
    avgViewRate, avgCPV, videoCompletionRate,
    avgWatchDepth, avgWatchDurationSec,
    hasVideoData: totalVideoStarts > 0 || totalVideoViews > 0,
  };
}

// ── Per-campaign video totals ─────────────────────────────────────────────────
export interface CampaignVideoTotal {
  video_views: number;
  video_starts: number;
  video_completions: number;
  video_q1: number;
  video_q2: number;
  video_q3: number;
  spend: number;
  impressions: number;
}

export function buildCampaignVideoTotals(filteredAdRows: AdPerformanceMetric[]): Map<string, CampaignVideoTotal> {
  const map = new Map<string, CampaignVideoTotal>();
  for (const row of filteredAdRows) {
    const id   = row.campaign_id;
    const prev = map.get(id) ?? { video_views: 0, video_starts: 0, video_completions: 0, video_q1: 0, video_q2: 0, video_q3: 0, spend: 0, impressions: 0 };
    map.set(id, {
      video_views:       prev.video_views       + (row.video_views                      ?? 0),
      video_starts:      prev.video_starts      + (row.video_starts                     ?? 0),
      video_completions: prev.video_completions + (row.video_completions                ?? 0),
      video_q1:          prev.video_q1          + (row.video_first_quartile_completions ?? 0),
      video_q2:          prev.video_q2          + (row.video_midpoint_completions       ?? 0),
      video_q3:          prev.video_q3          + (row.video_third_quartile_completions ?? 0),
      spend:             prev.spend             + (row.spend_eur                        ?? 0),
      impressions:       prev.impressions       + (row.impressions                      ?? 0),
    });
  }
  return map;
}
