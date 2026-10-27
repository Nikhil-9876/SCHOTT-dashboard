-- Migration to add conversions and leads column to ad_performance_metrics
ALTER TABLE ad_performance_metrics ADD COLUMN IF NOT EXISTS conversions bigint DEFAULT 0;
ALTER TABLE ad_performance_metrics ADD COLUMN IF NOT EXISTS leads bigint DEFAULT 0;
