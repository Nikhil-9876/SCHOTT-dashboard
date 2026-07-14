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

  // Keep a one-day overlap because LinkedIn reporting settles daily and prior-day
  // metrics can change after the previous sync ran.
  return {
    startDate: startOfUtcDay(lastSuccessfulSyncAt),
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
  const creatives: { id: string; name: string; status: string | null }[] = [];
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
      creatives.push({
        id: creativeId,
        name: getCreativeName(rawCreative, creativeId),
        status: rawCreative.status ? String(rawCreative.status) : null,
      });
    }
    pageToken = creativesData.metadata?.nextPageToken ?? null;
  } while (pageToken);

  return creatives;
}

function buildAnalyticsUrl(campaignUrn: string, dateRangeQuery: string) {
  const fields = [
    'dateRange',
    'pivotValues',
    'impressions',
    'approximateMemberReach',
    'approximateUniqueImpressions',
    'clicks',
    'costInLocalCurrency',
    'externalWebsiteConversions',
  ];
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
  const fields = [
    'dateRange',
    'pivotValues',
    'impressions',
    'approximateMemberReach',
    'approximateUniqueImpressions',
    'clicks',
    'costInLocalCurrency',
    'totalEngagements',
    'landingPageClicks',
  ];
  const params = [
    'q=analytics',
    'pivot=CREATIVE',
    `dateRange=${dateRangeQuery}`,
    'timeGranularity=DAILY',
    `creatives=List(${encodeURIComponent(creativeUrn)})`,
    `fields=${fields.join(',')}`,
  ];

  return `https://api.linkedin.com/rest/adAnalytics?${params.join('&')}`;
}

function getReach(stat: Record<string, unknown>) {
  return Number(stat.approximateMemberReach ?? stat.approximateUniqueImpressions ?? 0) || 0;
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
    if (lastSuccessfulSyncAt && now.getTime() - lastSuccessfulSyncAt.getTime() < MIN_SYNC_INTERVAL_MS) {
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

      const filteredCampaigns = campaigns.filter((rawCamp) => {
        const campaignId = String(rawCamp.id);
        const campaignName = String(rawCamp.name ?? `LinkedIn campaign ${campaignId}`);
        return campaignMatchesNameFilter(campaignName, campaignNameIncludes);
      });

      await supabaseClient
        .from('campaigns')
        .delete()
        .or(`ad_account_id.is.null,ad_account_id.neq.${adAccountId}`);

      let campaignsUpdated = 0;

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
        const analyticsUrl = buildAnalyticsUrl(campaignUrn, dateRangeQuery);

        const analyticsRes = await fetch(analyticsUrl, { headers: apiHeaders });
        if (analyticsRes.ok) {
          const analyticsData = await analyticsRes.json();
          
          for (const stat of (analyticsData.elements || [])) {
            const dateStart = `${stat.dateRange.start.year}-${String(stat.dateRange.start.month).padStart(2, '0')}-${String(stat.dateRange.start.day).padStart(2, '0')}`;
            const dateEnd = `${stat.dateRange.end.year}-${String(stat.dateRange.end.month).padStart(2, '0')}-${String(stat.dateRange.end.day).padStart(2, '0')}`;
            
            const impressions = stat.impressions || 0;
            const reach = getReach(stat);
            const clicks = stat.clicks || 0;
            const spend = Number(stat.costInLocalCurrency) || 0;
            const leads = stat.externalWebsiteConversions || 0;
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
                status: creative.status,
                date,
                spend_eur: Number(stat.costInLocalCurrency) || 0,
                impressions,
                reach: getReach(stat),
                clicks,
                ctr: impressions > 0 ? (clicks / impressions) : 0,
                engagements: stat.totalEngagements || clicks,
                landing_page_clicks: stat.landingPageClicks || 0,
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
