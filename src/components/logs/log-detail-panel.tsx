"use client";

import { Badge } from "@/components/ui/badge";

/**
 * LogEntry shape shared by the /logs page (mirrors the gateway route response).
 * Includes the failure-detail fields the gateway now populates so a record can
 * be expanded to show BOTH sides of an error: what the PROVIDER returned and
 * what the GATEWAY surfaced back to the client.
 */
export interface LogEntry {
  id: string;
  outcome: string;
  errorClassification: string | null;
  httpStatus: number | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  requestedVirtualModel: string;
  tier: string | null;
  createdAt: string;
  apiKey?: { id: string; label: string; provider: { name: string } } | null;
  pool?: { id: string; name: string } | null;
  providerModel?: { id: string; displayName: string } | null;
  // Failure detail (task: detailed error expansion).
  providerErrorMessage?: string | null;
  providerErrorCode?: string | null;
  gatewayErrorMessage?: string | null;
}

/** A small labeled value cell for the detail grid. */
function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

/**
 * Renders the expanded detail for a single log row. For failures it surfaces
 * both the provider's raw response and the message the gateway pushed to the
 * client (e.g. Copilot), plus any applicable error code / HTTP status.
 */
export function LogDetailPanel({ log }: { log: LogEntry }) {
  const isFailure = log.outcome === "FAILURE" || log.outcome === "EMPTY_RESPONSE";
  const providerMsg = log.providerErrorMessage?.trim();
  const gatewayMsg = log.gatewayErrorMessage?.trim();

  return (
    <div className="space-y-4 px-4 py-3">
      <div className="grid grid-cols-4 gap-3 text-xs">
        <Detail label="HTTP Status" value={log.httpStatus || "N/A"} />
        <Detail label="Pool" value={log.pool?.name || "Direct"} />
        <Detail label="Model" value={log.providerModel?.displayName || "N/A"} />
        <Detail label="API Key" value={log.apiKey?.label || "?"} />
        <Detail label="Prompt Tokens" value={log.promptTokens ?? "?"} />
        <Detail label="Completion Tokens" value={log.completionTokens ?? "?"} />
        <Detail label="Classification" value={log.errorClassification || "None"} />
        <Detail label="Tier" value={log.tier || "N/A"} />
      </div>

      {isFailure && (
        <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-center gap-2">
            <Badge variant="destructive">{log.errorClassification || "FAILURE"}</Badge>
          </div>

          {/* The PROVIDER's raw response */}
          {providerMsg ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Provider response
                {log.providerErrorCode && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    code: {log.providerErrorCode}
                  </Badge>
                )}
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-xs">
                {providerMsg}
              </pre>
            </div>
          ) : null}

          {/* What the GATEWAY surfaced to the client */}
          {gatewayMsg ? (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Gateway sent to client
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-xs">
                {gatewayMsg}
              </pre>
            </div>
          ) : null}

          {/* Fallback if only a classification is known */}
          {!providerMsg && !gatewayMsg && (
            <p className="text-xs text-muted-foreground">
              No detailed provider/gateway error message was captured for this request.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
