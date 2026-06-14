import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Campaign, CampaignMetric, CampaignWithMetrics, FunnelStage, IngestionLog } from '../types';

// ── Query Keys ──────────────────────────────────────────────────────────────
export const QUERY_KEYS = {
  campaigns: (stage?: FunnelStage) => ['campaigns', stage ?? 'all'] as const,
  ingestionLog: ['ingestion_log'] as const,
};

const STALE_TIME = 1000 * 60 * 60;       // 1 hour
const GC_TIME    = 1000 * 60 * 60 * 24;  // 24 hours

// ── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * Fetches campaigns joined with their latest campaign_metrics snapshot.
 * Uses a subquery pattern: for each campaign, pick the metric row with
 * the highest ingested_at value.
 */
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

  // For each campaign, keep only the latest metric snapshot
  return (data as (Campaign & { campaign_metrics: CampaignMetric[] })[]).map((c) => ({
    ...c,
    latest_metric: c.campaign_metrics?.[0] ?? null,
  }));
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

async function triggerIngestion(): Promise<void> {
  const secret = import.meta.env.VITE_FUNCTIONS_SECRET as string;
  const { error } = await supabase.functions.invoke('ingest-linkedin-data', {
    headers: { 'x-functions-secret': secret ?? '' },
  });
  if (error) throw new Error(error.message);
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
    onSuccess: () => {
      // Invalidate all campaign and log queries so fresh data is fetched
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
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
      queryClient.invalidateQueries({ queryKey: ['linkedin_connection'] });
    },
  });
}
