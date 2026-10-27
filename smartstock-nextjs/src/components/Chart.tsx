'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Config, Data, Layout } from 'plotly.js';

// Plotly touches `window`, so it only loads in the browser
const Plot = dynamic(() => import('react-plotly.js'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-tile bg-well" />,
});

type Loose = Record<string, unknown>;

interface ChartProps {
  // Traces and layouts come both from the API (plain JSON) and from the tabs, so they are loosely typed here
  data: unknown[];
  layout?: Loose;
  config?: Loose;
  className?: string;
}

export const CHART = {
  primary: '#0b6b5f',
  brass: '#c3922e',
  brassSoft: 'rgba(195,146,46,0.14)',
  bad: '#dd5a43',
  info: '#3d78e0',
  muted: '#67716c',
  grid: 'rgba(20,34,30,0.07)',
  ink: '#121a17',
};

// next/font serves Urbanist under a hashed family name; read it off the page so Plotly's SVG text matches
const useAppFont = () => {
  const [font, setFont] = useState('ui-sans-serif, system-ui, sans-serif');
  useEffect(() => setFont(getComputedStyle(document.body).fontFamily), []);
  return font;
};

// Plotly accepts `title: "text"` at runtime but the types want `{ text }`; normalise and style both
const withTitle = (title: unknown, size: number) =>
  title == null || title === '' ? undefined : { ...(typeof title === 'string' ? { text: title } : (title as Loose)), font: { size, color: CHART.muted } };

const styleAxis = (axis: unknown) => {
  const a = (axis ?? {}) as Loose;
  return {
    gridcolor: CHART.grid,
    griddash: 'dot',
    zeroline: false,
    showline: false,
    ticks: '',
    tickfont: { size: 11.5, color: CHART.muted },
    automargin: true,
    ...a,
    title: withTitle(a.title, 12),
  };
};

export default function Chart({ data, layout = {}, config = {}, className = 'h-full w-full' }: ChartProps) {
  const font = useAppFont();
  const themed = {
    autosize: true,
    font: { family: font, color: CHART.ink, size: 12 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    hovermode: 'x unified',
    hoverlabel: { font: { family: font, size: 12.5, color: CHART.ink }, bgcolor: '#fbfcfa', bordercolor: 'rgba(20,34,30,0.12)' },
    colorway: [CHART.primary, CHART.brass, CHART.info, CHART.bad],
    showlegend: false,
    barcornerradius: 5,
    bargap: 0.35,
    ...layout,
    margin: { l: 44, r: 12, b: 32, t: 12, ...((layout.margin as Loose) ?? {}) },
    legend: { orientation: 'h', y: 1.08, x: 0, font: { size: 12, color: CHART.muted }, ...((layout.legend as Loose) ?? {}) },
    title: withTitle(layout.title, 14),
    xaxis: styleAxis(layout.xaxis),
    yaxis: styleAxis(layout.yaxis),
  } as Partial<Layout>;

  return (
    <Plot
      data={data as Data[]}
      layout={themed}
      config={{ displayModeBar: false, responsive: true, ...config } as Partial<Config>}
      className={className}
      useResizeHandler
    />
  );
}
