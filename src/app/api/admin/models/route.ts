import { NextRequest, NextResponse } from "next/server";
import { getAllModels, createProviderModel } from "@/engine/data-access/models";

export async function GET() {
  try {
    const models = await getAllModels();
    return NextResponse.json(models);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, modelId, displayName, supportsVision, supportsFunctionCalling, contextWindow, reliableToolCalling } = body;

    if (!providerId || !modelId) {
      return NextResponse.json(
        { error: "providerId and modelId are required" },
        { status: 400 }
      );
    }

    const model = await createProviderModel(providerId, {
      modelId,
      displayName: displayName || modelId,
      supportsVision: Boolean(supportsVision),
      supportsFunctionCalling: Boolean(supportsFunctionCalling),
      contextWindow: contextWindow != null ? Number(contextWindow) : undefined,
      reliableToolCalling: reliableToolCalling !== false,
    });
    return NextResponse.json(model, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
