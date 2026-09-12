import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ' ' + tone : ''}`}>{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}
