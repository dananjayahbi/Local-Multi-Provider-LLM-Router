"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry } from "./log-detail-panel";

export interface LogsResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LogFilters {
  outcome: string;
  errorClassification: string;
}

const POLL_MS = 4000; // refresh every 4s while this view is mounted

/**
 * Polls /api/admin/logs on an interval so new entries appear without a manual
 * refresh. Pauses while the document is hidden. Only re-issues a request when
 * the page or filters change; a light "tick" keeps the newest page current.
 */
export function useLogsPolling(page: number, filters: LogFilters) {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const pageRef = useRef(page);
  const filtersRef = useRef(filters);
  const keyRef = useRef("");

  const fetchLogs = useCallback(async (p: number, f: LogFilters) => {
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("pageSize", "50");
    if (f.outcome) params.set("outcome", f.outcome);
    if (f.errorClassification) params.set("errorClassification", f.errorClassification);
    const res = await fetch(`/api/admin/logs?${params.toString()}`);
    return (await res.json()) as LogsResponse;
  }, []);

  // Initial + on page/filter change. Re-fetch any time the key changes.
  useEffect(() => {
    const key = `${page}|${filters.outcome}|${filters.errorClassification}`;
    keyRef.current = key;
    pageRef.current = page;
    filtersRef.current = filters;

    let cancelled = false;
    setLoading(true);
    fetchLogs(page, filters)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLastUpdated(Date.now());
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, filters, fetchLogs]);

  // Poll on an interval, but only re-fetch the CURRENT page/filters. A full
  // re-fetch on every tick keeps the newest rows appearing for real-time feel.
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      const result = await fetchLogs(pageRef.current, filtersRef.current);
      setData(result);
      setLastUpdated(Date.now());
      setLoading(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchLogs]);

  return { data, loading, lastUpdated, refresh: () => fetchLogs(page, filters).then((r) => { setData(r); setLastUpdated(Date.now()); }) };
}
