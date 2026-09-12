import { useEffect, useState } from 'react';
import { api } from './api';
import { useData } from './DataContext';

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T>(path: string | null): ApiState<T> {
  const { version } = useData();
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: path !== null,
    error: null
  });

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ data: s.data, loading: true, error: null }));
    api
      .get<T>(path)
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (alive) setState({ data: null, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [path, version]);

  return state;
}
