import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function StatCard({
  label,
  value,
  hint,
  tone,
  onClick,
  to
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'positive' | 'negative';
  onClick?: () => void;
  to?: string;
}) {
  const content = (
    <>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ' ' + tone : ''}`}>{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="stat stat-clickable">
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className="stat stat-clickable" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className="stat">{content}</div>;
}
