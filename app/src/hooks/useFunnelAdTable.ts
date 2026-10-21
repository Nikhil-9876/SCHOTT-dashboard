import { useState, useMemo } from 'react';
import type { AdPerformanceMetric, CampaignWithMetrics } from '../types';
import { aggregateAdsByCreative, type AggregatedAd } from '../lib/campaignUtils';

/**
 * Shared state + derived data for the Ad Asset table that appears on every
 * funnel page (TOFU / MOFU / BOFU). Extract this hook to avoid copy-pasting
 * ~100 lines of identical useState / useMemo code into each page component.
 */
export function useFunnelAdTable(
  campaigns: CampaignWithMetrics[],
  adPerformanceRows: AdPerformanceMetric[],
) {
  // ── Selection (checkboxes for daily drill-down) ─────────────────────────────
  const [selectedAdKeys, setSelectedAdKeys] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string>('');

  function toggleAdSelection(key: string) {
    setSelectedAdKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function clearAdSelection() { setSelectedAdKeys(new Set()); }

  // ── Sorting ─────────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<keyof AggregatedAd | 'cpm' | 'cpc'>('impressions');
  const [sortAscending, setSortAscending] = useState<boolean>(false);

  function handleSort(field: keyof AggregatedAd | 'cpm' | 'cpc') {
    if (sortField === field) {
      setSortAscending(prev => !prev);
    } else {
      setSortField(field);
      setSortAscending(['creative_name', 'campaign_name', 'status', 'creative_id'].includes(field as string));
    }
  }
  function renderSortIndicator(field: keyof AggregatedAd | 'cpm' | 'cpc') {
    if (sortField !== field) return null;
    return sortAscending ? ' ▲' : ' ▼';
  }

  // ── Campaign lookup maps ────────────────────────────────────────────────────
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

  // ── Aggregated assets ───────────────────────────────────────────────────────
  const aggregatedAssets = useMemo(
    () => aggregateAdsByCreative(adPerformanceRows, campaignNameMap),
    [adPerformanceRows, campaignNameMap],
  );

  // ── Sorted assets ───────────────────────────────────────────────────────────
  const sortedAssets = useMemo(() => {
    return [...aggregatedAssets].sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === 'cpm') {
        aVal = a.impressions ? (a.spend_eur / a.impressions) * 1000 : 0;
        bVal = b.impressions ? (b.spend_eur / b.impressions) * 1000 : 0;
      } else if (sortField === 'cpc') {
        aVal = a.clicks ? a.spend_eur / a.clicks : 0;
        bVal = b.clicks ? b.spend_eur / b.clicks : 0;
      } else {
        aVal = a[sortField]; bVal = b[sortField];
      }
      if (aVal === null || aVal === undefined) return sortAscending ? -1 : 1;
      if (bVal === null || bVal === undefined) return sortAscending ? 1 : -1;
      if (typeof aVal === 'string') return sortAscending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortAscending ? aVal - bVal : bVal - aVal;
    });
  }, [aggregatedAssets, sortField, sortAscending]);

  // ── Available dates (for date-picker) ──────────────────────────────────────
  const availableDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of adPerformanceRows) { if (r.date) s.add(r.date.slice(0, 10)); }
    return s;
  }, [adPerformanceRows]);

  // ── Daily rows (filtered by selection + date) ───────────────────────────────
  const dailyAdRows = useMemo(() => {
    let rows = adPerformanceRows;
    if (selectedAdKeys.size > 0) rows = rows.filter(r => selectedAdKeys.has(`${r.campaign_id}__${r.creative_id}`));
    if (selectedDate) rows = rows.filter(r => r.date?.slice(0, 10) === selectedDate);
    return rows;
  }, [adPerformanceRows, selectedAdKeys, selectedDate]);

  return {
    // selection
    selectedAdKeys, setSelectedAdKeys, toggleAdSelection, clearAdSelection,
    // date
    selectedDate, setSelectedDate,
    // sort
    sortField, sortAscending, handleSort, renderSortIndicator,
    // data
    campaignNameMap, campaignStatusMap,
    aggregatedAssets, sortedAssets,
    availableDates, dailyAdRows,
  };
}
