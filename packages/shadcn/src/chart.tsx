import { list, view } from 'effectweb';
import type { Native, Styled } from './types.js';
import { cn } from './cn.js';

export type ChartConfig = Readonly<Record<string, { label: string; color: string }>>;
export interface ChartDatum {
  readonly id: string;
  readonly label: string;
  readonly values: Readonly<Record<string, number | undefined>>;
}
/** Responsive frame for a chart and its legend. */
export const ChartContainer = view<Native<'figure'> & Styled>(({ class: className, ...props }) => (
  <figure
    data-slot="chart-container"
    class={cn('grid min-w-0 gap-3 text-sm', className)}
    {...props}
  />
));
/** Lists series labels and their configured colors. */
export const ChartLegendContent = view<{ config: ChartConfig }>(({ config }) => (
  <ul data-slot="chart-legend" class="flex flex-wrap justify-center gap-4">
    {list(
      Object.entries(config),
      (entry) => entry[0],
      ([, series]) => (
        <li>
          <span aria-hidden="true" style={{ color: series.color }}>
            ●{' '}
          </span>
          {series.label}
        </li>
      ),
    )}
  </ul>
));
/** The series legend, usable outside the chart frame. */
export const ChartLegend = ChartLegendContent;
/** Renders the labelled observations for one datum. */
export const ChartTooltipContent = view<{ datum: ChartDatum; config: ChartConfig }>(
  ({ datum, config }) => (
    <dl data-slot="chart-tooltip">
      <dt>{datum.label}</dt>
      {list(
        Object.entries(config),
        (entry) => entry[0],
        ([key, series]) => (
          <dd>
            {series.label}: {datum.values[key] ?? '—'}
          </dd>
        ),
      )}
    </dl>
  ),
);
/** A datum summary for custom chart overlays. */
export const ChartTooltip = ChartTooltipContent;
type PolarType = 'pie' | 'radar' | 'radial';
const polarPoint = (r: number, fraction: number) => {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return [300 + r * Math.cos(angle), 98 + r * Math.sin(angle)].join(',');
};
const PolarPlot = view<{ type: PolarType; data: readonly ChartDatum[]; config: ChartConfig }>(
  ({ type, data, config }) => {
    const entries = Object.entries(config);
    const amount = (value: number | undefined) =>
      value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
    const totals = entries.map(([key]) =>
      data.reduce((sum, row) => sum + amount(row.values[key]), 0),
    );
    const max =
      data.reduce(
        (m, row) => entries.reduce((v, [key]) => Math.max(v, amount(row.values[key])), m),
        0,
      ) || 1;
    if (type === 'radar')
      return (
        <g>
          {list(
            data,
            (row) => row.id,
            (_row, i) => (
              <path
                d={'M300,98 L' + polarPoint(90, i / data.length)}
                stroke="currentColor"
                opacity={0.2}
              />
            ),
          )}
          {list(
            entries,
            (entry) => entry[0],
            ([key, series]) => (
              <polygon
                points={data
                  .map((row, i) =>
                    polarPoint((90 * amount(row.values[key])) / max, i / data.length),
                  )
                  .join(' ')}
                fill={series.color}
                fill-opacity={0.2}
                stroke={series.color}
              >
                <title>{series.label}</title>
              </polygon>
            ),
          )}
        </g>
      );
    const grandTotal = totals.reduce((a, b) => a + b, 0);
    const peak = totals.reduce((a, b) => Math.max(a, b), 0) || 1;
    let offset = 0;
    const arcs = entries.map(([key, series], i) => {
      const fraction = type === 'pie' ? totals[i]! / (grandTotal || 1) : totals[i]! / peak;
      const start = type === 'pie' ? offset : 0;
      offset += fraction;
      const width = type === 'pie' ? 88 : 80 / Math.max(entries.length, 1);
      const radius = type === 'pie' ? 44 : 90 - (i + 0.5) * width;
      return { key, series, start, fraction, radius, width, value: totals[i]! };
    });
    return (
      <g transform="rotate(-90 300 98)">
        {list(
          arcs,
          (arc) => arc.key,
          (arc) => (
            <circle
              cx={300}
              cy={98}
              r={arc.radius}
              pathLength={1}
              fill="none"
              stroke={arc.series.color}
              stroke-width={arc.width}
              stroke-dasharray={arc.fraction + ' ' + (1 - arc.fraction)}
              stroke-dashoffset={-arc.start}
            >
              <title>
                {arc.series.label}: {arc.value}
              </title>
            </circle>
          ),
        )}
      </g>
    );
  },
);
/** Draw grouped bars, lines or filled areas on a common numeric axis. Missing observations leave gaps. */
export const Chart = view<{
  label: string;
  data: readonly ChartDatum[];
  config: ChartConfig;
  type?: 'bar' | 'line' | 'area' | PolarType;
  legend?: boolean;
}>(({ label, data, config, type = 'bar', legend = true }) => {
  const entries = Object.entries(config);
  let low = 0,
    high = 0;
  for (const row of data)
    for (const [key] of entries) {
      const value = row.values[key];
      if (value !== undefined && Number.isFinite(value)) {
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
  const y = (value: number) => 184 - ((value - low) / (high - low || 1)) * 172;
  const span = 592 / Math.max(1, data.length);
  const x = (index: number) => 4 + (index + 0.5) * span;
  return (
    <ChartContainer>
      <figcaption>{label}</figcaption>
      <svg viewBox="0 0 600 196" role="img" aria-label={label}>
        {type === 'radar' || type === 'pie' || type === 'radial' ? (
          <PolarPlot type={type} data={data} config={config} />
        ) : (
          <>
            <line x1={4} x2={596} y1={y(0)} y2={y(0)} stroke="currentColor" opacity={0.3} />
            {list(
              entries,
              (entry) => entry[0],
              ([key, series], seriesIndex) => {
                const width = (span * 0.8) / entries.length;
                const paths: string[] = [];
                let points: string[] = [],
                  firstX = 0,
                  lastX = 0;
                const finish = () => {
                  if (points.length)
                    paths.push(
                      'M' +
                        points.join(' L') +
                        (type === 'area'
                          ? ' L' + lastX + ',' + y(0) + ' L' + firstX + ',' + y(0) + ' Z'
                          : ''),
                    );
                  points = [];
                };
                if (type !== 'bar') {
                  for (const [index, row] of data.entries()) {
                    const value = row.values[key];
                    if (value === undefined || !Number.isFinite(value)) {
                      finish();
                      continue;
                    }
                    lastX = x(index);
                    if (!points.length) firstX = lastX;
                    points.push(lastX + ',' + y(value));
                  }
                  finish();
                }
                return (
                  <g fill={series.color}>
                    {type !== 'bar' ? (
                      <path
                        d={paths.join(' ')}
                        stroke={series.color}
                        fill={type === 'area' ? series.color : 'none'}
                        fill-opacity={0.25}
                      />
                    ) : null}
                    {list(
                      data,
                      (row) => row.id,
                      (row, index) => {
                        const value = row.values[key];
                        if (value === undefined || !Number.isFinite(value)) return null;
                        const title = (
                          <title>
                            {row.label}: {series.label} {value}
                          </title>
                        );
                        return type === 'bar' ? (
                          <rect
                            x={x(index) - span * 0.4 + seriesIndex * width}
                            y={Math.min(y(0), y(value))}
                            width={width}
                            height={Math.abs(y(value) - y(0))}
                          >
                            {title}
                          </rect>
                        ) : (
                          <circle cx={x(index)} cy={y(value)} r={3}>
                            {title}
                          </circle>
                        );
                      },
                    )}
                  </g>
                );
              },
            )}
          </>
        )}
      </svg>
      {legend ? <ChartLegend config={config} /> : null}
      <details>
        <summary>Chart data</summary>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              {list(
                entries,
                (entry) => entry[0],
                ([, series]) => (
                  <th>{series.label}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {list(
              data,
              (row) => row.id,
              (row) => (
                <tr>
                  <th scope="row">{row.label}</th>
                  {list(
                    entries,
                    (entry) => entry[0],
                    ([key]) => (
                      <td>{row.values[key] ?? '—'}</td>
                    ),
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </details>
    </ChartContainer>
  );
});
