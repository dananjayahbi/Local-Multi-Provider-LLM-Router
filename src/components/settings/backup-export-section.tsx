"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { downloadBackup } from "./backup-api";

export function BackupExportSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadBackup();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Download a JSON snapshot of your entire router configuration — providers, API keys, models,
        pools, and settings. Use it to move to a new machine or keep a restore point.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleExport} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
        {busy ? "Preparing..." : "Download Backup"}
      </Button>
    </div>
  );
}
