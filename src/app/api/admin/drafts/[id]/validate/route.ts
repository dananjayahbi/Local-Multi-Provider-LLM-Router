import { NextRequest, NextResponse } from "next/server";
import { getDraftById, updateDraft } from "@/engine/data-access/drafts";
import { createProvider } from "@/engine/data-access/providers";
import { createApiKey } from "@/engine/data-access/api-keys";
import { createProviderModel } from "@/engine/data-access/models";
import { createQuickPool } from "@/engine/data-access/pools";
import { prisma } from "@/lib/prisma";

/**
 * Validates & onboards a draft provider.
 * Body: { secret: string, virtualModelName?: string }
 *
 * Creates the Provider, adds the supplied API key, creates the
 * discovered models, and optionally creates a quick pool.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.secret) {
      return NextResponse.json({ error: "secret is required" }, { status: 400 });
    }

    const draft = await getDraftById(id);
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    // Mark draft as testing
    await updateDraft(id, { status: "TESTING" });

    // Parse discovered models
    let models: Array<{ modelId: string; displayName?: string }> = [];
    try {
      const parsed = JSON.parse(draft.discoveredModels);
      if (Array.isArray(parsed)) models = parsed;
    } catch {
      models = [];
    }

    // Create the provider
    const provider = await createProvider({
      name: draft.name,
      baseUrl: draft.baseUrl,
      apiFormat: draft.apiFormat,
      notes: draft.notes ?? `Discovered from ${draft.sourceUrl ?? "unknown source"}`,
    });

    // Add the API key
    await createApiKey(provider.id, {
      label: `${draft.name} key`,
      secret: body.secret,
      rpmLimit: null,
      tpmLimit: null,
    });

    // Create discovered models
    const createdModels: string[] = [];
    for (const m of models) {
      if (!m.modelId) continue;
      const model = await createProviderModel(provider.id, {
        modelId: m.modelId,
        displayName: m.displayName ?? m.modelId,
      });
      createdModels.push(model.id);
    }

    // Create a quick pool if a virtual model name was provided
    if (body.virtualModelName && createdModels.length > 0) {
      await createQuickPool(createdModels[0], body.virtualModelName);
    }

    // Mark draft as accepted
    await updateDraft(id, { status: "ACCEPTED" });

    return NextResponse.json({
      success: true,
      providerId: provider.id,
      modelCount: createdModels.length,
    });
  } catch (err) {
    // On failure, mark draft as rejected
    try {
      const { id } = await params;
      await updateDraft(id, { status: "REJECTED" });
    } catch {}
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
