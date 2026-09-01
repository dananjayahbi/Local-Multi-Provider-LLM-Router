"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, Loader2, AlertTriangle } from "lucide-react";
import { applyRestore, previewBackup, type BackupMetaInfo } from "./backup-api";
import type { BackupPayload } from "@/engine/backup/types";

type RestoreMode = "merge" | "replace";

export function BackupRestoreSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [pendingPayload, setPendingPayload] = useState<BackupPayload | null>(null);
  const [meta, setMeta] = useState<BackupMetaInfo | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setMeta(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;
      const info = await previewBackup(payload);
      setPendingPayload(payload);
      setMeta(info);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid backup file");
      setPendingPayload(null);
      setMeta(null);
      setFileName(null);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset input so re-selecting the same file re-triggers change.
    e.target.value = "";
  };

  const handleRestore = async () => {
    if (!pendingPayload) return;
    setBusy(true);
    setError(null);
    try {
      await applyRestore(pendingPayload, mode);
      reset();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPendingPayload(null);
    setMeta(null);
    setFileName(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload a previously exported backup to restore providers, keys, models, pools, and settings.
        Nothing is written until you confirm.
      </p>

      <div className="space-y-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onFileChange}
          className="hidden"
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" /> Choose Backup File
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground truncate max-w-60">{fileName}</span>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {meta && (
        <div className="space-y-3 rounded-md border bg-muted/40 p-4">
          <div className="flex items-center gap-2">
            <Badge variant="success">Valid backup</Badge>
            <span className="text-xs text-muted-foreground">
              Created {new Date(meta.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <span className="text-muted-foreground">Providers</span>
            <span>{meta.counts.providers ?? 0}</span>
            <span className="text-muted-foreground">API Keys</span>
            <span>{meta.counts.apiKeys ?? 0}</span>
            <span className="text-muted-foreground">Models</span>
            <span>{meta.counts.providerModels ?? 0}</span>
            <span className="text-muted-foreground">Pools</span>
            <span>{meta.counts.pools ?? 0}</span>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Restore mode</p>
            <div className="flex gap-2">
              <Button
                variant={mode === "merge" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("merge")}
              >
                Merge
              </Button>
              <Button
                variant={mode === "replace" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("replace")}
              >
                Replace
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "merge"
                ? "Merge: updates matching records by ID, keeps anything not in the backup."
                : "Replace: wipes the existing configuration first, then restores this snapshot."}
            </p>
            {mode === "replace" && (
              <div className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-4 w-4" />
                This overwrites your current configuration. Consider downloading a backup first.
              </div>
            )}
          </div>

          <DialogTriggerButton
            mode={mode}
            busy={busy}
            onRestore={handleRestore}
            onCancel={reset}
          />
        </div>
      )}
    </div>
  );
}

function DialogTriggerButton({
  mode,
  busy,
  onRestore,
  onCancel,
}: {
  mode: RestoreMode;
  busy: boolean;
  onRestore: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} disabled={busy}>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Restore Backup
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Restore</DialogTitle>
          <DialogDescription>
            You are about to restore this backup in <strong>{mode}</strong> mode. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onRestore()}>
            {busy ? "Restoring..." : `Restore (${mode})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
