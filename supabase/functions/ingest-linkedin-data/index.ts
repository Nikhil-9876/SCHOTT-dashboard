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

// ── Demographics sync cadence ─────────────────────────────────────────────────
// Demographics change slowly; syncing them every 7 days is sufficient.
// On daily quick syncs this saves 5 × N_campaigns LinkedIn API round-trips.
const DEMO_SYNC_INTERVAL_DAYS = 7;

async function getIngestionTrigger(req: Request) {
  try {
    const payload = await req.clone().json();
    return {
      trigger: payload?.trigger === 'manual' ? 'manual' : 'scheduled',
      isFullSync: Boolean(payload?.full),
      forceDemographics: Boolean(payload?.demographics),
      backfillDays: Number.isFinite(Number(payload?.backfill_days)) && Number(payload?.backfill_days) > 0
        ? Math.min(Math.floor(Number(payload.backfill_days)), 90) // LinkedIn reach limit: 90 days
        : null,
    };
  } catch {
    return { trigger: 'scheduled', isFullSync: false, forceDemographics: false, backfillDays: null };
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

function findLandingPageUrl(obj: unknown, depth = 0): string | null {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') {
    if (
      (obj.startsWith('http://') || obj.startsWith('https://')) &&
      !obj.includes('api.linkedin.com') &&
      !obj.includes('schema.org') &&
      !obj.includes('w3.org') &&
      !obj.includes('licdn.com')
    ) {
      return obj;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const val = (obj as Record<string, unknown>)[key];
      const found = findLandingPageUrl(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findImageUrl(obj: unknown, depth = 0): string | null {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') {
    if (
      obj.includes('licdn.com') ||
      (obj.startsWith('http') && (obj.includes('.jpg') || obj.includes('.png') || obj.includes('.jpeg') || obj.includes('.webp')))
    ) {
      return obj;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const val = (obj as Record<string, unknown>)[key];
      const found = findImageUrl(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function fetchCreatives(adAccountId: string, campaignUrn: string, headers: Record<string, string>) {
  const creatives: { id: string; name: string; status: string | null; reference: string | null; creative_url: string | null; direct_image_url: string | null }[] = [];
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
      const rawStatus = rawCreative.status ?? rawCreative.intendedStatus ?? null;
      const content = rawCreative.content as Record<string, unknown> | undefined;
      const singleImage = content?.singleImage as Record<string, unknown> | undefined;
      const videoContent = content?.video as Record<string, unknown> | undefined;

      let reference = String(
        rawCreative.reference ??
        content?.reference ??
        singleImage?.id ??
        videoContent?.id ??
        ''
      );

      if (!reference) {
        const urnMatch = JSON.stringify(rawCreative).match(/urn:li:(digitalmediaAsset|image|video|share|ugcPost):[A-Za-z0-9_-]+/);
        if (urnMatch) reference = urnMatch[0];
      }

      let creativeUrl: string | null = null;
      if (reference && (reference.startsWith('urn:li:ugcPost:') || reference.startsWith('urn:li:share:'))) {
        creativeUrl = `https://www.linkedin.com/feed/update/${reference}`;
      } else {
        const singleImageLink = (singleImage?.link as Record<string, unknown> | undefined)?.url as string | undefined;
        const landingUrl = (
          rawCreative.landingPageUrl ??
          content?.landingPageUrl ??
          singleImage?.landingPageUrl ??
          singleImageLink
        ) as string | undefined;

        creativeUrl = landingUrl ?? findLandingPageUrl(rawCreative);
      }

      const directImageUrl = findImageUrl(rawCreative);

      creatives.push({
        id: creativeId,
        name: getCreativeName(rawCreative, creativeId),
        status: rawStatus ? String(rawStatus) : null,
        reference: reference || null,
        creative_url: creativeUrl,
        direct_image_url: directImageUrl,
      });
    }
    pageToken = creativesData.metadata?.nextPageToken ?? null;
  } while (pageToken);

  return creatives;
}

// ── Fetch and permanently store ad creative thumbnail ────────────────────────
// Strategy A (ugcPost/share): scrape the LinkedIn public post page and extract
// the og:image URL, then re-host in Supabase Storage.
// Strategy B (digitalmediaAsset): call LinkedIn mediaAssets API with auth token
// to get a signed download URL, then re-host in Supabase Storage.
async function fetchCreativeThumbnail(
  reference: string,
  creativeId: string,
  supabaseClient: ReturnType<typeof createClient>,
  apiHeaders?: Record<string, string>,
): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const numericId = creativeId.replace(/^urn:li:\w+:/, '');

    // ── Strategy B: digitalmediaAsset — fetch via LinkedIn Images API ──────────
    if (reference.startsWith('urn:li:digitalmediaAsset:') && apiHeaders) {
      // LinkedIn requires transforming the URN: digitalmediaAsset → image
      const assetId = reference.replace('urn:li:digitalmediaAsset:', '');
      const imageUrn = `urn:li:image:${assetId}`;
      const encodedUrn = encodeURIComponent(imageUrn);
      const assetRes = await fetch(
        `https://api.linkedin.com/rest/images/${encodedUrn}?fields=downloadUrl,originalUrl`,
        { headers: apiHeaders },
      );
      if (assetRes.ok) {
        const assetData = await assetRes.json();
        // downloadUrl is a signed temporary URL — download it immediately
        const imageUrl: string | null =
          assetData?.downloadUrl ??
          assetData?.originalUrl ??
          null;
        if (imageUrl) {
          const imgRes = await fetch(imageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
          });
          if (imgRes.ok) {
            const bytes = await imgRes.arrayBuffer();
            const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
            const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';
            const finalFileName = `${numericId}.${ext}`;
            const { error: uploadError } = await supabaseClient.storage
              .from('ad-thumbnails')
              .upload(finalFileName, bytes, { contentType, upsert: true });
            if (!uploadError) {
              const publicUrl = `${supabaseUrl}/storage/v1/object/public/ad-thumbnails/${finalFileName}`;
              console.log(`[thumbnail] ✓ [image-api] Stored thumbnail for ${creativeId} → ${publicUrl}`);
              return publicUrl;
            }
            console.warn(`[thumbnail] Storage upload failed for ${creativeId}: ${uploadError.message}`);
          } else {
            console.warn(`[thumbnail] Failed to download image for ${creativeId}: ${imgRes.status}`);
          }
        } else {
          console.warn(`[thumbnail] No downloadUrl in Images API response for ${reference}:`, JSON.stringify(assetData));
        }
      } else {
        const errText = await assetRes.text();
        console.warn(`[thumbnail] Images API failed for ${imageUrn}: ${assetRes.status} — ${errText}`);
      }
      return null;
    }


    // ── Strategy A: ugcPost / share — scrape og:image from public post page ───
    const postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(reference)}`;
    const pageRes = await fetch(postUrl, {
      headers: {
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

    // Download image bytes from the CDN URL
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

    const { error: uploadError } = await supabaseClient.storage
      .from('ad-thumbnails')
      .upload(finalFileName, bytes, { contentType, upsert: true });

    if (uploadError) {
      console.warn(`[thumbnail] Storage upload failed for ${creativeId}: ${uploadError.message}`);
      return null;
    }

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

// ── OPTIMIZATION 2: Batch campaign analytics ─────────────────────────────────
// Fetches analytics for ALL campaign URNs in a single LinkedIn API call.
// Returns a Map<campaignUrn, analyticsElementsArray>.
async function fetchBatchCampaignAnalytics(
  campaignUrns: string[],
  dateRangeQuery: string,
  headers: Record<string, string>,
): Promise<Map<string, Record<string, unknown>[]>> {
  const result = new Map<string, Record<string, unknown>[]>();
  if (campaignUrns.length === 0) return result;

  const extendedFields = [...BASE_CAMPAIGN_ANALYTICS_FIELDS, ...LEAD_FORM_ANALYTICS_FIELDS];
  const campaignsList = campaignUrns.map(encodeURIComponent).join(',');

  const tryFetch = async (fields: string[]) => {
    const params = [
      'q=analytics',
      'pivot=CAMPAIGN',
      `dateRange=${dateRangeQuery}`,
      'timeGranularity=DAILY',
      `campaigns=List(${campaignsList})`,
      `fields=${fields.join(',')}`,
    ];
    const url = `https://api.linkedin.com/rest/adAnalytics?${params.join('&')}`;
    return fetch(url, { headers });
  };

  let res = await tryFetch(extendedFields);
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`Batch analytics (extended fields) failed: ${errText}. Retrying with base fields.`);
    res = await tryFetch(BASE_CAMPAIGN_ANALYTICS_FIELDS);
  }

  if (!res.ok) {
    console.warn(`Batch analytics failed entirely: ${await res.text()}`);
    return result;
  }

  const json = await res.json();
  for (const el of (json.elements ?? []) as Record<string, unknown>[]) {
    const pivotValues = el.pivotValues as string[] | undefined;
    const urn = pivotValues?.[0];
    if (!urn) continue;
    if (!result.has(urn)) result.set(urn, []);
    result.get(urn)!.push(el);
  }
  return result;
}

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

// ── OPTIMIZATION 2b: Batch creative analytics ────────────────────────────────
// Fetches analytics for ALL creative URNs in a single LinkedIn API call.
// LinkedIn supports up to 20 creatives per request via creatives=List(...).
// Returns a Map<creativeUrn, analyticsElementsArray>.
async function fetchBatchCreativeAnalytics(
  creativeUrns: string[],
  dateRangeQuery: string,
  headers: Record<string, string>,
): Promise<Map<string, Record<string, unknown>[]>> {
  const result = new Map<string, Record<string, unknown>[]>();
  if (creativeUrns.length === 0) return result;

  // LinkedIn limits List() params — batch in chunks of 20 to be safe
  const BATCH_SIZE = 20;
  const chunks: string[][] = [];
  for (let i = 0; i < creativeUrns.length; i += BATCH_SIZE) {
    chunks.push(creativeUrns.slice(i, i + BATCH_SIZE));
  }

  await Promise.all(chunks.map(async (chunk) => {
    const creativesList = chunk.map(encodeURIComponent).join(',');
    const params = [
      'q=analytics',
      'pivot=CREATIVE',
      `dateRange=${dateRangeQuery}`,
      'timeGranularity=DAILY',
      `creatives=List(${creativesList})`,
      `fields=${CREATIVE_ANALYTICS_FIELDS.join(',')}`,
    ];
    const url = `https://api.linkedin.com/rest/adAnalytics?${params.join('&')}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`Batch creative analytics failed: ${await res.text()}`);
      return;
    }
    const json = await res.json();
    for (const el of (json.elements ?? []) as Record<string, unknown>[]) {
      const pivotValues = el.pivotValues as string[] | undefined;
      const urn = pivotValues?.[0];
      if (!urn) continue;
      if (!result.has(urn)) result.set(urn, []);
      result.get(urn)!.push(el);
    }
  }));

  return result;
}

// ── Demographic pivot support ─────────────────────────────────────────────────

const DEMOGRAPHIC_PIVOT_FIELDS = [
  'dateRange',
  'pivotValues',
  'impressions',
  'clicks',
  'costInLocalCurrency',
];

type DemoPivot = 'MEMBER_JOB_FUNCTION' | 'MEMBER_SENIORITY' | 'MEMBER_INDUSTRY' | 'MEMBER_COUNTRY_V2' | 'MEMBER_COMPANY_SIZE';
type DemoType  = 'job_function' | 'seniority' | 'industry' | 'geo_country' | 'company_size';

const DEMO_PIVOT_MAP: Record<DemoPivot, DemoType> = {
  MEMBER_JOB_FUNCTION:  'job_function',
  MEMBER_SENIORITY:     'seniority',
  MEMBER_INDUSTRY:      'industry',
  MEMBER_COUNTRY_V2:    'geo_country',
  MEMBER_COMPANY_SIZE:  'company_size',
};

// LinkedIn URN → human-readable label maps
const JOB_FUNCTION_MAP: Record<string, string> = {
  '1':  'Accounting', '2': 'Administrative', '3': 'Arts & Design', '4': 'Business Dev.',
  '5':  'Community & Social Services', '6': 'Consulting', '7': 'Education',
  '8':  'Engineering', '9': 'Entrepreneurship', '10': 'Finance',
  '11': 'Healthcare Services', '12': 'Human Resources', '13': 'Information Technology',
  '14': 'Legal', '15': 'Management', '16': 'Manufacturing', '17': 'Marketing',
  '18': 'Media & Communications', '19': 'Military & Protective Services',
  '20': 'Operations', '21': 'Product Management', '22': 'Program & Project Mgmt.',
  '23': 'Purchasing', '24': 'Quality Assurance', '25': 'Real Estate',
  '26': 'Research & Science', '27': 'Sales', '28': 'Support',
};

const SENIORITY_MAP: Record<string, string> = {
  '1':  'Unpaid', '2': 'Training', '3': 'Entry', '4': 'Senior',
  '5':  'Manager', '6': 'Director', '7': 'VP', '8': 'CXO', '9': 'Partner', '10': 'Owner',
};

const INDUSTRY_MAP: Record<string, string> = {
  '1':   'Defense & Space', '3': 'Computer Hardware', '4': 'Computer Software',
  '5':   'Computer Networking', '6': 'Internet', '7': 'Semiconductors',
  '8':   'Telecommunications', '9': 'Law Practice', '10': 'Legal Services',
  '11':  'Management Consulting', '12': 'Biotechnology', '13': 'Medical Practice',
  '14':  'Hospital & Health Care', '15': 'Pharmaceuticals', '16': 'Veterinary',
  '17':  'Medical Devices', '18': 'Cosmetics', '19': 'Apparel & Fashion',
  '20':  'Sporting Goods', '21': 'Tobacco', '22': 'Supermarkets',
  '23':  'Food Production', '24': 'Consumer Electronics', '25': 'Consumer Goods',
  '26':  'Furniture', '27': 'Retail', '28': 'Entertainment', '29': 'Gambling & Casinos',
  '30':  'Leisure, Travel & Tourism', '31': 'Hospitality', '32': 'Restaurants',
  '33':  'Sports', '34': 'Food & Beverages', '35': 'Motion Pictures & Film',
  '36':  'Broadcast Media', '37': 'Museums & Institutions', '38': 'Fine Art',
  '39':  'Performing Arts', '40': 'Recreational Facilities & Services', '41': 'Arts & Crafts',
  '42':  'Financial Services', '43': 'Banking', '44': 'Insurance',
  '45':  'Real Estate', '46': 'Investment Banking', '47': 'Investment Management',
  '48':  'Accounting', '49': 'Construction', '50': 'Building Materials',
  '51':  'Architecture & Planning', '52': 'Civil Engineering', '53': 'Aviation & Aerospace',
  '54':  'Automotive', '55': 'Chemicals', '56': 'Machinery', '57': 'Mining & Metals',
  '58':  'Oil & Energy', '59': 'Utilities', '60': 'Shipbuilding', '61': 'Packaging & Containers',
  '62':  'Railroad Manufacture', '63': 'Renewables & Environment', '64': 'Glass, Ceramics & Concrete',
  '65':  'Textiles', '66': 'Warehousing', '67': 'Airlines/Aviation',
  '68':  'Maritime', '69': 'Information Services', '70': 'Market Research',
  '71':  'Public Relations & Communications', '72': 'Newspaper', '73': 'Publishing',
  '74':  'Printing', '75': 'Translation & Localization',
  '76':  'Computer Games', '77': 'Events Services', '78': 'Photography',
  '79':  'Human Resources', '80': 'Business Supplies & Equipment', '81': 'Mental Health Care',
  '82':  'Graphic Design', '83': 'Fundraising', '84': 'Import & Export',
  '85':  'Primary/Secondary Education', '86': 'Higher Education', '87': 'Education Management',
  '88':  'Research', '89': 'Military', '90': 'Legislative Office',
  '91':  'Judiciary', '92': 'International Affairs', '93': 'Government Administration',
  '94':  'Executive Office', '95': 'Law Enforcement', '96': 'Public Safety',
  '97':  'Public Policy', '98': 'Marketing & Advertising', '99': 'Newspapers',
  '100': 'Outsourcing/Offshoring', '101': 'E-Learning', '102': 'Writing & Editing',
  '103': 'Staffing & Recruiting', '104': 'Professional Training & Coaching',
  '105': 'Venture Capital & Private Equity', '106': 'Political Organization',
  '107': 'Translation & Localization', '108': 'Computer & Network Security',
  '109': 'Non-profit Organizations', '110': 'Fund-Raising', '111': 'Program Development',
  '112': 'Religious Institutions', '113': 'Civic & Social Organization',
  '114': 'Consumer Services', '115': 'Wholesale', '116': 'International Trade & Development',
  '117': 'Individual & Family Services', '118': 'Think Tanks',
  '119': 'Nanotechnology', '120': 'Wireless',
  '121': 'Alternative Dispute Resolution', '122': 'Security & Investigations',
  '123': 'Facilities Services', '124': 'Alternative Medicine', '125': 'Libraries',
  '126': 'Animation', '127': 'Design', '128': 'Online Media', '129': 'Farming',
  '130': 'Ranching', '131': 'Dairy', '132': 'Fishery', '133': 'Horticulture',
  '134': 'Forestry', '135': 'Music', '136': 'Logistics & Supply Chain',
  '137': 'Plastics', '138': 'Commercial Real Estate', '139': 'Capital Markets',
  '140': 'Luxury Goods & Jewelry', '141': 'Sporting Goods', '142': 'Furniture',
};

const COMPANY_SIZE_MAP: Record<string, string> = {
  'A': '1', 'B': '2–10', 'C': '11–50', 'D': '51–200',
  'E': '201–500', 'F': '501–1K', 'G': '1K–5K', 'H': '5K–10K', 'I': '10K+',
};

// LinkedIn numeric Geo ID → ISO-2 country code.
// Source: LinkedIn's public geo taxonomy (top 80+ countries by ad volume).
const LINKEDIN_GEO_TO_ISO2: Record<string, string> = {
  '103644278': 'DE', // Germany
  '103883259': 'US', // United States
  '102713980': 'IN', // India
  '105015875': 'FR', // France
  '101165590': 'GB', // United Kingdom
  '102890719': 'NL', // Netherlands
  '101355337': 'JP', // Japan
  '106693272': 'CH', // Switzerland
  '103350119': 'IT', // Italy
  '105117694': 'SE', // Sweden
  '105646813': 'ES', // Spain
  '101452733': 'AU', // Australia
  '101174742': 'CA', // Canada
  '106057199': 'BR', // Brazil
  '102890883': 'CN', // China
  '103366673': 'SG', // Singapore
  '106072129': 'AE', // UAE
  '103251145': 'AT', // Austria
  '100565514': 'BE', // Belgium
  '104514075': 'DK', // Denmark
  '100456013': 'FI', // Finland
  '103819153': 'NO', // Norway
  '105072130': 'PL', // Poland
  '100364837': 'PT', // Portugal
  '104508036': 'CZ', // Czech Republic
  '105149290': 'KR', // South Korea
  '103291313': 'HK', // Hong Kong
  '104621616': 'MX', // Mexico
  '104035573': 'ZA', // South Africa
  '101620260': 'IL', // Israel
  '102869996': 'TR', // Turkey
  '101728296': 'RU', // Russia
  '104738515': 'IE', // Ireland
  '100288476': 'HU', // Hungary
  '106622260': 'RO', // Romania
  '105490917': 'PH', // Philippines
  '104514572': 'MY', // Malaysia
  '100652038': 'TH', // Thailand
  '102454443': 'ID', // Indonesia
  '104614838': 'AR', // Argentina
  '104350098': 'CL', // Chile
  '100867946': 'CO', // Colombia
  '103702635': 'EG', // Egypt
  '105072282': 'NG', // Nigeria
  '103323778': 'KE', // Kenya
  '101736903': 'SA', // Saudi Arabia
  '102304179': 'NZ', // New Zealand
  '101282718': 'UA', // Ukraine
  '103744681': 'GR', // Greece
  '105484231': 'SK', // Slovakia
  '103097513': 'HR', // Croatia
  '101168310': 'BG', // Bulgaria
  '101768798': 'RS', // Serbia
  '103440316': 'LT', // Lithuania
  '102974008': 'PK', // Pakistan
  '106448360': 'BD', // Bangladesh
  '100878084': 'VN', // Vietnam
  '100731978': 'QA', // Qatar
  '103116394': 'KW', // Kuwait
  '102376995': 'BH', // Bahrain
  '104667569': 'TW', // Taiwan
};

function resolveUrnLabel(pivotType: DemoPivot, rawUrn: string): string {
  // Extract the ID from the URN: e.g. 'urn:li:function:8' → '8'
  const id = rawUrn.split(':').pop() ?? rawUrn;
  switch (pivotType) {
    case 'MEMBER_JOB_FUNCTION':  return JOB_FUNCTION_MAP[id]  ?? `Function ${id}`;
    case 'MEMBER_SENIORITY':     return SENIORITY_MAP[id]      ?? `Seniority ${id}`;
    case 'MEMBER_INDUSTRY':      return INDUSTRY_MAP[id]       ?? `Industry ${id}`;
    case 'MEMBER_COMPANY_SIZE':  return COMPANY_SIZE_MAP[id]   ?? id;
    case 'MEMBER_COUNTRY_V2': {
      // LinkedIn returns numeric geo IDs (e.g. 103644278) OR alpha-2 codes (e.g. DE).
      // Check the numeric map first; if not found and it looks like an ISO-2 code, use it directly.
      const fromMap = LINKEDIN_GEO_TO_ISO2[id];
      if (fromMap) return fromMap;                  // e.g. '103644278' → 'DE'
      if (/^[A-Za-z]{2}$/.test(id)) return id.toUpperCase(); // fallback: already ISO-2
      return `GEO:${id}`;                           // unknown — store raw so it's visible
    }
    default: return id;
  }
}

function buildDemoPivotUrl(pivot: DemoPivot, campaignUrn: string, dateRangeQuery: string) {
  const params = [
    'q=analytics',
    `pivot=${pivot}`,
    `dateRange=${dateRangeQuery}`,
    'timeGranularity=ALL',
    `campaigns=List(${encodeURIComponent(campaignUrn)})`,
    `fields=${DEMOGRAPHIC_PIVOT_FIELDS.join(',')}`,
  ];
  return `https://api.linkedin.com/rest/adAnalytics?${params.join('&')}`;
}


// ── Fetch video duration from LinkedIn Media Assets API ─────────────────────
// LinkedIn video creatives reference a ugcPost (or share) URN, not a
// digitalmediaAsset URN directly. We resolve: reference → post → mediaAsset → duration.
async function fetchVideoDuration(
  referenceUrn: string,
  headers: Record<string, string>,
): Promise<number | null> {
  try {
    let mediaAssetUrn: string | null = null;

    if (referenceUrn.startsWith('urn:li:ugcPost:') || referenceUrn.startsWith('urn:li:share:')) {
      const postId = encodeURIComponent(referenceUrn);
      const postRes = await fetch(`https://api.linkedin.com/rest/posts/${postId}`, { headers });
      if (postRes.ok) {
        const postData = await postRes.json();
        // Path for video posts: content -> media -> id (asset URN)
        const mediaId = postData?.content?.media?.id;
        if (typeof mediaId === 'string' && mediaId.startsWith('urn:li:digitalmediaAsset:')) {
          mediaAssetUrn = mediaId;
        }
      } else {
        console.warn(`[video-duration] Failed to fetch post ${referenceUrn} (possibly missing r_organization_social scope): HTTP ${postRes.status}`);
      }
    } else if (referenceUrn.startsWith('urn:li:digitalmediaAsset:')) {
      // Direct asset reference (less common)
      mediaAssetUrn = referenceUrn;
    }

    if (!mediaAssetUrn) return null;

    // Step 2: Fetch the media asset to get duration
    const encodedAsset = encodeURIComponent(mediaAssetUrn);
    const assetRes = await fetch(`https://api.linkedin.com/rest/mediaAssets/${encodedAsset}`, { headers });
    if (!assetRes.ok) {
      console.warn(`[video-duration] Failed to fetch asset ${mediaAssetUrn}: HTTP ${assetRes.status}`);
      return null;
    }
    const assetData = await assetRes.json();
    const durationMs = assetData?.mediaProcessorAttributes?.videoProcessorAttribute?.duration;
    if (typeof durationMs === 'number' && durationMs > 0) {
      return durationMs / 1000;
    }
    return null;
  } catch (err) {
    console.warn(`[video-duration] Unexpected error for ${referenceUrn}:`, err);
    return null;
  }
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
// Runs `tasks` with at most `concurrency` running at the same time.
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++;
      results[taskIndex] = await tasks[taskIndex]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchAndStoreDemographics(
  campaignUrn: string,
  campaignDbId: string,
  dateRangeQuery: string,
  headers: Record<string, string>,
  supabaseClient: ReturnType<typeof createClient>,
): Promise<void> {
  const pivots: DemoPivot[] = [
    'MEMBER_JOB_FUNCTION',
    'MEMBER_SENIORITY',
    'MEMBER_INDUSTRY',
    'MEMBER_COUNTRY_V2',
    'MEMBER_COMPANY_SIZE',
  ];

  // Fetch all 5 demographic pivots concurrently instead of sequentially.
  await Promise.all(pivots.map(async (pivot) => {
    try {
      const res = await fetch(buildDemoPivotUrl(pivot, campaignUrn, dateRangeQuery), { headers });
      if (!res.ok) {
        console.warn(`[demo] ${pivot} fetch failed for ${campaignUrn}: ${await res.text()}`);
        return;
      }

      const json = await res.json();
      const demoType = DEMO_PIVOT_MAP[pivot];

      const rows = (json.elements ?? []).map((el: Record<string, unknown>) => {
        const pivotValues = (el.pivotValues as string[] | undefined) ?? [];
        const rawUrn = pivotValues[0] ?? 'unknown';
        const label = resolveUrnLabel(pivot, rawUrn);

        // dateRange may be missing when timeGranularity=ALL; default to today
        const dr = el.dateRange as Record<string, Record<string, number>> | undefined;
        const dateStr = dr?.start
          ? `${dr.start.year}-${String(dr.start.month).padStart(2, '0')}-${String(dr.start.day).padStart(2, '0')}`
          : new Date().toISOString().slice(0, 10);

        return {
          campaign_id:       campaignDbId,
          date:              dateStr,
          demographic_type:  demoType,
          demographic_value: label,
          impressions:       Number(el.impressions ?? 0) || 0,
          clicks:            Number(el.clicks ?? 0) || 0,
          spend_eur:         Number(el.costInLocalCurrency ?? 0) || 0,
        };
      }).filter((r: { impressions: number }) => r.impressions > 0 || r.clicks > 0);

      if (rows.length > 0) {
        const { error } = await supabaseClient
          .from('demographic_metrics')
          .upsert(rows, { onConflict: 'campaign_id,date,demographic_type,demographic_value' });
        if (error) {
          console.warn(`[demo] upsert failed for ${pivot}: ${error.message}`);
        } else {
          console.log(`[demo] ✓ ${pivot}: ${rows.length} rows stored for ${campaignUrn}`);
        }
      }
    } catch (err) {
      console.warn(`[demo] Unexpected error for ${pivot}:`, err);
    }
  }));
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
    const { trigger: ingestionTrigger, isFullSync, forceDemographics, backfillDays } = await getIngestionTrigger(req);
    const isManualSync = ingestionTrigger === 'manual';
    const isBackfill = backfillDays !== null;

    const { data: lastSuccessLog, error: lastSuccessError } = await supabaseClient
      .from('ingestion_log')
      .select('started_at, finished_at, refreshed_campaigns')
      .eq('status', 'success')
      .order('finished_at', { ascending: false, nullsFirst: false })
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSuccessError) throw new Error(`Failed to read sync log: ${lastSuccessError.message}`);

    const lastSuccessfulSyncAt = isFullSync ? null : getLastSyncTimestamp(lastSuccessLog);
    if (!isManualSync && !isBackfill && lastSuccessfulSyncAt && now.getTime() - lastSuccessfulSyncAt.getTime() < MIN_SYNC_INTERVAL_MS) {
      const nextSyncAt = new Date(lastSuccessfulSyncAt.getTime() + MIN_SYNC_INTERVAL_MS);
      return new Response(JSON.stringify({
        error: `Last sync should be 24 hours apart. Please try again after ${nextSyncAt.toISOString()}.`,
        next_sync_at: nextSyncAt.toISOString(),
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── OPTIMIZATION 1: Decide whether to sync demographics ──────────────────
    // Skip demographics on daily quick syncs; only refresh weekly or when forced.
    const { data: lastDemoLog } = await supabaseClient
      .from('ingestion_log')
      .select('finished_at')
      .eq('status', 'success')
      .eq('synced_demographics', true)
      .order('finished_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const lastDemoSyncAt = lastDemoLog?.finished_at ? new Date(lastDemoLog.finished_at) : null;
    const daysSinceLastDemoSync = lastDemoSyncAt
      ? (now.getTime() - lastDemoSyncAt.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    const shouldSyncDemographics = forceDemographics || isFullSync || daysSinceLastDemoSync >= DEMO_SYNC_INTERVAL_DAYS;

    // If backfill_days is provided, override the date range to that window.
    // This is the recovery path for lost metrics (e.g. reach data).
    const analyticsLookbackDays = getAnalyticsLookbackDays();
    const { startDate, endDate } = isBackfill
      ? { startDate: addUtcDays(startOfUtcDay(now), -backfillDays!), endDate: startOfUtcDay(now) }
      : getSyncDateRange(isFullSync ? null : lastSuccessfulSyncAt, now, analyticsLookbackDays);
    const dateRangeQuery = buildDateRangeQuery(startDate, endDate);
    console.log(`[sync] date range: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}${isBackfill ? ` (backfill ${backfillDays}d)` : ''}`);


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

      // 5. Fetch Campaigns — from DB cache on quick syncs, from LinkedIn on full/weekly syncs.
      //    The campaign list rarely changes. Fetching it from LinkedIn takes ~16s due to API
      //    latency over a large account. Re-fetching from LinkedIn on full syncs or once per week
      //    (Sunday 23:30 UTC = Monday 5:00am IST via pg_cron) keeps the list fresh.
      const CAMPAIGN_LIST_CACHE_DAYS = 7;

      // Use the timestamp of the last sync that actually fetched campaigns from LinkedIn.
      // This is tracked via the refreshed_campaigns column — independent of daily sync cadence.
      const { data: lastCampaignRefreshLog } = await supabaseClient
        .from('ingestion_log')
        .select('finished_at')
        .eq('status', 'success')
        .eq('refreshed_campaigns', true)
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      const lastCampaignRefreshAt = lastCampaignRefreshLog?.finished_at
        ? new Date(lastCampaignRefreshLog.finished_at)
        : null;
      const daysSinceLastCampaignRefresh = lastCampaignRefreshAt
        ? (now.getTime() - lastCampaignRefreshAt.getTime()) / (1000 * 60 * 60 * 24)
        : 0; // null means "no tracking history yet" → default to using DB cache

      // Refresh from LinkedIn only on explicit full syncs or when 7-day clock expires.
      // If no history exists (lastCampaignRefreshAt = null), use DB campaigns — this
      // handles legacy rows before the refreshed_campaigns column was added.
      const shouldRefreshCampaigns = isFullSync
        || (lastCampaignRefreshAt !== null && daysSinceLastCampaignRefresh >= CAMPAIGN_LIST_CACHE_DAYS);


      const tCampaignsFetch = Date.now();
      let campaignsFetchPages = 0;
      let campaigns: { id: string | number; name?: string; status?: string }[] = [];

      if (!shouldRefreshCampaigns) {
        // Quick sync: read campaigns from DB (already filtered from last full fetch)
        const { data: dbCamps } = await supabaseClient
          .from('campaigns')
          .select('linkedin_id, name, status')
          .eq('ad_account_id', adAccountId);
        campaigns = (dbCamps ?? []).map((c) => ({ id: c.linkedin_id, name: c.name, status: c.status }));
        console.log(`[timing] campaigns from DB cache: ${Date.now() - tCampaignsFetch}ms (${campaigns.length} campaigns)`);
      } else {
        // Full or weekly sync: fetch from LinkedIn API (may take 10-20s for large accounts)
        let pageToken: string | null = null;
        do {
          const campaignsRes = await fetch(buildCampaignsUrl(adAccountId, pageToken), { headers: apiHeaders });
          if (!campaignsRes.ok) throw new Error(`Failed to fetch campaigns: ${await campaignsRes.text()}`);
          const campaignsData = await campaignsRes.json();
          campaigns.push(...(campaignsData.elements || []));
          pageToken = campaignsData.metadata?.nextPageToken ?? null;
          campaignsFetchPages++;
        } while (pageToken);
        console.log(`[timing] campaigns from LinkedIn: ${Date.now() - tCampaignsFetch}ms (${campaignsFetchPages} page(s), ${campaigns.length} total)`);
        // Mark this sync as a campaign refresh so the weekly cadence tracks correctly
        await supabaseClient.from('ingestion_log').update({ refreshed_campaigns: true }).eq('id', logId);
      }
      const timing_campaigns_ms = Date.now() - tCampaignsFetch;

      const campaignNameExcludes = getCampaignNameExcludes();


      // ── Naming convention enforcement ────────────────────────────────────────
      // Accepted campaigns MUST follow the convention: YYYY/MM/DD_REGION_FunnelStage_...,
      // Campaigns that do not start with YYYY/MM/DD_ are rejected outright.
      // The date prefix is also used for the 2026-07-01 start-date cutoff.
      const CAMPAIGN_START_CUTOFF = new Date('2026-07-01T00:00:00Z').getTime();
      const NAMING_CONVENTION_RE = /^(\d{4})\/(\d{2})\/(\d{2})_/;

      const filteredCampaigns = campaigns.filter((rawCamp) => {
        const campaignId = String(rawCamp.id);
        const campaignName = String(rawCamp.name ?? `LinkedIn campaign ${campaignId}`);
        const campaignNameLower = campaignName.toLowerCase();

        // 1. Name include filter (LINKEDIN_CAMPAIGN_NAME_INCLUDES env variable)
        if (!campaignMatchesNameFilter(campaignName, campaignNameIncludes)) return false;

        // 2. Explicit blocklist (LINKEDIN_CAMPAIGN_NAME_EXCLUDES env variable)
        if (campaignNameExcludes.some((term) => campaignNameLower.includes(term))) {
          console.log(`Skipping "${campaignName}" — matched explicit exclude list`);
          return false;
        }

        // 3. Naming convention gate — must start with YYYY/MM/DD_
        const conventionMatch = campaignName.match(NAMING_CONVENTION_RE);
        if (!conventionMatch) {
          console.log(`Skipping "${campaignName}" — does not follow naming convention (expected YYYY/MM/DD_...)`);
          return false;
        }

        // 4. Start date cutoff — prefer LinkedIn API runSchedule.start, fall back to name prefix
        const runScheduleStart: number | undefined = (rawCamp as any).runSchedule?.start;
        let campaignStartMs: number;
        if (typeof runScheduleStart === 'number' && runScheduleStart > 0) {
          campaignStartMs = runScheduleStart;
        } else {
          // Parse precisely from the YYYY/MM/DD_ prefix already captured by conventionMatch
          campaignStartMs = new Date(
            `${conventionMatch[1]}-${conventionMatch[2]}-${conventionMatch[3]}T00:00:00Z`
          ).getTime();
        }

        if (campaignStartMs < CAMPAIGN_START_CUTOFF) {
          console.log(`Skipping "${campaignName}" — start date ${new Date(campaignStartMs).toISOString().slice(0, 10)} is before 2026-07-01 cutoff`);
          return false;
        }

        return true;
      });

      // Delete campaigns that belong to a different ad account (stale from config change)
      await supabaseClient
        .from('campaigns')
        .delete()
        .or(`ad_account_id.is.null,ad_account_id.neq.${adAccountId}`);

      // Delete campaigns that are in the DB for this ad account but did NOT pass the
      // current filters (name include/exclude + date cutoff). This purges previously-synced
      // campaigns that no longer belong in the dashboard.
      const filteredLinkedInIds = filteredCampaigns.map((c) => String(c.id));
      if (filteredLinkedInIds.length > 0) {
        await supabaseClient
          .from('campaigns')
          .delete()
          .eq('ad_account_id', adAccountId)
          .not('linkedin_id', 'in', `(${filteredLinkedInIds.join(',')})`);
      } else {
        // No campaigns passed the filter — delete everything for this account
        await supabaseClient
          .from('campaigns')
          .delete()
          .eq('ad_account_id', adAccountId);
      }

      let campaignsUpdated = 0;

      // ── GLOBAL PARALLEL PHASE ────────────────────────────────────────────────
      // Fire ALL top-level LinkedIn API calls simultaneously before any per-campaign
      // work begins. This collapses the sequential chain into a single parallel wave:
      //   (a) Batch campaign analytics  — 1 LinkedIn call
      //   (b) fetchCreatives ×N         — N LinkedIn calls (one per campaign, all parallel)
      //   (c) Creative cache DB query   — 1 Supabase call
      // All run concurrently; total time = max(a, b, c) instead of a + b + c.
      const tGlobal = Date.now();
      const filteredCampaignUrns = filteredCampaigns.map((c) => toLinkedInUrn(String(c.id), 'sponsoredCampaign'));

      const [batchAnalyticsMap, allCampaignCreatives, existingCreativeRows] = await Promise.all([
        fetchBatchCampaignAnalytics(filteredCampaignUrns, dateRangeQuery, apiHeaders),
        // Fetch creatives for ALL campaigns in parallel
        Promise.all(filteredCampaigns.map((rawCamp) =>
          fetchCreatives(adAccountId, toLinkedInUrn(String(rawCamp.id), 'sponsoredCampaign'), apiHeaders)
        )),
        supabaseClient
          .from('ad_performance_metrics')
          .select('creative_id, thumbnail_url, creative_url, reference')
          .not('creative_url', 'is', null)
          .then((r) => r.data),
      ]);
      console.log(`[timing] global parallel phase: ${Date.now() - tGlobal}ms`);
      const timing_phase1_ms = Date.now() - tGlobal;

      // Build per-campaign creatives map for use in campaign tasks
      const campaignCreativesMap = new Map<string, typeof allCampaignCreatives[0]>(
        filteredCampaigns.map((rawCamp, i) => [String(rawCamp.id), allCampaignCreatives[i]])
      );

      // Now fire ALL batch creative analytics calls in parallel (one per campaign)
      const tCreativeAnalytics = Date.now();
      const creativeAnalyticsByLinkedInId = new Map<string, Map<string, Record<string, unknown>[]>>();
      await Promise.all(filteredCampaigns.map(async (rawCamp) => {
        const campaignId = String(rawCamp.id);
        const creatives = campaignCreativesMap.get(campaignId) ?? [];
        const creativeUrns = creatives.map((c) => toLinkedInUrn(c.id, 'sponsoredCreative'));
        const analyticsMap = await fetchBatchCreativeAnalytics(creativeUrns, dateRangeQuery, apiHeaders);
        creativeAnalyticsByLinkedInId.set(campaignId, analyticsMap);
      }));
      console.log(`[timing] all creative analytics batch: ${Date.now() - tCreativeAnalytics}ms`);
      const timing_phase2_ms = Date.now() - tCreativeAnalytics;

      const knownCreativeCache = new Map<string, { thumbnail_url: string | null; creative_url: string; reference: string | null }>();
      for (const row of (existingCreativeRows ?? [])) {
        if (!knownCreativeCache.has(row.creative_id)) {
          knownCreativeCache.set(row.creative_id, {
            thumbnail_url: row.thumbnail_url,
            creative_url: row.creative_url,
            reference: row.reference,
          });
        }
      }

      // Thumbnail-only cache for creatives with known thumbnails
      const thumbCache = new Map<string, string>(
        [...knownCreativeCache.entries()]
          .filter(([, v]) => v.thumbnail_url)
          .map(([id, v]) => [id, v.thumbnail_url!])
      );

      // Process each campaign: DB upserts + thumbnail fetches for new creatives only.
      // All LinkedIn API calls already completed above.
      const CAMPAIGN_CONCURRENCY = 6;


      const campaignTasks = filteredCampaigns.map((rawCamp) => async () => {
        const campaignId = String(rawCamp.id);
        const campaignName = String(rawCamp.name ?? `LinkedIn campaign ${campaignId}`);
        const campaignUrn = toLinkedInUrn(campaignId, 'sponsoredCampaign');

        const isVideoCampaign = campaignName.toLowerCase().includes('_vv_') || campaignName.toLowerCase().includes('video');

        // All LinkedIn API data already fetched above — just read from pre-built maps
        const creatives = campaignCreativesMap.get(campaignId) ?? [];
        const adCount = creatives.length;
        const batchCreativeAnalyticsMap = creativeAnalyticsByLinkedInId.get(campaignId) ?? new Map();

        // Cache of assetUrn → video duration in seconds (fetched once per creative, reused across daily rows)
        const videoDurationCache = new Map<string, number | null>();


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

        if (upsertErr || !dbCampaign) return false;

        // 6. Store campaign-level daily analytics metrics (from batched response).
        const campaignElements = batchAnalyticsMap.get(campaignUrn) ?? [];
        const campaignMetricRows = campaignElements.map((stat) => {
          const dr = stat.dateRange as Record<string, Record<string, number>>;
          const dateStart = `${dr.start.year}-${String(dr.start.month).padStart(2, '0')}-${String(dr.start.day).padStart(2, '0')}`;
          const dateEnd = `${dr.end.year}-${String(dr.end.month).padStart(2, '0')}-${String(dr.end.day).padStart(2, '0')}`;
          const impressions = Number(stat.impressions) || 0;
          const clicks = Number(stat.clicks) || 0;
          const spend = Number(stat.costInLocalCurrency) || 0;
          const reach = getReach(stat);
          const leads = getLeadCount(stat);
          const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
          const cpc = clicks > 0 ? spend / clicks : 0;
          const cpl = leads > 0 ? spend / leads : 0;
          return {
            campaign_id: dbCampaign.id,
            date_range_start: dateStart,
            date_range_end: dateEnd,
            impressions,
            reach,
            clicks,
            spend_inr: spend,
            spend_eur: spend,
            engagement_rate: impressions > 0 ? clicks / impressions : 0,
            ctr: impressions > 0 ? clicks / impressions : 0,
            cpm_inr: cpm,
            cpc_inr: cpc,
            cpl_inr: cpl,
            leads,
          };
        });
        if (campaignMetricRows.length > 0) {
          await supabaseClient
            .from('campaign_metrics')
            .upsert(campaignMetricRows, { onConflict: 'campaign_id,date_range_start,date_range_end' });
        }

        // 7. Fetch & store creative-level analytics and thumbnails in parallel.
        //    Creative analytics already batched above; consume from map per creative.
        await Promise.all(creatives.map(async (creative) => {
          const creativeUrn = toLinkedInUrn(creative.id, 'sponsoredCreative');
          const effectiveCreativeStatus = creative.status ?? mappedStatus;

          // OPTIMIZATION 3: Skip thumbnail fetch for known creatives
          const knownMeta = knownCreativeCache.get(creative.id);
          const resolvedCreativeUrl = creative.creative_url ?? knownMeta?.creative_url ?? null;
          const resolvedReference = creative.reference ?? knownMeta?.reference ?? null;

          let thumbnailPromise: Promise<string | null>;
          if (thumbCache.has(creative.id)) {
            thumbnailPromise = Promise.resolve(thumbCache.get(creative.id)!);
          } else if (creative.direct_image_url) {
            thumbnailPromise = Promise.resolve(creative.direct_image_url);
          } else if (resolvedReference) {
            thumbnailPromise = fetchCreativeThumbnail(resolvedReference, creative.id, supabaseClient, apiHeaders).then((url) => {
              if (url) thumbCache.set(creative.id, url);
              return url;
            });
          } else {
            thumbnailPromise = Promise.resolve(null);
          }

          // Video duration: only fetch for video campaigns — skipping for WV/document/image ads
          // avoids 1-2 wasted LinkedIn API calls per non-video creative.
          let videoDurationSeconds: number | null = null;
          const assetUrn = resolvedReference;
          let videoDurationPromise: Promise<number | null> = Promise.resolve(null);
          if (isVideoCampaign && assetUrn) {
            if (videoDurationCache.has(assetUrn)) {
              videoDurationSeconds = videoDurationCache.get(assetUrn) ?? null;
            } else {
              videoDurationPromise = fetchVideoDuration(assetUrn, apiHeaders).then((d) => {
                videoDurationCache.set(assetUrn, d);
                if (d !== null) console.log(`[video-duration] ✓ ${assetUrn} → ${d}s`);
                return d;
              });
            }
          }

          const [thumbnailUrl, resolvedVideoDuration] = await Promise.all([
            thumbnailPromise,
            videoDurationPromise,
          ]);
          if (assetUrn && !videoDurationCache.has(assetUrn)) {
            videoDurationSeconds = resolvedVideoDuration;
          } else if (assetUrn) {
            videoDurationSeconds = videoDurationCache.get(assetUrn) ?? null;
          }

          // Consume creative analytics from the batch map (no extra HTTP call needed)
          const creativeElements = batchCreativeAnalyticsMap.get(creativeUrn) ?? [];
          const adPerfRows = creativeElements.map((stat: Record<string, unknown>) => {
            const dr = stat.dateRange as Record<string, Record<string, number>>;
            const date = `${dr.start.year}-${String(dr.start.month).padStart(2, '0')}-${String(dr.start.day).padStart(2, '0')}`;
            const impressions = Number(stat.impressions) || 0;
            const clicks = Number(stat.clicks) || 0;
            return {
              campaign_id: dbCampaign.id,
              creative_id: creative.id,
              creative_name: creative.name,
              status: effectiveCreativeStatus,
              date,
              spend_eur: Number(stat.costInLocalCurrency) || 0,
              impressions,
              reach: getReach(stat),
              clicks,
              ctr: impressions > 0 ? clicks / impressions : 0,
              engagements: Number(stat.totalEngagements) || clicks,
              landing_page_clicks: Number(stat.landingPageClicks) || 0,
              reference: resolvedReference,
              creative_url: resolvedCreativeUrl,
              thumbnail_url: thumbnailUrl,
              video_views: Number(stat.videoViews) || 0,
              video_completions: Number(stat.videoCompletions) || 0,
              video_starts: Number(stat.videoStarts) || 0,
              video_first_quartile_completions: Number(stat.videoFirstQuartileCompletions) || 0,
              video_midpoint_completions: Number(stat.videoMidpointCompletions) || 0,
              video_third_quartile_completions: Number(stat.videoThirdQuartileCompletions) || 0,
              video_duration_seconds: videoDurationSeconds,
            };
          });

          if (adPerfRows.length > 0) {
            await supabaseClient
              .from('ad_performance_metrics')
              .upsert(adPerfRows, { onConflict: 'campaign_id,creative_id,date' });
          }
        }));

        // 8. OPTIMIZATION 1: Demographics — only sync on weekly cadence or when forced.
        if (shouldSyncDemographics) {
          await fetchAndStoreDemographics(campaignUrn, dbCampaign.id, dateRangeQuery, apiHeaders, supabaseClient);
        }

        return true;
      });

      const campaignResults = await runWithConcurrency(campaignTasks, CAMPAIGN_CONCURRENCY);
      campaignsUpdated = campaignResults.filter(Boolean).length;

      // 7. Mark success log (record whether demographics were synced this run)
      await supabaseClient
        .from('ingestion_log')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          campaigns_updated: campaignsUpdated,
          synced_demographics: shouldSyncDemographics,
        })
        .eq('id', logId);

      return new Response(JSON.stringify({
        success: true,
        trigger: ingestionTrigger,
        campaigns_updated: campaignsUpdated,
        synced_demographics: shouldSyncDemographics,
        timing_ms: {
          campaigns_fetch: timing_campaigns_ms,
          phase1_global_parallel: timing_phase1_ms,
          phase2_creative_analytics: timing_phase2_ms,
          total: Date.now() - (now.getTime()),
        },
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
