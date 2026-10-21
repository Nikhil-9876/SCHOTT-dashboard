-- Migration: Move FIOLAX Pharma Tubings Webinar campaign from TOFU → MOFU
-- Campaign: 2026/10/15_IN_ToFu_IN_T_PharmaTubing_FIOLAX-T_pharma-tubings_webinar_2026/10/15_sia
-- LinkedIn ID: 896078813  |  Internal UUID: bc2ed42c-4e11-45c4-9e28-17e4d7033818
--
-- SAFETY NOTE: This only updates the funnel_stage column on the campaigns row.
-- All campaign_metrics rows (including reach) are linked by internal campaign.id
-- and are completely untouched by this change — zero data loss.
--
-- The ingest function already detects 'mofu' in the name and will assign MOFU on
-- future syncs automatically; this corrects the existing DB record.

UPDATE campaigns
SET
  funnel_stage = 'MOFU',
  updated_at   = NOW()
WHERE linkedin_id = '896078813';
