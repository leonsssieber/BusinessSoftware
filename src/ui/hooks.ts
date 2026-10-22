import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";

export interface Resource<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (update: T | ((prev: T | undefined) => T)) => void;
}

/** Loads JSON from `path` (skipped while `path` is null) and exposes reload/setData. */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await api.get<T>(path);
      if (id === latest.current) {
        setDataState(result);
        setError(null);
      }
    } catch (err) {
      if (id === latest.current) setError(errorMessage(err));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const setData = useCallback((update: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof update === "function" ? (update as (p: T | undefined) => T)(prev) : update));
  }, []);

  return { data, error, loading, reload: load, setData };
}

/** Runs an async action while tracking its pending state and error message. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(errorMessage(err));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, setError };
}

export function useDocumentTitle(title: string, productName: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${productName}` : productName;
  }, [title, productName]);
}
