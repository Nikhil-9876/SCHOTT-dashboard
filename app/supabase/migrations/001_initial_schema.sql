-- campaigns
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  linkedin_id text unique not null,
  name text not null,
  funnel_stage text not null check (funnel_stage in ('TOFU','MOFU','BOFU')),
  status text not null check (status in ('ACTIVE','COMPLETED','PAUSED')),
  ad_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- campaign_metrics
create table campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  ingested_at timestamptz default now(),
  date_range_start date,
  date_range_end date,
  impressions bigint,
  reach bigint,
  clicks bigint,
  spend_inr numeric(12,2),
  spend_eur numeric(12,2),
  engagement_rate numeric(6,4),
  ctr numeric(6,4),
  cpm_inr numeric(8,2),
  cpc_inr numeric(8,2),
  cpl_inr numeric(8,2),
  leads integer,
  unique (campaign_id, date_range_start, date_range_end)
);
create index idx_campaign_metrics_latest on campaign_metrics (campaign_id, ingested_at desc);

-- ingestion_log
create table ingestion_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text check (status in ('running','success','failed')),
  campaigns_updated integer,
  error_message text
);

-- RLS: anon = read-only; service_role = all
alter table campaigns enable row level security;
alter table campaign_metrics enable row level security;
alter table ingestion_log enable row level security;

create policy "anon read campaigns" on campaigns for select using (true);
create policy "anon read metrics" on campaign_metrics for select using (true);
create policy "anon read log" on ingestion_log for select using (true);
