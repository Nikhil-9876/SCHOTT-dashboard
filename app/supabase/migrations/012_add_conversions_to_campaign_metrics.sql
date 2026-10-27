-- Migration to add conversions column to campaign_metrics
ALTER TABLE campaign_metrics ADD COLUMN IF NOT EXISTS conversions bigint DEFAULT 0;
