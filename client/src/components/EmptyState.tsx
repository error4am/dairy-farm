import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function EmptyState({
  title,
  message,
  action
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="inbox" size={30} />
      </div>
      <div className="empty-title">{title}</div>
      <div className="empty-msg">{message}</div>
      {action}
    </div>
  );
}
