"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Trash2 } from "lucide-react";

interface DeleteProviderDialogProps {
  /** The provider being deleted (for the confirmation message). */
  provider: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful delete so the parent can refresh the list. */
  onDeleted: () => void;
}

/**
 * Confirmation dialog for deleting a provider. Warns that all of the provider's
 * models and API keys will be removed, and that its models will be auto-detached
 * from any pool that currently uses them.
 */
export function DeleteProviderDialog({
  provider,
  onOpenChange,
  onDeleted,
}: DeleteProviderDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = provider !== null;

  const handleDelete = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/providers/${provider.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) {
      onOpenChange(false);
      onDeleted();
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to delete provider" }));
      setError(err.error || "Failed to delete provider");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Delete Provider
          </DialogTitle>
          <DialogDescription>
            Delete <span className="font-medium text-foreground">{provider?.name}</span>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Deleting a provider will:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Remove all of its models</li>
            <li>Remove all of its API keys</li>
            <li>Auto-detach its models from any pools that use them</li>
            <li>Remove its calibration history</li>
          </ul>
        </div>
        {error && (
          <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={busy}>
            <Trash2 className="mr-1 h-3 w-3" />
            {busy ? "Deleting..." : "Delete Provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
