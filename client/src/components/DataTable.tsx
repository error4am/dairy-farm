import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortKey?: string;
  align?: 'left' | 'right';
  width?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  sort,
  dir,
  onSort,
  empty
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  sort?: string;
  dir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  empty?: ReactNode;
}) {
  if (loading) return <div className="spinner" />;

  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="No records" message="Nothing to show here yet." />}</>;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = c.sortKey !== undefined && sort === c.sortKey;
              const sortable = c.sortKey !== undefined && onSort !== undefined;
              const className = [c.align === 'right' ? 'num' : '', sortable ? 'th-sort' : ''].filter(Boolean).join(' ');
              return (
                <th
                  key={c.key}
                  className={className}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={sortable ? () => onSort(c.sortKey as string) : undefined}
                >
                  {c.header}
                  {active ? (dir === 'asc' ? ' ↑' : ' ↓') : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
