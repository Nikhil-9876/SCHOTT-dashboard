-- Video view metrics on campaign_metrics (aggregate rollup per day)
ALTER TABLE campaign_metrics
  ADD COLUMN IF NOT EXISTS video_views bigint,
  ADD COLUMN IF NOT EXISTS video_completions bigint,
  ADD COLUMN IF NOT EXISTS video_starts bigint,
  ADD COLUMN IF NOT EXISTS video_first_quartile_completions bigint,
  ADD COLUMN IF NOT EXISTS video_midpoint_completions bigint,
  ADD COLUMN IF NOT EXISTS video_third_quartile_completions bigint;

-- Video view metrics on ad_performance_metrics (daily per-creative)
ALTER TABLE ad_performance_metrics
  ADD COLUMN IF NOT EXISTS video_views bigint,
  ADD COLUMN IF NOT EXISTS video_completions bigint,
  ADD COLUMN IF NOT EXISTS video_starts bigint,
  ADD COLUMN IF NOT EXISTS video_first_quartile_completions bigint,
  ADD COLUMN IF NOT EXISTS video_midpoint_completions bigint,
  ADD COLUMN IF NOT EXISTS video_third_quartile_completions bigint;
