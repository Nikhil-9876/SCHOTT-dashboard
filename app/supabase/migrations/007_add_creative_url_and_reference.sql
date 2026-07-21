-- Migration to add reference and creative_url columns to ad_performance_metrics
ALTER TABLE ad_performance_metrics ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE ad_performance_metrics ADD COLUMN IF NOT EXISTS creative_url text;
