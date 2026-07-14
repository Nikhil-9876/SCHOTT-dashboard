-- Track which LinkedIn ad account each synced campaign belongs to.
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS ad_account_id text;

CREATE INDEX IF NOT EXISTS idx_campaigns_ad_account_id
ON campaigns (ad_account_id);
