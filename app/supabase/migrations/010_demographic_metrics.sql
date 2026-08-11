-- Demographic breakdowns fetched from LinkedIn adAnalytics per-campaign.
-- Each row = one demographic segment's metrics for one campaign on one date.
CREATE TABLE IF NOT EXISTS demographic_metrics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date              date NOT NULL,
  demographic_type  text NOT NULL,  -- 'job_function' | 'seniority' | 'industry' | 'geo_country' | 'company_size'
  demographic_value text NOT NULL,  -- human-readable label, e.g. 'Engineering', 'Director', 'Germany'
  impressions       bigint,
  clicks            bigint,
  spend_eur         numeric(12,2),
  ingested_at       timestamptz DEFAULT now(),
  UNIQUE (campaign_id, date, demographic_type, demographic_value)
);

CREATE INDEX IF NOT EXISTS idx_demographic_metrics_campaign
  ON demographic_metrics (campaign_id, demographic_type, date DESC);

ALTER TABLE demographic_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read demographic metrics"
  ON demographic_metrics FOR SELECT USING (true);
