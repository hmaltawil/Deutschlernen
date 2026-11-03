export function Ring({ value, max, size = 112, children }: { value: number; max: number; size?: number; children?: React.ReactNode }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }} role="img" aria-label={`${value} of ${max} points today`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent-soft)" strokeWidth={stroke} />
        {frac > 0 && <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={frac >= 1 ? 'var(--gap)' : 'var(--accent)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />}
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}
