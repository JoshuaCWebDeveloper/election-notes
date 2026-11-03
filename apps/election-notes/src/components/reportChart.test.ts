import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getReportChartLayout, ReportChart } from './reportChart';
import type { ReportPanel } from '../services/reports';

const basePanel: ReportPanel = {
  id: 'panel',
  dashboardId: 'dashboard',
  name: 'Panel',
  type: 'bar-chart',
  placement: 'contest',
  color: null
};

describe('getReportChartLayout', () => {
  it('uses vertical scrolling for horizontal bar panels', () => {
    expect(getReportChartLayout({ ...basePanel, horizontal: true })).toEqual({
      orientation: 'horizontal-bars',
      scrollAxis: 'y'
    });
  });

  it('uses horizontal scrolling for column panels', () => {
    expect(getReportChartLayout(basePanel)).toEqual({
      orientation: 'vertical-columns',
      scrollAxis: 'x'
    });
  });
});


describe('chart label hover tooltips', () => {
  const datum = [{ id: 1, label: 'A particularly long chart label that will be truncated', value: 42, color: null }];
  it.each(['horizontal-bars', 'vertical-columns'] as const)('retains full label in the %s tooltip', (orientation) => {
    const html = renderToStaticMarkup(createElement(ReportChart, {
      data: datum,
      layout: { orientation, scrollAxis: orientation === 'horizontal-bars' ? 'y' : 'x' }
    }));
    expect(html).toContain('title="A particularly long chart label that will be truncated"');
    expect(html).toContain('A particularly long chart label that will be truncated</span>');
  });
});
