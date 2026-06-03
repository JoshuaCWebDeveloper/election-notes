import type { CSSProperties } from 'react';
import type { ReportDatum, ReportPanel } from '../services/reports';

export type ReportChartOrientation = 'horizontal-bars' | 'vertical-columns';
export type ReportChartScrollAxis = 'x' | 'y';

export type ReportChartLayout = {
  orientation: ReportChartOrientation;
  scrollAxis: ReportChartScrollAxis;
};

export function getReportChartLayout(panel: ReportPanel): ReportChartLayout {
  if (panel.horizontal === true) {
    return {
      orientation: 'horizontal-bars',
      scrollAxis: 'y'
    };
  }

  return {
    orientation: 'vertical-columns',
    scrollAxis: 'x'
  };
}

export function ReportChart({ data, layout }: { data: ReportDatum[]; layout: ReportChartLayout }) {
  const max = Math.max(1, ...data.map((item) => Math.abs(item.value ?? 0)));

  if (data.length === 0) return <p className="empty-report">No report data.</p>;

  return (
    <div
      className={`report-chart-shell report-chart-shell--${layout.orientation}`}
      data-scroll-axis={layout.scrollAxis}
      style={{ '--chart-item-count': data.length } as CSSProperties}
    >
      {layout.orientation === 'horizontal-bars'
        ? <HorizontalBarChart data={data} max={max} />
        : <VerticalColumnChart data={data} max={max} />}
    </div>
  );
}

function HorizontalBarChart({ data, max }: { data: ReportDatum[]; max: number }) {
  return (
    <div className="horizontal-bar-chart">
      {data.map((item) => (
        <div className="horizontal-bar-chart__row" key={item.id}>
          <span>{item.label}</span>
          <div className="horizontal-bar-chart__axis">
            <i
              aria-label={`${item.label}: ${formatChartValue(item.value)}`}
              style={chartItemStyle(item, max)}
            />
          </div>
          <b>{formatChartValue(item.value)}</b>
        </div>
      ))}
    </div>
  );
}

function VerticalColumnChart({ data, max }: { data: ReportDatum[]; max: number }) {
  return (
    <div className="vertical-column-chart">
      <div className="vertical-column-chart__plot">
        {data.map((item) => (
          <div className="vertical-column-chart__column" key={item.id}>
            <b>{formatChartValue(item.value)}</b>
            <i
              aria-label={`${item.label}: ${formatChartValue(item.value)}`}
              style={chartItemStyle(item, max)}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function chartItemStyle(item: ReportDatum, max: number) {
  const percent = Math.max(1, Math.abs(item.value ?? 0) / max * 100);
  return {
    '--bar-percent': `${percent}%`,
    background: item.color ?? '#176b87'
  } as CSSProperties;
}

function formatChartValue(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
