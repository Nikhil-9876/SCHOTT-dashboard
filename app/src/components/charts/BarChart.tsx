import Plot from 'react-plotly.js';

// ── Shared Plotly config from dashboard.html script block ──
export const CHART_CONFIG: Partial<Plotly.Config> = {
  responsive: true,
  displaylogo: false,
};

export const CHART_LAYOUT_BASE: Partial<Plotly.Layout> = {
  margin: { l: 50, r: 20, t: 30, b: 60 },
  plot_bgcolor: 'rgba(0,0,0,0)',
  paper_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Inter, sans-serif', size: 13, color: '#1A1A1A' },
  yaxis: { gridcolor: '#E0E4EA', tickfont: { size: 12, color: '#1A1A1A' }, zeroline: false },
  xaxis: { showgrid: false, tickfont: { size: 12, color: '#1A1A1A' } },
  showlegend: false,
  bargap: 0.35,
};

interface BarChartProps {
  labels: string[];
  values: number[];
  colors: string[];
  height?: number;
  textFormat?: (v: number) => string;
  yAxisTitle?: string;
  yAxisRange?: [number, number];
  marginOverride?: Partial<Plotly.Margin>;
}

export default function BarChart({
  labels,
  values,
  colors,
  height = 280,
  textFormat = (v) => v.toLocaleString('en-IN'),
  yAxisTitle,
  yAxisRange,
  marginOverride,
}: BarChartProps) {
  const data: Plotly.Data[] = [
    {
      type: 'bar',
      x: labels,
      y: values,
      marker: { color: colors },
      text: values.map(textFormat),
      textposition: 'outside',
      textfont: { size: 13, color: '#062E62' },
    },
  ];

  const layout: Partial<Plotly.Layout> = {
    ...CHART_LAYOUT_BASE,
    height,
    ...(marginOverride ? { margin: { ...CHART_LAYOUT_BASE.margin, ...marginOverride } } : {}),
    yaxis: {
      ...CHART_LAYOUT_BASE.yaxis,
      ...(yAxisTitle ? { title: { text: yAxisTitle, font: { size: 13, color: '#5A6577' } } } : {}),
      ...(yAxisRange ? { range: yAxisRange } : {}),
    },
  };

  return (
    <Plot
      data={data}
      layout={layout}
      config={CHART_CONFIG}
      style={{ width: '100%' }}
      useResizeHandler
    />
  );
}
