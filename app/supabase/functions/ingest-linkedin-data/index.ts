import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-functions-secret',
};

const DEFAULT_LINKEDIN_API_VERSION = '202606';

function getLinkedInApiVersion() {
  const configuredVersion = Deno.env.get('LINKEDIN_API_VERSION')?.trim();
  if (configuredVersion && /^\d{6}$/.test(configuredVersion)) {
    return configuredVersion;
  }

  return DEFAULT_LINKEDIN_API_VERSION;
}

function normalizeAdAccountId(accountId: string | number) {
  return String(accountId).replace(/^urn:li:sponsoredAccount:/, '');
}

function toLinkedInUrn(value: string | number, entity: string) {
  const id = String(value);
  return id.startsWith('urn:li:') ? id : `urn:li:${entity}:${id}`;
}

function getRequiredAdAccountId() {
  const configuredAdAccountId = Deno.env.get('LINKEDIN_AD_ACCOUNT_ID')?.trim();
  if (!configuredAdAccountId) {
    throw new Error('LINKEDIN_AD_ACCOUNT_ID is not configured. Set this Supabase secret to the specific Campaign Manager ad account id before syncing.');
  }

  return normalizeAdAccountId(configuredAdAccountId);
}

function getCampaignNameIncludes() {
  const configuredFilter = Deno.env.get('LINKEDIN_CAMPAIGN_NAME_INCLUDES')?.trim();
  if (!configuredFilter) {
    return [];
  }

  return configuredFilter
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

// Explicit blocklist — campaigns whose names contain any of these terms are always skipped
function getCampaignNameExcludes() {
  const configuredFilter = Deno.env.get('LINKEDIN_CAMPAIGN_NAME_EXCLUDES')?.trim();
  if (!configuredFilter) return [];
  return configuredFilter
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function campaignMatchesNameFilter(campaignName: string, includeTerms: string[]) {
  if (includeTerms.length === 0) return true;

  const normalizedName = campaignName.toLowerCase();
  return includeTerms.some((term) => normalizedName.includes(term));
}

function getAnalyticsLookbackDays() {
  const configuredDays = Number(Deno.env.get('LINKEDIN_ANALYTICS_LOOKBACK_DAYS'));
  if (Number.isFinite(configuredDays) && configuredDays > 0) {
    return Math.floor(configuredDays);
  }

  return 365;
}

const MIN_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function getIngestionTrigger(req: Request) {
  try {
    const payload = await req.clone().json();
    return payload?.trigger === 'manual' ? 'manual' : 'scheduled';
  } catch {
    return 'scheduled';
  }
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function getLinkedInDateParts(date: Date) {
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function buildDateRangeQuery(startDate: Date, endDate: Date) {
  const start = getLinkedInDateParts(startDate);
  const end = getLinkedInDateParts(endDate);

  return `(start:(day:${start.day},month:${start.month},year:${start.year}),end:(day:${end.day},month:${end.month},year:${end.year}))`;
}

function getLastSyncTimestamp(log: { finished_at: string | null; started_at: string } | null) {
  if (!log) return null;
  return new Date(log.finished_at ?? log.started_at);
}

function getSyncDateRange(lastSuccessfulSyncAt: Date | null, now: Date, initialLookbackDays: number) {
  const today = startOfUtcDay(now);

  if (!lastSuccessfulSyncAt) {
    return {
      startDate: addUtcDays(today, -initialLookbackDays),
      endDate: today,
    };
  }

  // Keep a 3-day overlap (subtracting 2 days from the last sync date) to ensure
  // metrics like reach (which require a full 24-hour window to settle) are updated.
  return {
    startDate: addUtcDays(startOfUtcDay(lastSuccessfulSyncAt), -2),
    endDate: today,
  };
}

function buildCampaignsUrl(adAccountId: string, pageToken: string | null) {
  const campaignTypes = ['TEXT_AD', 'SPONSORED_UPDATES', 'SPONSORED_INMAILS', 'DYNAMIC'];
  const campaignStatuses = [
    'ACTIVE',
    'PAUSED',
    'ARCHIVED',
    'COMPLETED',
    'CANCELED',
    'DRAFT',
    'PENDING_DELETION',
    'REMOVED',
  ];
  const search = `(type:(values:List(${campaignTypes.join(',')})),status:(values:List(${campaignStatuses.join(',')})))`;
  const params = [
    'q=search',
    `search=${search}`,
    'sortOrder=DESCENDING',
    'pageSize=100',
  ];

  if (pageToken) params.push(`pageToken=${encodeURIComponent(pageToken)}`);

  return `https://api.linkedin.com/rest/adAccounts/${adAccountId}/adCampaigns?${params.join('&')}`;
}

function buildCreativesUrl(adAccountId: string, campaignUrn: string, pageToken: string | null) {
  const params = [
    'q=criteria',
    `campaigns=List(${encodeURIComponent(campaignUrn)})`,
    'pageSize=100',
  ];

  if (pageToken) params.push(`pageToken=${encodeURIComponent(pageToken)}`);

  return `https://api.linkedin.com/rest/adAccounts/${adAccountId}/creatives?${params.join('&')}`;
}

function getCreativeName(rawCreative: Record<string, unknown>, creativeId: string) {
  const content = rawCreative.content as Record<string, unknown> | undefined;
  return String(
    rawCreative.name
    ?? rawCreative.reference
    ?? content?.reference
    ?? `Ad_${creativeId}`
  );
}

async function fetchCreatives(adAccountId: string, campaignUrn: string, headers: Record<string, string>) {
  const creatives: { id: string; name: string; status: string | null; reference: string | null; creative_url: string | null }[] = [];
  let pageToken: string | null = null;

  do {
    const creativesRes = await fetch(buildCreativesUrl(adAccountId, campaignUrn, pageToken), { headers });
    if (!creativesRes.ok) {
      console.warn(`Failed to fetch creatives for ${campaignUrn}: ${await creativesRes.text()}`);
      return creatives;
    }

    const creativesData = await creativesRes.json();
    for (const rawCreative of (creativesData.elements || [])) {
      const creativeId = String(rawCreative.id);
      // LinkedIn REST API often omits 'status' on creative objects;
      // check both 'status' and 'intendedStatus' (used in newer API versions).
      const rawStatus = rawCreative.status ?? rawCreative.intendedStatus ?? null;

      const content = rawCreative.content as Record<string, unknown> | undefined;
      const reference = String(rawCreative.reference ?? content?.reference ?? '');

      let creativeUrl: string | null = null;
      if (reference && reference.startsWith('urn:li:')) {
        creativeUrl = `https://www.linkedin.com/feed/update/${reference}`;
      }

      creatives.push({
        id: creativeId,
        name: getCreativeName(rawCreative, creativeId),
        status: rawStatus ? String(rawStatus) : null,
        reference: reference || null,
        creative_url: creativeUrl,
      });
    }
    pageToken = creativesData.metadata?.nextPageToken ?? null;
  } while (pageToken);

  return creatives;
}

// ── Fetch and permanently store ad creative thumbnail ────────────────────────
// Strategy: scrape the LinkedIn public post page (server-side, no CORS) and
// extract the og:image URL. LinkedIn embeds a stable, long-lived CDN URL in
// the Open Graph meta tags (e=2147483647 = effectively permanent). We then
// download the image bytes and re-host them in Supabase Storage for a fully
// stable, auth-free thumbnail URL that the dashboard can use forever.
async function fetchCreativeThumbnail(
  reference: string,
  creativeId: string,
  supabaseClient: ReturnType<typeof createClient>,
): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const numericId = creativeId.replace(/^urn:li:\w+:/, '');
    const fileName = `${numericId}.jpg`;

    // Step 1: Fetch the public LinkedIn post page and extract og:image
    const postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(reference)}`;
    const pageRes = await fetch(postUrl, {
      headers: {
        // Use a crawler UA so LinkedIn renders the full OG meta tags
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    if (!pageRes.ok) {
      console.warn(`[thumbnail] Failed to fetch post page for ${reference}: ${pageRes.status}`);
      return null;
    }
    const html = await pageRes.text();

    // Extract og:image content attribute (handles both attribute orders)
    const ogImageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const ogImageUrl = ogImageMatch?.[1]?.replace(/&amp;/g, '&') ?? null;

    if (!ogImageUrl) {
      console.warn(`[thumbnail] No og:image found in post page for ${reference}`);
      return null;
    }

    // Step 2: Download image bytes from the CDN URL
    const imgRes = await fetch(ogImageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    });
    if (!imgRes.ok) {
      console.warn(`[thumbnail] Failed to download og:image for ${creativeId}: ${imgRes.status}`);
      return null;
    }
    const bytes = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const finalFileName = `${numericId}.${ext}`;

    // Step 3: Upload to Supabase Storage (upsert = idempotent on re-sync)
    const { error: uploadError } = await supabaseClient.storage
      .from('ad-thumbnails')
      .upload(finalFileName, bytes, { contentType, upsert: true });

    if (uploadError) {
      console.warn(`[thumbnail] Storage upload failed for ${creativeId}: ${uploadError.message}`);
      return null;
    }

    // Step 4: Return stable public URL
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/ad-thumbnails/${finalFileName}`;
    console.log(`[thumbnail] ✓ Stored thumbnail for ${creativeId} → ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.warn(`[thumbnail] Unexpected error for ${creativeId}:`, err);
    return null;
  }
}

const BASE_CAMPAIGN_ANALYTICS_FIELDS = [
  'dateRange',
  'pivotValues',
  'impressions',
  'approximateMemberReach',
  'clicks',
  'costInLocalCurrency',
  'externalWebsiteConversions',
];

// Video fields are ONLY available on the CREATIVE pivot, not CAMPAIGN pivot.
// These are kept here as documentation but NOT used in buildAnalyticsUrl.
const VIDEO_ANALYTICS_FIELDS = [
  'videoViews',
  'videoCompletions',
  'videoStarts',
  'videoFirstQuartileCompletions',
  'videoMidpointCompletions',
  'videoThirdQuartileCompletions',
];

const LEAD_FORM_ANALYTICS_FIELDS = [
  'oneClickLeads',
  'viralOneClickLeads',
  'leadGenerationMailContactInfoShares',
];

const CREATIVE_ANALYTICS_FIELDS = [
  'dateRange',
  'pivotValues',
  'impressions',
  'approximateMemberReach',
  'clicks',
  'costInLocalCurrency',
  'totalEngagements',
  'landingPageClicks',
  'videoViews',
  'videoCompletions',
  'videoStarts',
  'videoFirstQuartileCompletions',
  'videoMidpointCompletions',
  'videoThirdQuartileCompletions',
];

function buildAnalyticsUrl(campaignUrn: string, dateRangeQuery: string, fields: string[]) {
  const params = [
    'q=analytics',
    'pivot=CAMPAIGN',
    `dateRange=${dateRangeQuery}`,
    'timeGranularity=DAILY',
    `campaigns=List(${encodeURIComponent(campaignUrn)})`,
    `fields=${fields.join(',')}`,
  ];

  return `https://api.linkedin.com/rest/adAnalytics?${params.join('&')}`;
}

function buildCreativeAnalyticsUrl(creativeUrn: string, dateRangeQuery: string) {
  const params = [
    'q=analytics',
    'pivot=CREATIVE',
    `dateRange=${dateRangeQuery}`,
    'timeGranularity=DAILY',
    `creatives=List(${encodeURIComponent(creativeUrn)})`,
    `fields=${CREATIVE_ANALYTICS_FIELDS.join(',')}`,
  ];

  return `https://api.linkedin.com/rest/adAnalytics?${params.join('&')}`;
}

async function fetchCampaignAnalytics(campaignUrn: string, dateRangeQuery: string, headers: Record<string, string>) {
  const extendedFields = [...BASE_CAMPAIGN_ANALYTICS_FIELDS, ...LEAD_FORM_ANALYTICS_FIELDS];
  const extendedResponse = await fetch(buildAnalyticsUrl(campaignUrn, dateRangeQuery, extendedFields), { headers });
  if (extendedResponse.ok) {
    return extendedResponse;
  }

  const extendedError = await extendedResponse.text();
  console.warn(`Failed to fetch extended campaign analytics for ${campaignUrn}: ${extendedError}`);

  const baseResponse = await fetch(buildAnalyticsUrl(campaignUrn, dateRangeQuery, BASE_CAMPAIGN_ANALYTICS_FIELDS), { headers });
  if (!baseResponse.ok) {
    console.warn(`Failed to fetch campaign analytics for ${campaignUrn}: ${await baseResponse.text()}`);
  }

  return baseResponse;
}

function getNumberMetric(stat: Record<string, unknown>, key: string) {
  return Number(stat[key] ?? 0) || 0;
}

function getReach(stat: Record<string, unknown>) {
  return getNumberMetric(stat, 'approximateMemberReach');
}

function getLeadCount(stat: Record<string, unknown>) {
  const websiteConversions = getNumberMetric(stat, 'externalWebsiteConversions');
  const leadFormSubmissions = LEAD_FORM_ANALYTICS_FIELDS.reduce(
    (total, field) => total + getNumberMetric(stat, field),
    0
  );

  return websiteConversions + leadFormSubmissions;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Verify caller has the FUNCTIONS_SECRET
    const secret = req.headers.get('x-functions-secret');
    if (secret !== Deno.env.get('FUNCTIONS_SECRET')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const ingestionTrigger = await getIngestionTrigger(req);
    const isManualSync = ingestionTrigger === 'manual';

    const { data: lastSuccessLog, error: lastSuccessError } = await supabaseClient
      .from('ingestion_log')
      .select('started_at, finished_at')
      .eq('status', 'success')
      .order('finished_at', { ascending: false, nullsFirst: false })
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSuccessError) throw new Error(`Failed to read sync log: ${lastSuccessError.message}`);

    const lastSuccessfulSyncAt = getLastSyncTimestamp(lastSuccessLog);
    if (!isManualSync && lastSuccessfulSyncAt && now.getTime() - lastSuccessfulSyncAt.getTime() < MIN_SYNC_INTERVAL_MS) {
      const nextSyncAt = new Date(lastSuccessfulSyncAt.getTime() + MIN_SYNC_INTERVAL_MS);
      return new Response(JSON.stringify({
        error: `Last sync should be 24 hours apart. Please try again after ${nextSyncAt.toISOString()}.`,
        next_sync_at: nextSyncAt.toISOString(),
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const analyticsLookbackDays = getAnalyticsLookbackDays();
    const { startDate, endDate } = getSyncDateRange(lastSuccessfulSyncAt, now, analyticsLookbackDays);
    const dateRangeQuery = buildDateRangeQuery(startDate, endDate);

    // 2. Insert ingestion log (Running)
    const { data: logData, error: logError } = await supabaseClient
      .from('ingestion_log')
      .insert({ status: 'running' })
      .select('id')
      .single();

    if (logError) throw new Error(`Failed to create log: ${logError.message}`);
    const logId = logData.id;

    try {
      // 3. Fetch the LinkedIn Access Token
      const { data: tokenData, error: tokenError } = await supabaseClient
        .from('linkedin_tokens')
        .select('access_token, expires_at')
        .limit(1)
        .single();

      if (tokenError || !tokenData) {
        throw new Error('No LinkedIn access token found. Please connect LinkedIn first.');
      }

      const { access_token, expires_at } = tokenData;
      if (new Date(expires_at) < new Date()) {
        throw new Error('LinkedIn access token is expired. Please reconnect.');
      }

      const version = getLinkedInApiVersion();
      const apiHeaders = {
        'Authorization': `Bearer ${access_token}`,
        'LinkedIn-Version': version,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      };

      // 4. Resolve the configured Ad Account. Do not auto-discover here:
      // this dashboard must stay scoped to one known Campaign Manager account.
      const adAccountId = getRequiredAdAccountId();
      const campaignNameIncludes = getCampaignNameIncludes();

      // 5. Fetch Campaigns for the Ad Account
      const campaigns: { id: string | number; name?: string; status?: string }[] = [];
      let pageToken: string | null = null;

      do {
        const campaignsRes = await fetch(buildCampaignsUrl(adAccountId, pageToken), { headers: apiHeaders });
        if (!campaignsRes.ok) throw new Error(`Failed to fetch campaigns: ${await campaignsRes.text()}`);
        const campaignsData = await campaignsRes.json();

        campaigns.push(...(campaignsData.elements || []));
        pageToken = campaignsData.metadata?.nextPageToken ?? null;
      } while (pageToken);

      const campaignNameExcludes = getCampaignNameExcludes();

      // Campaign start date cutoff — only sync campaigns that started on or after 2026-07-01
      const CAMPAIGN_START_CUTOFF = new Date('2026-07-01T00:00:00Z').getTime();

      const MONTH_MAP: Record<string, number> = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
      };

      function isCampaignBeforeCutoff(name: string, runScheduleStart?: number): boolean {
        // Check via LinkedIn API runSchedule field
        if (typeof runScheduleStart === 'number' && runScheduleStart > 0) {
          return runScheduleStart < CAMPAIGN_START_CUTOFF;
        }
        // Fallback: parse date from campaign name, e.g. "Video views - Jan 30, 2026" or "2026/07/01_..."
        const shortMonthMatch = name.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d+,?\s+(\d{4})/i);
        if (shortMonthMatch) {
          const month = MONTH_MAP[shortMonthMatch[1].toLowerCase()];
          const year = parseInt(shortMonthMatch[2], 10);
          return new Date(Date.UTC(year, month - 1, 1)).getTime() < CAMPAIGN_START_CUTOFF;
        }
        const slashDateMatch = name.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (slashDateMatch) {
          return new Date(`${slashDateMatch[1]}-${slashDateMatch[2]}-${slashDateMatch[3]}T00:00:00Z`).getTime() < CAMPAIGN_START_CUTOFF;
        }
        return false; // no date found — allow through
      }

      const filteredCampaigns = campaigns.filter((rawCamp) => {
        const campaignId = String(rawCamp.id);
        const campaignName = String(rawCamp.name ?? `LinkedIn campaign ${campaignId}`);
        const campaignNameLower = campaignName.toLowerCase();

        // 1. Name include filter
        if (!campaignMatchesNameFilter(campaignName, campaignNameIncludes)) return false;

        // 2. Explicit blocklist (LINKEDIN_CAMPAIGN_NAME_EXCLUDES env variable)
        if (campaignNameExcludes.some((term) => campaignNameLower.includes(term))) {
          console.log(`Skipping "${campaignName}" — matched explicit exclude list`);
          return false;
        }

        // 3. Start date cutoff filter
        const runScheduleStart: number | undefined = (rawCamp as any).runSchedule?.start;
        if (isCampaignBeforeCutoff(campaignName, runScheduleStart)) {
          console.log(`Skipping "${campaignName}" — before 2026-07-01 cutoff (runSchedule.start=${runScheduleStart})`);
          return false;
        }

        return true;
      });

      await supabaseClient
        .from('campaigns')
        .delete()
        .or(`ad_account_id.is.null,ad_account_id.neq.${adAccountId}`);

      let campaignsUpdated = 0;

      // Pre-load all existing thumbnail_urls to avoid re-downloading on every sync
      const { data: existingThumbRows } = await supabaseClient
        .from('ad_performance_metrics')
        .select('creative_id, thumbnail_url')
        .not('thumbnail_url', 'is', null);
      const thumbCache = new Map<string, string>(
        (existingThumbRows ?? []).map((r: { creative_id: string; thumbnail_url: string }) => [r.creative_id, r.thumbnail_url])
      );

      for (const rawCamp of filteredCampaigns) {
        const campaignId = String(rawCamp.id);
        const campaignName = String(rawCamp.name ?? `LinkedIn campaign ${campaignId}`);
        const campaignUrn = toLinkedInUrn(campaignId, 'sponsoredCampaign');
        const creatives = await fetchCreatives(adAccountId, campaignUrn, apiHeaders);
        const adCount = creatives.length;

        // Map LinkedIn statuses to DB constraint: 'ACTIVE' | 'COMPLETED' | 'PAUSED'
        let mappedStatus: 'ACTIVE' | 'COMPLETED' | 'PAUSED' = 'PAUSED';
        if (rawCamp.status === 'ACTIVE') mappedStatus = 'ACTIVE';
        if (rawCamp.status === 'COMPLETED') mappedStatus = 'COMPLETED';

        // Categorize campaigns into funnel stages (TOFU / MOFU / BOFU) using custom rules
        let funnelStage: 'TOFU' | 'MOFU' | 'BOFU' = 'TOFU';
        const nameLower = campaignName.toLowerCase();
        if (nameLower.includes('mofu') || nameLower.includes('consideration') || nameLower.includes('traffic')) {
          funnelStage = 'MOFU';
        } else if (nameLower.includes('bofu') || nameLower.includes('conversion') || nameLower.includes('lead')) {
          funnelStage = 'BOFU';
        }

        // Upsert Campaign details in campaigns table
        const { data: dbCampaign, error: upsertErr } = await supabaseClient
          .from('campaigns')
          .upsert({
            ad_account_id: adAccountId,
            linkedin_id: campaignId,
            name: campaignName,
            status: mappedStatus,
            funnel_stage: funnelStage,
            ad_count: adCount,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'linkedin_id' })
          .select('id')
          .single();

        if (upsertErr || !dbCampaign) continue;

        // 6. Fetch Daily Analytics metrics for this campaign.
        const analyticsRes = await fetchCampaignAnalytics(campaignUrn, dateRangeQuery, apiHeaders);
        if (analyticsRes.ok) {
          const analyticsData = await analyticsRes.json();
          
          for (const stat of (analyticsData.elements || [])) {
            const dateStart = `${stat.dateRange.start.year}-${String(stat.dateRange.start.month).padStart(2, '0')}-${String(stat.dateRange.start.day).padStart(2, '0')}`;
            const dateEnd = `${stat.dateRange.end.year}-${String(stat.dateRange.end.month).padStart(2, '0')}-${String(stat.dateRange.end.day).padStart(2, '0')}`;
            
            const impressions = stat.impressions || 0;
            const reach = getReach(stat);
            const clicks = stat.clicks || 0;
            const spend = Number(stat.costInLocalCurrency) || 0;
            const leads = getLeadCount(stat);
            const cpm = impressions > 0 ? ((spend / impressions) * 1000) : 0;
            const cpc = clicks > 0 ? (spend / clicks) : 0;
            const cpl = leads > 0 ? (spend / leads) : 0;

            await supabaseClient
              .from('campaign_metrics')
              .upsert({
                campaign_id: dbCampaign.id,
                date_range_start: dateStart,
                date_range_end: dateEnd,
                impressions,
                reach,
                clicks,
                spend_inr: spend,
                spend_eur: spend,
                engagement_rate: impressions > 0 ? (clicks / impressions) : 0,
                ctr: impressions > 0 ? (clicks / impressions) : 0,
                cpm_inr: cpm,
                cpc_inr: cpc,
                cpl_inr: cpl,
                leads,
                // Note: video fields not available at the CAMPAIGN pivot in LinkedIn's API.
                // Video data is captured per-creative in ad_performance_metrics below.
              }, { onConflict: 'campaign_id,date_range_start,date_range_end' });
          }
        }

        for (const creative of creatives) {
          const creativeUrn = toLinkedInUrn(creative.id, 'sponsoredCreative');
          const creativeAnalyticsRes = await fetch(buildCreativeAnalyticsUrl(creativeUrn, dateRangeQuery), { headers: apiHeaders });
          if (!creativeAnalyticsRes.ok) {
            console.warn(`Failed to fetch ad analytics for ${creativeUrn}: ${await creativeAnalyticsRes.text()}`);
            continue;
          }

          // LinkedIn REST API does not reliably return status on creative objects.
          // Fall back to the parent campaign's status so the field is never null.
          const effectiveCreativeStatus = creative.status ?? mappedStatus;

          // Fetch thumbnail — reuse cached URL if already downloaded in a prior sync.
          // This avoids redundant API calls and re-uploads on every daily sync run.
          let thumbnailUrl = thumbCache.get(creative.id) ?? null;
          if (!thumbnailUrl && creative.reference) {
            thumbnailUrl = await fetchCreativeThumbnail(creative.reference, creative.id, supabaseClient);
            if (thumbnailUrl) thumbCache.set(creative.id, thumbnailUrl);
          }

          const creativeAnalyticsData = await creativeAnalyticsRes.json();
          for (const stat of (creativeAnalyticsData.elements || [])) {
            const date = `${stat.dateRange.start.year}-${String(stat.dateRange.start.month).padStart(2, '0')}-${String(stat.dateRange.start.day).padStart(2, '0')}`;
            const impressions = stat.impressions || 0;
            const clicks = stat.clicks || 0;

            await supabaseClient
              .from('ad_performance_metrics')
              .upsert({
                campaign_id: dbCampaign.id,
                creative_id: creative.id,
                creative_name: creative.name,
                status: effectiveCreativeStatus,
                date,
                spend_eur: Number(stat.costInLocalCurrency) || 0,
                impressions,
                reach: getReach(stat),
                clicks,
                ctr: impressions > 0 ? (clicks / impressions) : 0,
                engagements: stat.totalEngagements || clicks,
                landing_page_clicks: stat.landingPageClicks || 0,
                reference: creative.reference,
                creative_url: creative.creative_url,
                thumbnail_url: thumbnailUrl,
                video_views: stat.videoViews || 0,
                video_completions: stat.videoCompletions || 0,
                video_starts: stat.videoStarts || 0,
                video_first_quartile_completions: stat.videoFirstQuartileCompletions || 0,
                video_midpoint_completions: stat.videoMidpointCompletions || 0,
                video_third_quartile_completions: stat.videoThirdQuartileCompletions || 0,
              }, { onConflict: 'campaign_id,creative_id,date' });
          }
        }
        campaignsUpdated++;
      }

      // 7. Mark success log
      await supabaseClient
        .from('ingestion_log')
        .update({ status: 'success', finished_at: new Date().toISOString(), campaigns_updated: campaignsUpdated })
        .eq('id', logId);

      return new Response(JSON.stringify({
        success: true,
        trigger: ingestionTrigger,
        campaigns_updated: campaignsUpdated,
        synced_date_range: {
          start: startDate.toISOString().slice(0, 10),
          end: endDate.toISOString().slice(0, 10),
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (innerError: unknown) {
      await supabaseClient
        .from('ingestion_log')
        .update({ status: 'failed', finished_at: new Date().toISOString(), error_message: getErrorMessage(innerError) })
        .eq('id', logId);
      throw innerError;
    }
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
