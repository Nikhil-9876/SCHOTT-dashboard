import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-functions-secret',
};

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

      const version = Deno.env.get('LINKEDIN_API_VERSION') || '202404';
      const apiHeaders = {
        'Authorization': `Bearer ${access_token}`,
        'LinkedIn-Version': version,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      };

      // 4. Resolve Ad Account(s)
      let adAccountId = Deno.env.get('LINKEDIN_AD_ACCOUNT_ID');
      if (!adAccountId) {
        // Auto-discover the first accessible Ad Account
        const accountsRes = await fetch('https://api.linkedin.com/rest/adAccounts?q=search', { headers: apiHeaders });
        if (!accountsRes.ok) throw new Error(`Failed to fetch Ad Accounts: ${await accountsRes.text()}`);
        const accountsData = await accountsRes.json();
        if (!accountsData.elements || accountsData.elements.length === 0) {
          await supabaseClient
            .from('ingestion_log')
            .update({ status: 'success', finished_at: new Date().toISOString(), campaigns_updated: 0 })
            .eq('id', logId);

          return new Response(JSON.stringify({ success: true, campaigns_updated: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        adAccountId = accountsData.elements[0].id;
      }

      const accountUrn = `urn:li:sponsoredAccount:${adAccountId}`;

      // 5. Fetch Campaigns for the Ad Account
      const campaignsUrl = `https://api.linkedin.com/rest/adCampaigns?q=search&search=(account:(values:List(${accountUrn})))`;
      const campaignsRes = await fetch(campaignsUrl, { headers: apiHeaders });
      if (!campaignsRes.ok) throw new Error(`Failed to fetch campaigns: ${await campaignsRes.text()}`);
      const campaignsData = await campaignsRes.json();

      let campaignsUpdated = 0;

      for (const rawCamp of (campaignsData.elements || [])) {
        // Map LinkedIn statuses to DB constraint: 'ACTIVE' | 'COMPLETED' | 'PAUSED'
        let mappedStatus: 'ACTIVE' | 'COMPLETED' | 'PAUSED' = 'PAUSED';
        if (rawCamp.status === 'ACTIVE') mappedStatus = 'ACTIVE';
        if (rawCamp.status === 'COMPLETED') mappedStatus = 'COMPLETED';

        // Categorize campaigns into funnel stages (TOFU / MOFU / BOFU) using custom rules
        let funnelStage: 'TOFU' | 'MOFU' | 'BOFU' = 'TOFU';
        const nameLower = rawCamp.name.toLowerCase();
        if (nameLower.includes('mofu') || nameLower.includes('consideration') || nameLower.includes('traffic')) {
          funnelStage = 'MOFU';
        } else if (nameLower.includes('bofu') || nameLower.includes('conversion') || nameLower.includes('lead')) {
          funnelStage = 'BOFU';
        }

        // Upsert Campaign details in campaigns table
        const { data: dbCampaign, error: upsertErr } = await supabaseClient
          .from('campaigns')
          .upsert({
            linkedin_id: rawCamp.id,
            name: rawCamp.name,
            status: mappedStatus,
            funnel_stage: funnelStage,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'linkedin_id' })
          .select('id')
          .single();

        if (upsertErr || !dbCampaign) continue;

        // 6. Fetch Daily Analytics metrics for this campaign (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const dateRangeQuery = `(start:(day:${thirtyDaysAgo.getDate()},month:${thirtyDaysAgo.getMonth() + 1},year:${thirtyDaysAgo.getFullYear()}),end:(day:${new Date().getDate()},month:${new Date().getMonth() + 1},year:${new Date().getFullYear()}))`;
        const campaignUrn = rawCamp.id.startsWith('urn:li:') ? rawCamp.id : `urn:li:sponsoredCampaign:${rawCamp.id}`;
        const analyticsUrl = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&dateRange=${dateRangeQuery}&timeGranularity=DAILY&campaigns=List(${campaignUrn})`;

        const analyticsRes = await fetch(analyticsUrl, { headers: apiHeaders });
        if (analyticsRes.ok) {
          const analyticsData = await analyticsRes.json();
          
          for (const stat of (analyticsData.elements || [])) {
            const dateStart = `${stat.dateRange.start.year}-${String(stat.dateRange.start.month).padStart(2, '0')}-${String(stat.dateRange.start.day).padStart(2, '0')}`;
            const dateEnd = `${stat.dateRange.end.year}-${String(stat.dateRange.end.month).padStart(2, '0')}-${String(stat.dateRange.end.day).padStart(2, '0')}`;
            
            const impressions = stat.impressions || 0;
            const clicks = stat.clicks || 0;
            const spend = Number(stat.costInLocalCurrency) || 0;
            const leads = stat.conversions || 0;

            await supabaseClient
              .from('campaign_metrics')
              .upsert({
                campaign_id: dbCampaign.id,
                date_range_start: dateStart,
                date_range_end: dateEnd,
                impressions,
                clicks,
                spend_inr: spend,
                spend_eur: spend * 0.011, // Standard approximate Conversion Rate
                ctr: impressions > 0 ? (clicks / impressions) : 0,
                cpc_inr: clicks > 0 ? (spend / clicks) : 0,
                leads,
              }, { onConflict: 'campaign_id,date_range_start,date_range_end' });
          }
        }
        campaignsUpdated++;
      }

      // 7. Mark success log
      await supabaseClient
        .from('ingestion_log')
        .update({ status: 'success', finished_at: new Date().toISOString(), campaigns_updated: campaignsUpdated })
        .eq('id', logId);

      return new Response(JSON.stringify({ success: true, campaigns_updated: campaignsUpdated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (innerError: any) {
      await supabaseClient
        .from('ingestion_log')
        .update({ status: 'failed', finished_at: new Date().toISOString(), error_message: innerError.message })
        .eq('id', logId);
      throw innerError;
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
