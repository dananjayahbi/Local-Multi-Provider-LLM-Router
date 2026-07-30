import { NextRequest, NextResponse } from "next/server";
import { getModelsByProvider, createProviderModel } from "@/engine/data-access/models";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const models = await getModelsByProvider(id);
    return NextResponse.json(models);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { modelId, displayName, supportsVision, supportsFunctionCalling, contextWindow } = body;

    if (!modelId || !displayName) {
      return NextResponse.json(
        { error: "modelId and displayName are required" },
        { status: 400 }
      );
    }

    const model = await createProviderModel(id, {
      modelId,
      displayName,
      supportsVision,
      supportsFunctionCalling,
      contextWindow,
    });
    return NextResponse.json(model, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
