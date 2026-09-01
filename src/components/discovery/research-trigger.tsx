"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, Sparkles } from "lucide-react";
import { AgentConversation } from "@/components/discovery/agent-conversation";

interface DiscoveryRequest {
  id: string;
  prompt: string | null;
  status: string;
  resultCount: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_VARIANTS: Record<string, string> = {
  PENDING: "text-amber-600 dark:text-amber-400",
  RUNNING: "text-lime-600 dark:text-lime-400",
  COMPLETED: "text-green-600 dark:text-green-400",
  FAILED: "text-red-600 dark:text-red-400",
};

export function ResearchTrigger({ onTriggered }: { onTriggered?: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<DiscoveryRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await fetch("/api/admin/discovery/requests");
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch {
      setRequests([]);
    }
    setLoadingRequests(false);
  }, []);

  // Load the request history on mount so an already-RUNNING session
  // (e.g. after a page refresh) immediately shows its live conversation.
  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleTrigger = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/admin/discovery/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() || undefined }),
      });
      setPrompt("");
      await loadRequests();
      onTriggered?.();
    } finally {
      setSubmitting(false);
    }
  };

  // The request whose live conversation we render (the active RUNNING one).
  const activeRequest = requests.find((r) => r.status === "RUNNING");

  // While any request is PENDING or RUNNING, keep refreshing the list so the
  // status transitions (PENDING → RUNNING → COMPLETED) and the live
  // conversation stay current.
  const hasActive = requests.some((r) => r.status === "PENDING" || r.status === "RUNNING");
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(loadRequests, 4000);
    return () => clearInterval(timer);
  }, [hasActive, loadRequests]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Run Research Session
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="research-prompt">
            Research Prompt <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="research-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional: guide the agent. e.g. 'Focus on free DeepSeek-compatible endpoints with generous free tiers'"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to use the agent&apos;s default discovery queries. The Hermes agent picks
            this up automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleTrigger} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            {submitting ? "Queuing..." : "Start Research"}
          </Button>
          <Button variant="outline" onClick={loadRequests} disabled={loadingRequests}>
            {loadingRequests ? "Loading..." : "Refresh History"}
          </Button>
        </div>

        {requests.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-sm font-medium">Recent Sessions</p>
            <div className="space-y-1.5">
              {requests.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-muted-foreground">
                      {r.prompt || "Default discovery queries"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                      {r.status === "COMPLETED" && ` · ${r.resultCount} draft(s)`}
                      {r.status === "FAILED" && r.error && ` · ${r.error}`}
                    </p>
                  </div>
                  <span className={`ml-2 shrink-0 font-medium ${STATUS_VARIANTS[r.status] ?? ""}`}>
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeRequest && <AgentConversation requestId={activeRequest.id} />}
      </CardContent>
    </Card>
  );
}
