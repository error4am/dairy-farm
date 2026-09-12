import { Icon } from './Icon';

export function Pagination({
  total,
  limit,
  offset,
  onChange
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.floor(offset / limit) + 1);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div className="pagination">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="pagination-btns">
        <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onChange((page - 2) * limit)}>
          <Icon name="chevron-left" size={14} /> Prev
        </button>
        <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page * limit)}>
          Next <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </div>
  );
}
