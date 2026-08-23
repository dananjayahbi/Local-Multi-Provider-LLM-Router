"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Search,
  Globe,
  Braces,
  ListChecks,
  SkipForward,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import type { CalibrationEvent } from "./calibration-types";

const KIND_META: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "success" | "destructive" | "warning";
    icon: typeof Info;
  }
> = {
  INFO: { label: "Info", variant: "secondary", icon: Info },
  SEARCH: { label: "Search", variant: "secondary", icon: Search },
  FETCH: { label: "Fetch", variant: "secondary", icon: Globe },
  EXTRACT: { label: "Extract", variant: "secondary", icon: Braces },
  RESULT: { label: "Result", variant: "success", icon: ListChecks },
  SKIP: { label: "Skipped", variant: "warning", icon: SkipForward },
  ERROR: { label: "Error", variant: "destructive", icon: AlertTriangle },
  DONE: { label: "Done", variant: "success", icon: CheckCircle2 },
};

const POLL_MS = 2000;

/**
 * Live agent-activity transcript for a calibration session. Polls
 * the events endpoint incrementally (via `since`) and renders the
 * Hermes agent's research in real time.
 */
export function CalibrationEventFeed({ sessionId }: { sessionId: string | null }) {
  const [events, setEvents] = useState<CalibrationEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const lastIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      lastIdRef.current = null;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const since = lastIdRef.current ? `?since=${lastIdRef.current}` : "";
        const res = await fetch(
          `/api/admin/calibration/sessions/${sessionId}/events${since}`
        );
        if (!res.ok) throw new Error("bad response");
        const next: CalibrationEvent[] = await res.json();
        if (next.length > 0) {
          setEvents((prev) => [...prev, ...next]);
          lastIdRef.current = next[next.length - 1].id;
        }
        setConnected(true);
      } catch {
        setConnected(false);
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  // Auto-scroll to the newest event.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          Agent Activity
          {sessionId && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
          {!connected && (
            <Badge variant="warning" className="ml-auto">
              Reconnecting…
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!sessionId ? (
          <p className="text-sm text-muted-foreground">
            No active calibration session. Start one to watch the agent work.
          </p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Waiting for the Hermes agent to report its progress…
          </p>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-64 space-y-2 overflow-y-auto pr-1 text-sm"
          >
            {events.map((ev) => {
              const meta = KIND_META[ev.kind] ?? KIND_META.INFO;
              const Icon = meta.icon;
              return (
                <div key={ev.id} className="flex items-start gap-2">
                  <Badge variant={meta.variant} className="mt-0.5 shrink-0 gap-1">
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                  <div className="min-w-0">
                    <p className="wrap-break-word">{ev.message}</p>
                    {ev.detail && (
                      <p className="wrap-break-word text-xs text-muted-foreground">{ev.detail}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
