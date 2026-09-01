// ─── Backup / Restore API client helpers ────────────────
// Thin client-side wrappers around the backup endpoints so the
// settings panel can stay declarative.

import type { BackupPayload } from "@/engine/backup/types";

export interface BackupMetaInfo {
  version: number;
  createdAt: string;
  counts: Record<string, number>;
}

export interface RestoreResult {
  mode: "merge" | "replace";
  counts: Record<string, number>;
}

/** Download the full config snapshot as a JSON file. */
export async function downloadBackup(): Promise<void> {
  const res = await fetch("/api/admin/backup", { method: "GET" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Failed to create backup");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `router-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Validate an uploaded backup without writing to the DB. */
export async function previewBackup(payload: BackupPayload): Promise<BackupMetaInfo> {
  const res = await fetch("/api/admin/backup/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backup: payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Backup is not valid");
  return data.meta as BackupMetaInfo;
}

/** Apply a backup. mode: "merge" upserts; "replace" wipes config first. */
export async function applyRestore(
  payload: BackupPayload,
  mode: "merge" | "replace"
): Promise<RestoreResult> {
  const res = await fetch("/api/admin/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, backup: payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Restore failed");
  return data as RestoreResult;
}
