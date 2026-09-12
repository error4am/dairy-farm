import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface DataContextValue {
  version: number;
  refresh: () => void;
}

const DataContext = createContext<DataContextValue>({ version: 0, refresh: () => {} });

export function DataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ version, refresh }), [version, refresh]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
