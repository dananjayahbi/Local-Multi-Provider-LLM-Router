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

interface DeleteModelDialogProps {
  /** The model being deleted (for the confirmation message). Null closes the dialog. */
  model: { id: string; modelId: string; displayName: string } | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful delete so the parent can refresh its list. */
  onDeleted: () => void;
}

/**
 * Confirmation dialog for deleting a model. Warns that the model will be
 * auto-detached from every pool that references it, then deleted.
 */
export function DeleteModelDialog({
  model,
  onOpenChange,
  onDeleted,
}: DeleteModelDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = model !== null;

  const handleDelete = async () => {
    if (!model) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/models/${model.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) {
      onOpenChange(false);
      onDeleted();
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to delete model" }));
      setError(err.error || "Failed to delete model");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Delete Model
          </DialogTitle>
          <DialogDescription>
            Delete{" "}
            {model?.displayName ? (
              <span className="font-medium text-foreground">{model.displayName}</span>
            ) : model?.modelId ? (
              <span className="font-medium text-foreground">{model.modelId}</span>
            ) : null}
            ? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Deleting a model will:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Remove it from any pool it belongs to (auto-detach)</li>
            <li>Delete the model definition</li>
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
            {busy ? "Deleting..." : "Delete Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
