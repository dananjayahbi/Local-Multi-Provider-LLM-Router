"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ClipboardCheck, Loader2, SearchX } from "lucide-react";
import type { CalibrationSession, RateLimitFindings } from "./calibration-types";

interface FindingsPanelProps {
  session: CalibrationSession | null;
  applying: boolean;
  onApply: () => void;
}

const FIELD_LABELS: Array<{ key: keyof RateLimitFindings; label: string }> = [
  { key: "rpm", label: "RPM" },
  { key: "tpm", label: "TPM" },
  { key: "rpd", label: "RPD" },
  { key: "tpd", label: "TPD" },
  { key: "tps", label: "Tokens/sec" },
  { key: "contextWindow", label: "Context Window" },
];

/**
 * Shows the rate-limit findings the Hermes agent discovered for a
 * completed calibration session. The user reviews them and manually
 * applies the limits to the provider-level key (no auto-write).
 */
export function CalibrationFindingsPanel({ session, applying, onApply }: FindingsPanelProps) {
  const findings = useMemo<RateLimitFindings | null>(() => {
    if (!session?.findings) return null;
    try {
      return JSON.parse(session.findings) as RateLimitFindings;
    } catch {
      return null;
    }
  }, [session]);

  const present = FIELD_LABELS.filter((f) => findings?.[f.key] != null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          Rate-Limit Findings
        </CardTitle>
        {session?.status === "COMPLETED" && (
          <Badge variant="success">Ready to apply</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!session || session.status === "PENDING" || session.status === "RUNNING" ? (
          <p className="text-sm text-muted-foreground">
            {session
              ? "Waiting for the Hermes agent to finish researching…"
              : "Start a calibration session to discover the provider's free-quota rate limits."}
          </p>
        ) : session.status === "FAILED" ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {session.error || "Calibration failed. See the agent activity for details."}
          </p>
        ) : !findings || present.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
            <SearchX className="h-5 w-5" />
            <span className="text-sm">
              No rate-limit values were found for this provider&apos;s free quota.
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {present.map((f) => (
                <div key={f.key} className="rounded-lg border px-3 py-2">
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="text-lg font-semibold">
                    {findings[f.key] != null
                      ? Number(findings[f.key]).toLocaleString()
                      : "—"}
                  </p>
                </div>
              ))}
            </div>

            {findings.sources && findings.sources.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Sources</p>
                {findings.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-primary underline"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            )}

            <Button
              className="w-full"
              onClick={onApply}
              disabled={applying || session.applied}
              variant={session.applied ? "outline" : "default"}
            >
              {session.applied ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Applied to key
                </>
              ) : applying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-2 h-4 w-4" />
              )}
              {session.applied
                ? "Applied to key"
                : applying
                  ? "Applying..."
                  : "Apply limits to key"}
            </Button>
            {!session.applied && (
              <p className="text-center text-xs text-muted-foreground">
                Review the values above, then apply them to the key. This is a manual step.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
