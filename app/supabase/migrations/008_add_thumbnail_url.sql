-- Migration to add thumbnail_url column to ad_performance_metrics
ALTER TABLE ad_performance_metrics ADD COLUMN IF NOT EXISTS thumbnail_url text;
