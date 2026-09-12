import { createContext, useContext, type ReactNode } from 'react';
import { useApi } from './useApi';
import { FALLBACK_META } from './constants';
import type { Meta } from './types';

const MetaContext = createContext<Meta>(FALLBACK_META);

export function MetaProvider({ children }: { children: ReactNode }) {
  const { data } = useApi<Meta>('/meta');
  return <MetaContext.Provider value={data ?? FALLBACK_META}>{children}</MetaContext.Provider>;
}

export function useMeta() {
  return useContext(MetaContext);
}
