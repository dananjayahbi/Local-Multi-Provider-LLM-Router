"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Rocket, Settings2, RefreshCw } from "lucide-react";
import { Draft, parseDiscoveredModels } from "./discovery-types";
import { KeySetupForm } from "./key-setup-form";
import { ConfigureProviderDialog } from "./configure-provider-dialog";

interface Props {
  draft: Draft;
  onChanged: () => void;
}

/** APPROVED-stage card (task 04): set the provider API key, then push to
 *  the CONFIGURED stage. Keys are provider-level and shared across pools. */
export function ApprovedProviderCard({ draft, onChanged }: Props) {
  const [configureOpen, setConfigureOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const modelCount = parseDiscoveredModels(draft).length;
  const provider = draft.provider;

  const handleReject = async () => {
    if (!confirm(`Reject ${draft.name}?`)) return;
    setRejecting(true);
    try {
      await fetch(`/api/admin/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      onChanged();
    } finally {
      setRejecting(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold leading-tight">{draft.name}</h3>
            <code className="text-xs text-muted-foreground">{draft.baseUrl}</code>
          </div>
          <Badge variant="warning">{draft.apiFormat}</Badge>
        </div>

        {provider && (
          <KeySetupForm
            providerId={provider.id}
            keys={provider.apiKeys}
            onChanged={onChanged}
          />
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground">{modelCount} discovered model(s)</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReject} disabled={rejecting}>
              <RefreshCw className="mr-1 h-3 w-3" /> Reject
            </Button>
            <Button
              size="sm"
              onClick={() => setConfigureOpen(true)}
              disabled={!provider || provider.apiKeys.length === 0}
              title={
                provider && provider.apiKeys.length === 0
                  ? "Set an API key first"
                  : "Configure models"
              }
            >
              <Settings2 className="mr-1 h-3 w-3" /> Configure
              <Rocket className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>

      {provider && (
        <ConfigureProviderDialog
          draft={draft}
          open={configureOpen}
          onOpenChange={setConfigureOpen}
          onConfigured={onChanged}
        />
      )}
    </Card>
  );
}
