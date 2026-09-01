import { NextRequest, NextResponse } from "next/server";
import type { BackupPayload } from "@/engine/backup/types";

// POST /api/admin/backup/preview
// Validate a backup payload and return its meta (counts) WITHOUT writing
// anything to the database. Used by the restore UI to confirm a file is a
// well-formed snapshot before the user commits to a restore.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = body.backup as BackupPayload;

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid backup payload" }, { status: 400 });
    }
    if (!Array.isArray(payload.providers)) {
      return NextResponse.json({ error: "Backup missing 'providers'" }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      meta: payload.meta ?? {
        version: 0,
        createdAt: new Date().toISOString(),
        counts: {
          providers: payload.providers.length,
          apiKeys: (payload.apiKeys ?? []).length,
          providerModels: (payload.providerModels ?? []).length,
          pools: (payload.pools ?? []).length,
          poolApiKeys: (payload.poolApiKeys ?? []).length,
          poolMembers: (payload.poolMembers ?? []).length,
          appSettings: payload.appSettings ? 1 : 0,
          benchmarkConfig: payload.benchmarkConfig ? 1 : 0,
        },
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
