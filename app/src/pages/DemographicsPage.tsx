import { useState, useMemo } from 'react';
import Plot from '../components/charts/Plot';
import ChartContainer from '../components/ui/ChartContainer';
import SectionHeader from '../components/ui/SectionHeader';
import MetricCard from '../components/ui/MetricCard';
import Footer from '../components/layout/Footer';
import { SkeletonCard, SkeletonChart } from '../components/ui/Skeleton';
import { CHART_CONFIG, CHART_LAYOUT_BASE } from '../components/charts/BarChart';
import { useDemographicMetrics } from '../lib/queries';
import { formatEURCompact } from '../lib/formatters';
import type { DemographicMetric, DemographicType } from '../types';

// ── Color palette ─────────────────────────────────────────────────────────────
const NAVY = '#062E62';
const BLUE = '#0050FF';
const SKY = '#3B82F6';
const SLATE = '#8FADC9';
const TEAL = '#0891B2';
const BRAND = [NAVY, '#0A3D7A', '#0050CC', BLUE, '#2B6CB0', SKY, '#60A5FA', SLATE, '#A8C5DC', '#C5D9E8'];
const palette = (n: number) => Array.from({ length: n }, (_, i) => BRAND[i % BRAND.length]);

// ── Helpers ───────────────────────────────────────────────────────────────────
type MetricKey = 'impressions' | 'clicks' | 'ctr' | 'spend';

function groupByValue(rows: DemographicMetric[], type: DemographicType, metric: MetricKey) {
  const map = new Map<string, { impressions: number; clicks: number; spend: number }>();
  for (const r of rows) {
    if (r.demographic_type !== type) continue;
    const v = r.demographic_value;
    const prev = map.get(v) ?? { impressions: 0, clicks: 0, spend: 0 };
    map.set(v, {
      impressions: prev.impressions + (r.impressions ?? 0),
      clicks: prev.clicks + (r.clicks ?? 0),
      spend: prev.spend + (r.spend_eur ?? 0),
    });
  }

  const entries = [...map.entries()].sort((a, b) => {
    const key = metric === 'ctr' ? 'clicks' : metric === 'spend' ? 'spend' : metric;
    return (b[1] as any)[key] - (a[1] as any)[key];
  });

  const labels = entries.map(([k]) => k);
  const imprArr = entries.map(([, v]) => v.impressions);
  const clkArr = entries.map(([, v]) => v.clicks);
  const spdArr = entries.map(([, v]) => v.spend);
  const ctrArr = imprArr.map((imp, i) => imp > 0 ? parseFloat(((clkArr[i] / imp) * 100).toFixed(2)) : 0);

  const values =
    metric === 'clicks' ? clkArr :
      metric === 'ctr' ? ctrArr :
        metric === 'spend' ? spdArr :
          imprArr;

  return { labels, values, imprArr, clkArr, spdArr, ctrArr };
}

function fmtMetric(v: number, metric: MetricKey): string {
  if (metric === 'ctr') return `${v.toFixed(2)}%`;
  if (metric === 'spend') return `€${v.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return v.toLocaleString();
}

const METRIC_LABELS: Record<MetricKey, string> = {
  impressions: 'Impressions',
  clicks: 'Clicks',
  ctr: 'CTR %',
  spend: 'Spend (€)',
};

// ── Chart components ──────────────────────────────────────────────────────────

function HBarChart({ labels, values, maxHeight = 300, textFormat }: {
  labels: string[]; values: number[]; maxHeight?: number; textFormat?: (v: number) => string;
}) {
  // Chart height grows with number of bars so all labels are visible when scrolled
  const chartHeight = Math.max(200, labels.length * 34 + 40);

  // Shared x-axis range so bars and sticky axis stay in sync
  const maxVal = values.length > 0 ? Math.max(...values) * 1.22 : 1;

  const barData: Plotly.Data[] = [{
    type: 'bar', orientation: 'h',
    x: values, y: labels,
    marker: { color: palette(labels.length) },
    text: values.map(v => textFormat ? textFormat(v) : v.toLocaleString()),
    textposition: 'outside',
    textfont: { size: 12, color: NAVY },
  }];

  // Body layout — x-axis tick labels hidden, bottom margin = 0
  const bodyLayout: Partial<Plotly.Layout> = {
    ...CHART_LAYOUT_BASE,
    height: chartHeight,
    bargap: 0.3,
    xaxis: {
      showgrid: true,
      gridcolor: '#E0E4EA',
      showticklabels: false,
      range: [0, maxVal],
      fixedrange: true,
      zeroline: false,
    },
    yaxis: { ...CHART_LAYOUT_BASE.yaxis, showgrid: false, automargin: true, fixedrange: true },
    margin: { l: 145, r: 70, t: 20, b: 0 },
  };

  // Axis-only layout — just the x tick labels, no bars, matching left/right margin
  const axisLayout: Partial<Plotly.Layout> = {
    height: 36,
    xaxis: {
      showgrid: false,
      tickfont: { size: 11, color: '#5A6577' },
      range: [0, maxVal],
      fixedrange: true,
      zeroline: false,
      tickformat: values.some(v => v >= 1000) ? '~s' : undefined,
    },
    yaxis: { visible: false, fixedrange: true },
    margin: { l: 145, r: 70, t: 0, b: 28 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', size: 11 },
    showlegend: false,
  };

  // Single invisible bar to anchor the axis range
  const axisData: Plotly.Data[] = [{
    type: 'bar', orientation: 'h',
    x: [maxVal], y: [''],
    marker: { color: 'rgba(0,0,0,0)' },
    hoverinfo: 'none' as any,
    showlegend: false,
  }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Scrollable bars — x-axis labels hidden */}
      <div style={{
        maxHeight,
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: '#C5CDD8 transparent',
      }}>
        <Plot
          data={barData}
          layout={bodyLayout}
          config={{ ...CHART_CONFIG, staticPlot: true }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      </div>
      {/* Sticky x-axis — always visible below the scroll area */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid #E0E4EA',
        background: '#fff',
      }}>
        <Plot
          data={axisData}
          layout={axisLayout}
          config={{ ...CHART_CONFIG, staticPlot: true }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      </div>
    </div>
  );
}

function DonutChart({ labels, values, colors, height = 300 }: {
  labels: string[]; values: number[]; colors?: string[]; height?: number;
}) {
  const data: Plotly.Data[] = [{
    type: 'pie', hole: 0.54, labels, values,
    marker: { colors: colors ?? palette(labels.length) },
    textinfo: 'percent', textfont: { size: 13, color: '#fff' },
    hovertemplate: '<b>%{label}</b><br>%{value:,}<br>%{percent}<extra></extra>',
    pull: values.map((_, i) => i === 0 ? 0.04 : 0),
  }];
  const layout: Partial<Plotly.Layout> = {
    ...CHART_LAYOUT_BASE, height,
    margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true,
    legend: { orientation: 'v', font: { size: 12 }, x: 1.0, y: 0.5, bgcolor: 'rgba(0,0,0,0)' },
  };
  return <Plot data={data} layout={layout} config={CHART_CONFIG} style={{ width: '100%' }} useResizeHandler />;
}

function TreemapChart({ labels, parents, values, height = 320 }: {
  labels: string[]; parents: string[]; values: number[]; height?: number;
}) {
  const data: Plotly.Data[] = [{
    type: 'treemap' as any, labels, parents, values,
    marker: { colors: palette(labels.length), line: { width: 2, color: '#fff' } },
    texttemplate: '<b>%{label}</b><br>%{value:,}',
    textfont: { size: 13, color: '#fff' },
    hovertemplate: '<b>%{label}</b><br>%{value:,}<extra></extra>',
  }];
  const layout: Partial<Plotly.Layout> = { ...CHART_LAYOUT_BASE, height, margin: { l: 10, r: 10, t: 10, b: 10 } };
  return <Plot data={data} layout={layout} config={CHART_CONFIG} style={{ width: '100%' }} useResizeHandler />;
}

function WorldMapChart({ codes, values, height = 380 }: {
  codes: string[]; values: number[]; height?: number;
}) {
  const data: Plotly.Data[] = [{
    type: 'choropleth' as any,
    locationmode: 'ISO-3' as any,
    locations: codes,
    z: values,
    colorscale: [[0, '#D6E4F0'], [0.25, SKY], [0.6, BLUE], [1, NAVY]],
    colorbar: { title: { text: 'Value', font: { size: 11 } }, thickness: 12, tickfont: { size: 11 } },
    hovertemplate: '<b>%{location}</b><br>%{z:,}<extra></extra>',
  }];
  const layout: Partial<Plotly.Layout> = {
    ...CHART_LAYOUT_BASE, height,
    geo: {
      showframe: false, showcoastlines: true, coastlinecolor: '#E0E4EA',
      showland: true, landcolor: '#F4F5F7', showocean: true, oceancolor: '#FAFBFC',
      showlakes: false, projection: { type: 'natural earth' },
    },
    margin: { l: 0, r: 0, t: 10, b: 10 },
  };
  return <Plot data={data} layout={layout} config={CHART_CONFIG} style={{ width: '100%' }} useResizeHandler />;
}

function VBarChart({ labels, values, colors, height = 260, textFormat }: {
  labels: string[]; values: number[]; colors?: string[]; height?: number; textFormat?: (v: number) => string;
}) {
  const data: Plotly.Data[] = [{
    type: 'bar', x: labels, y: values,
    marker: { color: colors ?? palette(labels.length) },
    text: values.map(v => textFormat ? textFormat(v) : v.toLocaleString()),
    textposition: 'outside', textfont: { size: 13, color: NAVY },
  }];
  const layout: Partial<Plotly.Layout> = { ...CHART_LAYOUT_BASE, height, bargap: 0.35, margin: { l: 50, r: 20, t: 30, b: 50 } };
  return <Plot data={data} layout={layout} config={CHART_CONFIG} style={{ width: '100%' }} useResizeHandler />;
}

function SectionLabel({ title, question }: {
  title: string; question: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', margin: '2rem 0 0.75rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--color-navy)' }}>
      <div>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-navy)', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</span>
        <p style={{ fontSize: 12, color: '#5A6577', marginTop: 3 }}>{question}</p>
      </div>
    </div>
  );
}

// ISO-2 → ISO-3 map (for the choropleth — LinkedIn returns 2-letter codes)
const ISO2_TO_ISO3: Record<string, string> = {
  DE: 'DEU', US: 'USA', IN: 'IND', FR: 'FRA', GB: 'GBR', NL: 'NLD', JP: 'JPN',
  CH: 'CHE', IT: 'ITA', SE: 'SWE', ES: 'ESP', AU: 'AUS', CA: 'CAN', BR: 'BRA',
  CN: 'CHN', SG: 'SGP', AE: 'ARE', AT: 'AUT', BE: 'BEL', DK: 'DNK', FI: 'FIN',
  NO: 'NOR', PL: 'POL', PT: 'PRT', CZ: 'CZE', KR: 'KOR', HK: 'HKG', MX: 'MEX',
  ZA: 'ZAF', IL: 'ISR', TR: 'TUR', RU: 'RUS', IE: 'IRL', HU: 'HUN', RO: 'ROU',
};

function toISO3(code: string): string {
  return ISO2_TO_ISO3[code.toUpperCase()] ?? code;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DemographicsPage() {
  const [metric, setMetric] = useState<MetricKey>('impressions');
  const { data = [], isLoading, isError, refetch } = useDemographicMetrics();

  // ── Aggregated views per demographic type ──
  const jobFunc = useMemo(() => groupByValue(data, 'job_function', metric), [data, metric]);
  const seniority = useMemo(() => groupByValue(data, 'seniority', metric), [data, metric]);
  const senSpend = useMemo(() => groupByValue(data, 'seniority', 'spend'), [data]);
  const industry = useMemo(() => groupByValue(data, 'industry', metric), [data, metric]);
  const compSize = useMemo(() => groupByValue(data, 'company_size', metric), [data, metric]);
  const geoData = useMemo(() => groupByValue(data, 'geo_country', metric), [data, metric]);

  // KPI totals
  const totalImpr = useMemo(() => data.filter(r => r.demographic_type === 'job_function').reduce((s, r) => s + (r.impressions ?? 0), 0), [data]);
  const totalClk = useMemo(() => data.filter(r => r.demographic_type === 'job_function').reduce((s, r) => s + (r.clicks ?? 0), 0), [data]);
  const totalSpend = useMemo(() => data.filter(r => r.demographic_type === 'job_function').reduce((s, r) => s + (r.spend_eur ?? 0), 0), [data]);
  const avgCTR = totalImpr > 0 ? (totalClk / totalImpr) * 100 : 0;

  const hasData = data.length > 0;

  const fmtForMetric = (v: number) => fmtMetric(v, metric);

  // geo — convert ISO2 → ISO3 for choropleth
  const geoCodes = useMemo(() => geoData.labels.map(toISO3), [geoData.labels]);

  // Loading
  if (isLoading) {
    return (
      <div className="content">
        <div className="page-header page-header-tofu">
          <h2>Demographics</h2>
          <p>Audience Insights</p>
        </div>
        <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} height={60} />)}
        </div>
        <SkeletonChart height={320} />
        <SkeletonChart height={300} />
        <Footer />
      </div>
    );
  }

  // Error
  if (isError) {
    return (
      <div className="content">
        <div style={{ padding: '2rem', textAlign: 'center', color: '#5A6577' }}>
          <p style={{ marginBottom: '1rem' }}>Failed to load demographic data.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      {/* ── Page Header ── */}
      <div className="page-header page-header-tofu">
        <h2>Demographics</h2>
        <p>Audience Insights • LinkedIn Campaign Analytics</p>
      </div>

      {/* ── Empty state — table exists but no rows yet ── */}
      {!hasData && (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#5A6577', background: '#fff', border: '1px solid #E0E4EA', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: '0.5rem' }}>No demographic data yet</p>
          <p style={{ marginBottom: '1rem' }}>
            Demographic data is collected during the LinkedIn sync. Click <strong>Sync Now</strong> in the header to pull the latest data from LinkedIn's Ads API.
          </p>
        </div>
      )}

      {/* ── Metric Toggle ── */}
      {hasData && (
        <>
          <div className="filter-bar" style={{ marginBottom: '1.25rem' }}>
            <span className="filter-label">Show Metric</span>
            <div className="filter-pills">
              {(Object.keys(METRIC_LABELS) as MetricKey[]).map(m => (
                <button key={m} className={`filter-pill${metric === m ? ' active' : ''}`} onClick={() => setMetric(m)}>
                  {METRIC_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* ── Demographic Data Note ── */}
          <div style={{
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderLeft: '4px solid #0050FF',
            padding: '0.85rem 1.25rem',
            marginBottom: '1.5rem',
            fontSize: 12,
            color: '#1E3A8A',
            lineHeight: 1.5,
          }}>
            <strong>Note on Demographic Metrics vs. Dashboard Metrics:</strong> Demographic metrics on this page may reflect lower numbers than the overall totals on the main dashboard. LinkedIn applies privacy, thresholding, and anonymization rules to demographic breakdowns, reporting data only for impressions from members with complete and accessible profile information.
          </div>

          {/* ── KPI Summary ── */}
          <SectionHeader>Overall Reach Summary</SectionHeader>
          <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
            <MetricCard label="Impressions" value={totalImpr.toLocaleString()} />
            <MetricCard label="Clicks" value={totalClk.toLocaleString()} />
            <MetricCard label="Avg. CTR" value={`${avgCTR.toFixed(2)}%`} />
            <MetricCard label="Total Spend" value={formatEURCompact(totalSpend)} />
          </div>

          {/* 1. Job Function */}
          {jobFunc.labels.length > 0 && (
            <>
              <SectionLabel title="Job Function" question="Are we reaching decision-makers (Engineering, R&D, Purchasing) or irrelevant roles?" />
              <ChartContainer title={`Job Function — ${METRIC_LABELS[metric]}`}>
                <HBarChart
                  labels={[...jobFunc.labels].reverse()}
                  values={[...jobFunc.values].reverse()}
                  maxHeight={300}
                  textFormat={fmtForMetric}
                />
              </ChartContainer>
            </>
          )}

          {/* 2. Job Seniority */}
          {seniority.labels.length > 0 && (
            <>
              <SectionLabel title="Job Seniority" question="Are decision-makers (Director, VP, CXO) seeing our ads, or are we paying for entry-level eyeballs?" />
              <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
                <ChartContainer title={`Seniority — ${METRIC_LABELS[metric]}`}>
                  <DonutChart labels={seniority.labels} values={seniority.values} colors={palette(seniority.labels.length)} height={300} />
                </ChartContainer>
                <ChartContainer title="Seniority — Spend (€)">
                  <HBarChart
                    labels={[...senSpend.labels].reverse()}
                    values={[...senSpend.values].reverse()}
                    maxHeight={300}
                    textFormat={v => `€${v.toLocaleString()}`}
                  />
                </ChartContainer>
              </div>
            </>
          )}

          {/* 3. Industry */}
          {industry.labels.length > 0 && (
            <>
              <SectionLabel title="Industry" question="Is our spend hitting target verticals (Pharma, Chemicals, Glass) or irrelevant sectors?" />
              <ChartContainer title={`Industry — ${METRIC_LABELS[metric]}`}>
                <HBarChart
                  labels={[...industry.labels].reverse()}
                  values={[...industry.values].reverse()}
                  maxHeight={300}
                  textFormat={fmtForMetric}
                />
              </ChartContainer>
            </>
          )}

          {/* 4. Company Size */}
          {compSize.labels.length > 0 && (
            <>
              <SectionLabel title="Company Size" question="Are we attracting Enterprise clients or SMBs? Tile size = volume." />
              <ChartContainer title="Company Size — Impressions">
                <TreemapChart
                  labels={['All', ...compSize.labels]}
                  parents={['', ...Array(compSize.labels.length).fill('All')]}
                  values={[0, ...compSize.values.map(Number)]}
                  height={320}
                />
              </ChartContainer>
            </>
          )}

          {/* 5. Geography */}
          {geoCodes.length > 0 && (
            <>
              <SectionLabel title="Geography" question="Which countries are driving the most engagement? Darker = higher value." />
              <ChartContainer title={`Countries — ${METRIC_LABELS[metric]}`}>
                <WorldMapChart codes={geoCodes} values={geoData.values} height={380} />
              </ChartContainer>
            </>
          )}

          {/* 5b. Geography table — top 10 */}
          {geoData.labels.length > 0 && (
            <ChartContainer title="Top Countries — Detail">
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>#</th><th>Country Code</th>
                      <th className="th-num" style={{ textAlign: 'right' }}>Impressions</th>
                      <th className="th-num" style={{ textAlign: 'right' }}>Clicks</th>
                      <th className="th-num" style={{ textAlign: 'right' }}>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {geoData.labels.slice(0, 15).map((country, i) => {
                      const imp = geoData.imprArr[i];
                      const clk = geoData.clkArr[i];
                      const ctr = imp > 0 ? ((clk / imp) * 100).toFixed(2) : '—';
                      return (
                        <tr key={country}>
                          <td style={{ color: '#5A6577', fontWeight: 700 }}>{i + 1}</td>
                          <td style={{ fontWeight: 600, color: NAVY }}>{country}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{imp.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{clk.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: BLUE, fontWeight: 600 }}>{ctr}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ChartContainer>
          )}
        </>
      )}

      <Footer />
    </div>
  );
}
