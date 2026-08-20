"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Eye, KeyRound, Trash2, Pencil } from "lucide-react";
import { Draft } from "./discovery-types";
import { KeySetupForm } from "./key-setup-form";
import { ConfigureProviderDialog } from "./configure-provider-dialog";

interface Props {
  draft: Draft;
  onChanged: () => void;
}

/** CONFIGURED-stage card (task 04): provider is fully onboarded, shows the
 *  configured models. Models appear on the Models page and can feed pools.
 *  Supports MANY API keys per provider (task 02/03): even after onboarding,
 *  more keys (e.g. one per Google account) can still be added or removed.
 *  An "Edit" button reopens the configure dialog (pre-filled) to add more
 *  models after the fact. */
export function ConfiguredProviderCard({ draft, onChanged }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const provider = draft.provider;
  const models = provider?.providerModels ?? [];
  const keys = provider?.apiKeys ?? [];

  const handleDelete = async () => {
    if (!confirm(`Delete ${draft.name}? This also removes its provider and models.`)) return;
    await fetch(`/api/admin/drafts/${draft.id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold leading-tight">{draft.name}</h3>
            <code className="text-xs text-muted-foreground">{draft.baseUrl}</code>
          </div>
          <Badge variant="success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Configured
          </Badge>
        </div>

        <div>
          <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
            <Eye className="h-3 w-3" /> Configured models ({models.length})
          </h4>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No models configured.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {models.map((m) => (
                <Badge key={m.id} variant="secondary">
                  {m.modelId}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {provider && (
          <div className="rounded-md border bg-muted/30 p-3">
            <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
              <KeyRound className="h-3 w-3" /> API keys ({keys.length}) — add more for this provider
            </h4>
            <KeySetupForm
              providerId={provider.id}
              keys={keys}
              onChanged={onChanged}
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            title="Edit models / limits"
          >
            <Pencil className="mr-1 h-3 w-3" /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDelete}>
            <Trash2 className="mr-1 h-3 w-3 text-destructive" /> Delete
          </Button>
        </div>
      </CardContent>

      {provider && (
        <ConfigureProviderDialog
          draft={draft}
          open={editOpen}
          onOpenChange={setEditOpen}
          onConfigured={onChanged}
        />
      )}
    </Card>
  );
}
