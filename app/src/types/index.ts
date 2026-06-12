export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU';
export type CampaignStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED';
export type IngestionStatus = 'running' | 'success' | 'failed';

export interface Campaign {
  id: string;
  linkedin_id: string;
  name: string;
  funnel_stage: FunnelStage;
  status: CampaignStatus;
  ad_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignMetric {
  id: string;
  campaign_id: string;
  ingested_at: string;
  date_range_start: string | null;
  date_range_end: string | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  spend_inr: number | null;
  spend_eur: number | null;
  engagement_rate: number | null; // stored as decimal e.g. 0.0314
  ctr: number | null;             // stored as decimal e.g. 0.0118
  cpm_inr: number | null;
  cpc_inr: number | null;
  cpl_inr: number | null;
  leads: number | null;
}

export interface IngestionLog {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: IngestionStatus;
  campaigns_updated: number | null;
  error_message: string | null;
}

/** Joined type returned from Supabase query */
export interface CampaignWithMetrics extends Campaign {
  latest_metric: CampaignMetric | null;
}
