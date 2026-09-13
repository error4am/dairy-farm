import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  tone,
  onClick
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'positive' | 'negative';
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ' ' + tone : ''}`}>{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="stat stat-clickable" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className="stat">{content}</div>;
}
