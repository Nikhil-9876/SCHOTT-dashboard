-- Daily ad/creative performance rows for the dashboard's ad performance table.
CREATE TABLE IF NOT EXISTS ad_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  creative_id text NOT NULL,
  creative_name text NOT NULL,
  status text,
  date date NOT NULL,
  spend_eur numeric(12,2),
  impressions bigint,
  reach bigint,
  clicks bigint,
  ctr numeric(8,6),
  engagements bigint,
  landing_page_clicks bigint,
  ingested_at timestamptz DEFAULT now(),
  UNIQUE (campaign_id, creative_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ad_performance_metrics_campaign_date
ON ad_performance_metrics (campaign_id, date DESC);

ALTER TABLE ad_performance_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read ad performance metrics"
ON ad_performance_metrics
FOR SELECT
USING (true);
