-- Clears synced dashboard data while keeping the stored LinkedIn OAuth token.
-- This intentionally does not delete from linkedin_tokens.
CREATE OR REPLACE FUNCTION clear_synced_linkedin_data()
RETURNS void AS $$
BEGIN
  DELETE FROM campaign_metrics;
  DELETE FROM campaigns;
  DELETE FROM ingestion_log;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
