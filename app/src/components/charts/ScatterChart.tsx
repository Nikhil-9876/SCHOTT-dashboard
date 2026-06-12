import Plot from 'react-plotly.js';
import { CHART_CONFIG, CHART_LAYOUT_BASE } from './BarChart';

interface ScatterPoint {
  x: number;   // CTR %
  y: number;   // Leads
  label: string;
  size?: number;
}

interface ScatterChartProps {
  points: ScatterPoint[];
  height?: number;
  xAxisTitle?: string;
  yAxisTitle?: string;
  markerColor?: string;
}

export default function ScatterChart({
  points,
  height = 280,
  xAxisTitle = 'CTR %',
  yAxisTitle = 'Leads',
  markerColor = '#062E62',
}: ScatterChartProps) {
  const data: Plotly.Data[] = [
    {
      type: 'scatter',
      mode: 'markers',
      x: points.map((p) => p.x),
      y: points.map((p) => p.y),
      marker: {
        color: markerColor,
        size: points.map((p) => p.size ?? 16),
        line: { color: '#fff', width: 1 },
      },
      text: points.map((p) => p.label),
      hovertemplate: '<b>%{text}</b><br>CTR: %{x}%<br>Leads: %{y}<extra></extra>',
    },
  ];

  const layout: Partial<Plotly.Layout> = {
    ...CHART_LAYOUT_BASE,
    height,
    xaxis: {
      ...CHART_LAYOUT_BASE.xaxis,
      title: { text: xAxisTitle, font: { size: 13, color: '#5A6577' } },
    },
    yaxis: {
      ...CHART_LAYOUT_BASE.yaxis,
      title: { text: yAxisTitle, font: { size: 13, color: '#5A6577' } },
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
