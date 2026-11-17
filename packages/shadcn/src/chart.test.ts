// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { renderView } from 'effectweb/testing';
import { Chart } from './chart.js';

test('switches between all chart types, preserves missing observations and closes a single full pie', () => {
  const host = document.createElement('div');
  const props: Parameters<typeof Chart>[0] = {
    label: 'Revenue',
    config: { sales: { label: 'Sales', color: 'purple' } },
    data: [
      { id: 'a', label: 'First', values: { sales: 4 } },
      { id: 'b', label: 'Unknown', values: { sales: undefined } },
      { id: 'c', label: 'Last', values: { sales: -2 } },
    ],
  };
  const mounted = renderView(host, Chart, props);
  try {
    expect(host.querySelectorAll('svg rect')).toHaveLength(2);
    for (const type of ['line', 'area'] as const) {
      mounted.update({ ...props, type });
      const d = host.querySelector('svg path')?.getAttribute('d');
      expect(d?.match(/M/g)).toHaveLength(2);
      expect(d?.includes('Z')).toBe(type === 'area');
    }
    mounted.update({ ...props, type: 'radar' });
    expect(host.querySelector('svg polygon')?.getAttribute('points')?.split(' ')).toHaveLength(3);
    for (const type of ['pie', 'radial'] as const) {
      mounted.update({ ...props, type });
      expect(host.querySelector('svg circle')?.getAttribute('stroke-dasharray')).toBe('1 0');
    }
    expect(host.querySelector('tbody')?.textContent).toContain('Unknown—');
  } finally {
    mounted.dispose();
  }
});
