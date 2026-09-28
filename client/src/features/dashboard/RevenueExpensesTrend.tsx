import { useLayoutEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { useApi } from '../../lib/useApi';
import { formatMoney, trimNumber } from '../../lib/format';
import type { RevenueExpensesSeries } from '../../lib/types';

const RANGES = [7, 30, 90];
const DEFAULT_RANGE = 30;

type Point = RevenueExpensesSeries['data'][number];

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const rough = value / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((c) => c * pow).find((c) => c >= rough) ?? 10 * pow;
  return Math.max(Math.ceil(value / step) * step, step);
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(date + 'T00:00:00')
  );
}

function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date + 'T00:00:00')
  );
}

function axisLabel(value: number): string {
  if (Math.abs(value) >= 1000) {
    try {
      return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    } catch {
      return trimNumber(value);
    }
  }
  return trimNumber(value);
}

function TrendChart({ points, currency }: { points: Point[]; currency: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = points.length;
  const height = width > 0 && width < 520 ? 210 : 250;
  const pad = { top: 16, right: 16, bottom: 28, left: 52 };
  const innerW = Math.max(width - pad.left - pad.right, 1);
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...points.flatMap((p) => [p.revenue, p.expenses])));
  const x = (i: number) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const totals = points.reduce(
    (acc, p) => ({ revenue: acc.revenue + p.revenue, expenses: acc.expenses + p.expenses }),
    { revenue: 0, expenses: 0 }
  );
  const tickCount = Math.min(7, n);
  const tickIndexes = Array.from(
    new Set(
      Array.from({ length: tickCount }, (_, k) =>
        Math.round((k * (n - 1)) / Math.max(tickCount - 1, 1))
      )
    )
  );
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);

  const revenuePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.revenue).toFixed(2)}`)
    .join(' ');
  const expensesPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.expenses).toFixed(2)}`)
    .join(' ');
  const step = n > 1 ? innerW / (n - 1) : innerW;
  const hoverPoint = hover !== null ? points[hover] : null;
  const anchorValue = hoverPoint ? Math.max(hoverPoint.revenue, hoverPoint.expenses) : 0;

  return (
    <div className="trend-wrap" ref={wrapRef}>
      {width > 0 && (
        <svg
          className="trend-chart"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Revenue and expenses over the last ${n} days, revenue ${formatMoney(
            totals.revenue,
            currency
          )}, expenses ${formatMoney(totals.expenses, currency)}`}
          onMouseLeave={() => setHover(null)}
        >
          {gridValues.map((v) => (
            <g key={v}>
              <line className="trend-grid-line" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
              <text className="trend-axis-label" x={pad.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {axisLabel(v)}
              </text>
            </g>
          ))}

          <path className="fin-line fin-line-expenses" d={expensesPath} />
          <path className="fin-line fin-line-revenue" d={revenuePath} />

          {tickIndexes.map((i) => (
            <text
              key={i}
              className="trend-axis-label"
              x={i === 0 ? pad.left - 4 : i === n - 1 ? width - pad.right + 4 : x(i)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            >
              {shortDate(points[i].date)}
            </text>
          ))}

          {hover !== null && (
            <g>
              <circle className="fin-dot-revenue" cx={x(hover)} cy={y(points[hover].revenue)} r={4} />
              <circle className="fin-dot-expenses" cx={x(hover)} cy={y(points[hover].expenses)} r={4} />
            </g>
          )}

          {points.map((p, i) => {
            const left = Math.max(pad.left, x(i) - step / 2);
            const right = Math.min(width - pad.right, x(i) + step / 2);
            return (
              <rect
                key={p.date}
                className="trend-hit"
                x={left}
                y={pad.top}
                width={Math.max(right - left, 1)}
                height={innerH}
                onMouseEnter={() => setHover(i)}
              />
            );
          })}
        </svg>
      )}

      {width > 0 && hover !== null && hoverPoint && (
        <div
          className={`trend-tooltip${y(anchorValue) < 86 ? ' trend-tooltip-below' : ''}`}
          style={{
            left: Math.min(Math.max(x(hover), 84), Math.max(width - 84, 84)),
            top: y(anchorValue)
          }}
        >
          <div className="trend-tip-date">{longDate(hoverPoint.date)}</div>
          <div className="trend-tip-row">
            <span className="finance-dot revenue" />
            Revenue {formatMoney(hoverPoint.revenue, currency)}
          </div>
          <div className="trend-tip-row">
            <span className="finance-dot expenses" />
            Expenses {formatMoney(hoverPoint.expenses, currency)}
          </div>
        </div>
      )}
    </div>
  );
}

export function RevenueExpensesTrend() {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const { data, loading, error } = useApi<RevenueExpensesSeries>(
    `/dashboard/revenue-expenses?range=${range}`
  );

  const empty = data ? data.data.every((d) => d.revenue === 0 && d.expenses === 0) : false;

  return (
    <div className="card trend-card">
      <div className="card-header">
        <div className="card-title">Revenue &amp; Expenses</div>
        <div className="trend-ranges" role="group" aria-label="Revenue and expenses range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={`btn btn-sm${r === range ? ' btn-primary' : ''}`}
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>
      <div className="card-body trend-body" aria-busy={loading}>
        {error ? (
          <div className="error-box">{error}</div>
        ) : !data ? (
          <div className="spinner" />
        ) : empty ? (
          <EmptyState
            title="No financial activity"
            message={`No income or expenses in the last ${data.range} days. Add a transaction to see the trend here.`}
          />
        ) : (
          <div className={`trend-chart-wrap${loading ? ' trend-loading' : ''}`}>
            <div className="finance-summary">
              <div className="finance-sum">
                <span className="finance-sum-label">
                  <span className="finance-dot revenue" />
                  Revenue
                </span>
                <span className="finance-sum-value">{formatMoney(data.totals.revenue, data.currency)}</span>
              </div>
              <div className="finance-sum">
                <span className="finance-sum-label">
                  <span className="finance-dot expenses" />
                  Expenses
                </span>
                <span className="finance-sum-value">{formatMoney(data.totals.expenses, data.currency)}</span>
              </div>
              <div className={`finance-sum ${data.totals.net >= 0 ? 'positive' : 'negative'}`}>
                <span className="finance-sum-label">Net</span>
                <span className="finance-sum-value">{formatMoney(data.totals.net, data.currency)}</span>
              </div>
            </div>
            <TrendChart points={data.data} currency={data.currency} />
          </div>
        )}
      </div>
    </div>
  );
}
