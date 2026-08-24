import { NextRequest, NextResponse } from "next/server";
import { createBackup, serializeBackup } from "@/engine/backup/backup";
import { restoreBackup, type RestoreMode } from "@/engine/backup/restore";
import type { BackupPayload } from "@/engine/backup/types";

// GET /api/admin/backup
// Download the full configuration snapshot as a JSON file attachment.
export async function GET() {
  try {
    const payload = await createBackup();
    const body = serializeBackup(payload);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="router-backup-${ts}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/admin/backup
// Restore a configuration snapshot. Body: { mode: "merge"|"replace", backup: <snapshot> }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const mode: RestoreMode = body.mode === "replace" ? "replace" : "merge";
    if (!body.backup) {
      return NextResponse.json({ error: "Missing 'backup' payload" }, { status: 400 });
    }
    const result = await restoreBackup(body.backup as BackupPayload, mode);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
