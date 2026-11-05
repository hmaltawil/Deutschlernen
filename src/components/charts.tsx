import { useEffect, useRef, useState } from 'react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const fmt = (n: number) => n.toLocaleString();

export interface Datum {
  key: string;
  /** short axis label; empty to skip */
  tick: string;
  /** full label for tooltip / table */
  label: string;
  value: number;
  detail?: string;
}

/**
 * Single-series column chart: thin columns, 4px rounded caps, hairline grid, hover/focus tooltip.
 * No text is drawn inside the plot (it ended up on top of columns); name the goal and today's
 * value in the chart's subtitle instead.
 */
export function ColumnChart({
  data,
  goal,
  unit,
  height = 180,
}: {
  data: Datum[];
  goal?: number;
  unit: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 36;
  const padR = 8;
  const padT = 16;
  const padB = 22;
  const innerW = Math.max(width - padL - padR, 10);
  const innerH = height - padT - padB;
  const max = niceMax(Math.max(...data.map((d) => d.value), goal ?? 0));
  const band = innerW / data.length;
  const barW = Math.max(Math.min(24, band - 2), 2);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const r = Math.min(4, barW / 2);

  const colPath = (x: number, v: number) => {
    const top = y(v);
    const base = padT + innerH;
    const h = base - top;
    if (h <= 0) return '';
    const rr = Math.min(r, h);
    return `M${x},${base}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + barW - rr}Q${x + barW},${top} ${x + barW},${top + rr}V${base}Z`;
  };

  const hv = hover !== null ? data[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${unit} chart`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={padL - 6} y={y(t) + 4} textAnchor="end">
              {t >= 10000 ? `${Math.round(t / 1000)}K` : fmt(Math.round(t))}
            </text>
          </g>
        ))}
        {goal !== undefined && goal > 0 && <line className="goal-line" x1={padL} x2={width - padR} y1={y(goal)} y2={y(goal)} />}
        {data.map((d, i) => {
          const x = padL + i * band + (band - barW) / 2;
          return (
            <g key={d.key}>
              <rect
                className="col-hit"
                x={padL + i * band}
                y={padT}
                width={band}
                height={innerH}
                tabIndex={0}
                aria-label={`${d.label}: ${fmt(d.value)} ${unit}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              <path className={`col ${hover === i ? 'hover' : ''}`} d={colPath(x, d.value)} pointerEvents="none" />
              {d.tick && (
                <text className="axis-label" x={x + barW / 2} y={height - 6} textAnchor="middle">
                  {d.tick}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hv && hover !== null && (
        <div className="tooltip" style={{ left: padL + hover * band + band / 2, top: y(hv.value) }}>
          <strong>{fmt(hv.value)}</strong> {hv.value === 1 ? unit.replace(/s$/, '') : unit}
          <div>{hv.label}</div>
          {hv.detail && <div style={{ opacity: 0.8 }}>{hv.detail}</div>}
        </div>
      )}
      <details className="table-view">
        <summary>Show as table</summary>
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>{unit}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td>{fmt(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export interface Part {
  name: string;
  value: number;
  color: string;
  ink: string;
}

/** Tall segmented bar (one whole split into parts) with legend; labels only where they fit. */
export function SegmentedBar({ parts, label }: { parts: Part[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const total = parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  const gaps = Math.max(visible.length - 1, 0) * 2;
  return (
    <div>
      <div className="segbar" ref={ref} role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.value}`).join(', ')}`}>
        {total === 0 ? (
          <div style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--muted)' }}>No sentences played yet</div>
        ) : (
          visible.map((p) => {
            const w = (p.value / total) * (width - gaps);
            const text = fmt(p.value);
            const fits = w >= text.length * 7.5 + 16;
            return (
              <div
                key={p.name}
                style={{ flex: `${p.value} 0 0`, background: p.color, color: p.ink }}
                title={`${p.name}: ${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)`}
                tabIndex={0}
                aria-label={`${p.name}: ${fmt(p.value)}`}
              >
                {fits ? text : ''}
              </div>
            );
          })
        )}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.name}>
            <i style={{ background: p.color }} />
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
