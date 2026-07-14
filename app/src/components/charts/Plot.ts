import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';

const createPlotly = (
  createPlotlyComponent as unknown as {
    default?: typeof createPlotlyComponent;
  }
).default ?? createPlotlyComponent;

const plotly = (
  Plotly as unknown as {
    default?: typeof Plotly;
  }
).default ?? Plotly;

const Plot = createPlotly(plotly);

export default Plot;
