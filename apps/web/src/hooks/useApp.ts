import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSnapshot, Command, CommandResult } from '@robinhacks/core';
import type { AppGateway } from '../app/gateway';
export interface AppActions {
  gateway: AppGateway;
  refresh: () => Promise<void>;
  execute: (command: Command) => Promise<CommandResult>;
  busy: boolean;
  notify: (message: string) => void;
}
export function useApp(gateway: AppGateway) {
  const [data, setData] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const request = useRef(0);
  const load = useCallback(
    async (force = false) => {
      const id = ++request.current;
      try {
        const next = await gateway.snapshot(force);
        if (mounted.current && id === request.current) {
          setData(next);
          setError('');
        }
      } catch (e) {
        if (mounted.current && id === request.current)
          setError(e instanceof Error ? e.message : 'Could not load the event. Try again.');
      }
    },
    [gateway],
  );
  const refresh = useCallback(() => load(true), [load]);
  useEffect(() => {
    mounted.current = true;
    void load(true);
    const unsubscribe = gateway.subscribe(() => {
      setRevision((value) => value + 1);
      void load(false);
    });
    const online = () => void load(true);
    window.addEventListener('online', online);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener('online', online);
    };
  }, [gateway, load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const execute = useCallback(
    async (command: Command) => {
      setBusy(true);
      try {
        const result = await gateway.command(command);
        await load(false);
        if (result.message) setNotice(result.message);
        return result;
      } catch (e) {
        await refresh();
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [gateway, refresh, load],
  );
  return {
    data,
    error,
    busy,
    notice,
    revision,
    refresh,
    execute,
    notify: setNotice,
  };
}
export function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
