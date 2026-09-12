import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ success: () => {}, error: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, kind, message }]);
    setTimeout(() => {
      setItems((list) => list.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message)
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'success' ? 'check' : 'alert'} size={16} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
