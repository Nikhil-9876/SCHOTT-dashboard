import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { AdPerformanceMetric, Campaign, CampaignMetric, CampaignWithMetrics, FunnelStage, IngestionLog } from '../types';

// ── Query Keys ──────────────────────────────────────────────────────────────
export const QUERY_KEYS = {
  campaigns: (stage?: FunnelStage) => ['campaigns', stage ?? 'all'] as const,
  adPerformance: (stage?: FunnelStage) => ['ad_performance', stage ?? 'all'] as const,
  ingestionLog: ['ingestion_log'] as const,
};

const STALE_TIME = 1000 * 60 * 60;       // 1 hour
const GC_TIME    = 1000 * 60 * 60 * 24;  // 24 hours

// ── Fetch helpers ────────────────────────────────────────────────────────────

function aggregateCampaignMetrics(metrics: CampaignMetric[]): CampaignMetric | null {
  if (!metrics.length) return null;

  const totals = metrics.reduce((acc, metric) => ({
    impressions: acc.impressions + (Number(metric.impressions) || 0),
    reach: acc.reach + (Number(metric.reach) || 0),
    clicks: acc.clicks + (Number(metric.clicks) || 0),
    spend_inr: acc.spend_inr + (Number(metric.spend_inr) || 0),
    spend_eur: acc.spend_eur + (Number(metric.spend_eur) || 0),
    leads: acc.leads + (Number(metric.leads) || 0),
  }), {
    impressions: 0,
    reach: 0,
    clicks: 0,
    spend_inr: 0,
    spend_eur: 0,
    leads: 0,
  });

  const first = metrics[0];
  return {
    ...first,
    date_range_start: metrics.reduce<string | null>((earliest, metric) => {
      if (!metric.date_range_start) return earliest;
      return !earliest || metric.date_range_start < earliest ? metric.date_range_start : earliest;
    }, null),
    date_range_end: metrics.reduce<string | null>((latest, metric) => {
      if (!metric.date_range_end) return latest;
      return !latest || metric.date_range_end > latest ? metric.date_range_end : latest;
    }, null),
    impressions: totals.impressions,
    reach: totals.reach,
    clicks: totals.clicks,
    spend_inr: totals.spend_inr,
    spend_eur: totals.spend_eur,
    engagement_rate: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
    ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
    cpm_inr: totals.impressions > 0 ? (totals.spend_inr / totals.impressions) * 1000 : 0,
    cpc_inr: totals.clicks > 0 ? totals.spend_inr / totals.clicks : 0,
    cpl_inr: totals.leads > 0 ? totals.spend_inr / totals.leads : 0,
    leads: totals.leads,
  };
}

async function fetchCampaignMetrics(funnelStage?: FunnelStage): Promise<CampaignWithMetrics[]> {
  let query = supabase
    .from('campaigns')
    .select(`
      *,
      campaign_metrics (
        id,
        campaign_id,
        ingested_at,
        date_range_start,
        date_range_end,
        impressions,
        reach,
        clicks,
        spend_inr,
        spend_eur,
        engagement_rate,
        ctr,
        cpm_inr,
        cpc_inr,
        cpl_inr,
        leads
      )
    `)
    .order('ingested_at', { referencedTable: 'campaign_metrics', ascending: false });

  if (funnelStage) {
    query = query.eq('funnel_stage', funnelStage);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data as (Campaign & { campaign_metrics: CampaignMetric[] })[]).map((c) => ({
    ...c,
    latest_metric: aggregateCampaignMetrics(c.campaign_metrics ?? []),
  }));
}

async function fetchAdPerformance(funnelStage?: FunnelStage): Promise<AdPerformanceMetric[]> {
  let query = supabase
    .from('ad_performance_metrics')
    .select(`
      *,
      campaign:campaigns (
        id,
        name,
        funnel_stage
      )
    `)
    .order('date', { ascending: false });

  if (funnelStage) {
    query = query.eq('campaign.funnel_stage', funnelStage);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).filter((row) => !funnelStage || row.campaign?.funnel_stage === funnelStage) as AdPerformanceMetric[];
}

async function fetchIngestionLog(): Promise<IngestionLog[]> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error
    ? error.message
    : 'Sync failed. Please try again.';

  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return fallback;

  try {
    const payload = await context.clone().json();
    if (typeof payload?.error === 'string') return payload.error;
    if (typeof payload?.message === 'string') return payload.message;
  } catch {
    try {
      const text = await context.clone().text();
      if (text) return text;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

async function triggerIngestion(): Promise<void> {
  const secret = import.meta.env.VITE_FUNCTIONS_SECRET as string;
  const { error } = await supabase.functions.invoke('ingest-linkedin-data', {
    headers: { 'x-functions-secret': secret ?? '' },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useCampaignMetrics(funnelStage?: FunnelStage) {
  return useQuery<CampaignWithMetrics[], Error>({
    queryKey: QUERY_KEYS.campaigns(funnelStage),
    queryFn: () => fetchCampaignMetrics(funnelStage),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

export function useAdPerformance(funnelStage?: FunnelStage) {
  return useQuery<AdPerformanceMetric[], Error>({
    queryKey: QUERY_KEYS.adPerformance(funnelStage),
    queryFn: () => fetchAdPerformance(funnelStage),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

export function useIngestionLog() {
  return useQuery<IngestionLog[], Error>({
    queryKey: QUERY_KEYS.ingestionLog,
    queryFn: fetchIngestionLog,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

export function useTriggerIngestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerIngestion,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['ad_performance'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ingestionLog });
    },
  });
}

export function useLinkedInConnection() {
  return useQuery<boolean, Error>({
    queryKey: ['linkedin_connection'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_linkedin_connection');
      if (error) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('linkedin_tokens')
          .select('id')
          .limit(1);
        if (fallbackError) return false;
        return (fallbackData && fallbackData.length > 0);
      }
      return !!data;
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

export function useDisconnectLinkedIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('disconnect_linkedin');
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.setQueryData(['linkedin_connection'], false);
      queryClient.invalidateQueries({ queryKey: ['linkedin_connection'] });
    },
  });
}
