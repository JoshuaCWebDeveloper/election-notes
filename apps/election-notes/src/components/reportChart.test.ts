import { describe, expect, it } from 'vitest';
import { getReportChartLayout } from './reportChart';
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
