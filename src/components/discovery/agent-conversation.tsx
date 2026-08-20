"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Search,
  Globe,
  Braces,
  PackagePlus,
  SkipForward,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";

interface DiscoveryEvent {
  id: string;
  kind: string;
  message: string;
  detail: string | null;
  createdAt: string;
}

const KIND_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "success" | "destructive" | "warning"; icon: typeof Info }
> = {
  INFO: { label: "Info", variant: "secondary", icon: Info },
  SEARCH: { label: "Search", variant: "secondary", icon: Search },
  FETCH: { label: "Fetch", variant: "secondary", icon: Globe },
  EXTRACT: { label: "Extract", variant: "secondary", icon: Braces },
  STAGE: { label: "Staged", variant: "success", icon: PackagePlus },
  SKIP: { label: "Skipped", variant: "warning", icon: SkipForward },
  ERROR: { label: "Error", variant: "destructive", icon: AlertTriangle },
  DONE: { label: "Done", variant: "success", icon: CheckCircle2 },
};

const POLL_MS = 2000;

/**
 * Live agent-conversation transcript for a discovery request.
 * Polls the events endpoint incrementally (via `since`) and
 * renders the Hermes agent's actions in real time.
 */
export function AgentConversation({ requestId }: { requestId: string }) {
  const [events, setEvents] = useState<DiscoveryEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const lastIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const since = lastIdRef.current ? `?since=${lastIdRef.current}` : "";
        const res = await fetch(`/api/admin/discovery/requests/${requestId}/events${since}`);
        if (!res.ok) throw new Error("bad response");
        const next: DiscoveryEvent[] = await res.json();
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
  }, [requestId]);

  // Auto-scroll to the newest event.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Agent Conversation
          {!connected && (
            <Badge variant="warning" className="ml-auto">
              Reconnecting…
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Waiting for the Hermes agent to report its progress…
          </p>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-80 space-y-2 overflow-y-auto pr-1 text-sm"
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
