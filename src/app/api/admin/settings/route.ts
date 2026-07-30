import { NextRequest, NextResponse } from "next/server";
import { getAppSettings, updateAppSettings, regenerateGatewayKey } from "@/engine/data-access/settings";

export async function GET() {
  try {
    const settings = await getAppSettings();
    // Don't expose the full hash to the client
    return NextResponse.json({
      gatewayKeyPrefix: settings.unifiedGatewayKeyPrefix,
      penaltyBaseCooldownSeconds: settings.penaltyBaseCooldownSeconds,
      penaltyMultiplier: settings.penaltyMultiplier,
      penaltyMaxCooldownSeconds: settings.penaltyMaxCooldownSeconds,
      penaltyResetWindowSeconds: settings.penaltyResetWindowSeconds,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle gateway key regeneration
    if (body.action === "regenerate-key") {
      const { plaintext, prefix } = await regenerateGatewayKey();
      return NextResponse.json({ plaintextKey: plaintext, gatewayKeyPrefix: prefix });
    }

    // Handle settings update
    const settings = await updateAppSettings({
      penaltyBaseCooldownSeconds: body.penaltyBaseCooldownSeconds,
      penaltyMultiplier: body.penaltyMultiplier,
      penaltyMaxCooldownSeconds: body.penaltyMaxCooldownSeconds,
      penaltyResetWindowSeconds: body.penaltyResetWindowSeconds,
    });
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
