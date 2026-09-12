import type { ReactNode } from 'react';

export type BadgeTone = 'green' | 'gray' | 'red' | 'amber' | 'blue';

export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
