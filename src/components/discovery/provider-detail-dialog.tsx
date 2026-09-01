"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Eye, Check, X, ThumbsDown } from "lucide-react";
import { Draft, parseDiscoveredModels, parseDetails } from "./discovery-types";

interface Props {
  draft: Draft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (draft: Draft) => void;
  onReject: (draft: Draft) => void;
}

/** Read-more popup (task 03): lists all free models that can be configured
 *  for the provider, plus extra agent findings, with approve/reject actions. */
export function ProviderDetailDialog({ draft, open, onOpenChange, onApprove, onReject }: Props) {
  if (!draft) return null;
  const models = parseDiscoveredModels(draft);
  const details = parseDetails(draft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{draft.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{draft.apiFormat}</Badge>
            <code className="text-xs">{draft.baseUrl}</code>
            {draft.sourceUrl && (
              <a
                href={draft.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Source
              </a>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* ── Free models ── */}
        <div>
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Eye className="h-4 w-4" /> Configurable free models ({models.length})
          </h4>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No free models discovered.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {models.map((m) => (
                <div key={m.modelId} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <code className="text-sm font-medium">{m.modelId}</code>
                    <Badge variant="secondary">{m.displayName || m.modelId}</Badge>
                  </div>
                  {(m.supportsVision || m.supportsFunctionCalling) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.supportsVision && <Badge variant="outline">vision</Badge>}
                      {m.supportsFunctionCalling && <Badge variant="outline">function-calling</Badge>}
                    </div>
                  )}
                  {m.contextWindow ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      ctx ~{m.contextWindow.toLocaleString()} tokens
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Extra agent findings ── */}
        {details && (
          <div>
            <h4 className="mb-1 text-sm font-semibold">Agent findings</h4>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {JSON.stringify(details, null, 2)}
            </pre>
          </div>
        )}

        {draft.notes && (
          <p className="text-sm text-muted-foreground">{draft.notes}</p>
        )}

        {/* ── Actions ── */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onReject(draft)}>
            <ThumbsDown className="mr-1 h-3 w-3" /> Reject
          </Button>
          <Button size="sm" onClick={() => onApprove(draft)}>
            <Check className="mr-1 h-3 w-3" /> Approve
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
