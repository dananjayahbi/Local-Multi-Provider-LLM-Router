// ─── DraftProvider Data Access ─────────────────────────
// The discovery pipeline (task 03-04):
//   RAW → APPROVED → CONFIGURED
// * RAW        — agent-discovered, informational card only
// * APPROVED   — user approved; a real Provider is created and API key(s)
//                can be configured (provider-level, shared across pools)
// * CONFIGURED — user pushed; models materialized as ProviderModel rows

import { prisma } from "@/lib/prisma";
import { ensurePoolKeyBackfill } from "./api-keys";

export interface CreateDraftInput {
  name: string;
  baseUrl: string;
  apiFormat: string;
  sourceUrl?: string | null;
  discoveredModels?: unknown[];
  details?: unknown;
  notes?: string | null;
  stage?: string;
}

export async function getAllDrafts() {
  await ensurePoolKeyBackfill();
  return prisma.draftProvider.findMany({
    include: {
      provider: {
        include: {
          apiKeys: { orderBy: { createdAt: "asc" as const } },
          providerModels: { orderBy: { displayName: "asc" as const } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDraftById(id: string) {
  return prisma.draftProvider.findUnique({
    where: { id },
    include: {
      provider: {
        include: {
          apiKeys: { orderBy: { createdAt: "asc" as const } },
          providerModels: { orderBy: { displayName: "asc" as const } },
        },
      },
    },
  });
}

export async function createDraft(data: CreateDraftInput) {
  return prisma.draftProvider.create({
    data: {
      name: data.name,
      baseUrl: data.baseUrl,
      apiFormat: data.apiFormat,
      sourceUrl: data.sourceUrl,
      discoveredModels: JSON.stringify(data.discoveredModels ?? []),
      details: data.details !== undefined ? JSON.stringify(data.details) : null,
      notes: data.notes,
      stage: data.stage ?? "RAW",
    },
  });
}

export async function updateDraft(
  id: string,
  data: Partial<{
    name: string;
    baseUrl: string;
    apiFormat: string;
    sourceUrl: string | null;
    stage: string;
    status: string;
    discoveredModels: unknown[];
    details: unknown;
    notes: string | null;
  }>
) {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.baseUrl !== undefined) updateData.baseUrl = data.baseUrl;
  if (data.apiFormat !== undefined) updateData.apiFormat = data.apiFormat;
  if (data.sourceUrl !== undefined) updateData.sourceUrl = data.sourceUrl;
  if (data.stage !== undefined) updateData.stage = data.stage;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.discoveredModels !== undefined) {
    updateData.discoveredModels = JSON.stringify(data.discoveredModels);
  }
  if (data.details !== undefined) {
    updateData.details = JSON.stringify(data.details);
  }

  return prisma.draftProvider.update({ where: { id }, data: updateData });
}

export async function deleteDraft(id: string) {
  await prisma.draftProvider.delete({ where: { id } });
}

// ─── Stage Transitions ─────────────────────────────────

/** RAW → APPROVED. Creates the real Provider record so provider-level API
 *  keys can be attached. Linking is non-destructive (SetNull on draft delete). */
export async function approveDraft(id: string) {
  const draft = await prisma.draftProvider.findUnique({ where: { id } });
  if (!draft) throw new Error("Draft not found");
  if (draft.stage === "CONFIGURED") return getDraftById(id);

  // Reuse the already-created provider if one exists (e.g. re-approving).
  let provider = await prisma.provider.findUnique({
    where: { draftProviderId: id },
  });

  if (!provider) {
    provider = await prisma.provider.create({
      data: {
        name: draft.name,
        baseUrl: draft.baseUrl,
        apiFormat: draft.apiFormat,
        notes: draft.notes,
        draftProviderId: draft.id,
      },
    });
  }

  return prisma.draftProvider.update({
    where: { id },
    data: { stage: "APPROVED" },
    include: {
      provider: {
        include: {
          apiKeys: { orderBy: { createdAt: "asc" as const } },
          providerModels: { orderBy: { displayName: "asc" as const } },
        },
      },
    },
  });
}

/** APPROVED → CONFIGURED. Materializes the (discovered or user-curated)
 *  models as ProviderModel rows on the linked Provider, then marks CONFIGURED.
 *  `baseUrl` (optional) lets the user correct the provider's endpoint before
 *  configuring (the discovery search may parse it incorrectly). */
export async function configureDraft(
  id: string,
  models: Array<{
    modelId: string;
    displayName?: string;
    supportsVision?: boolean;
    supportsFunctionCalling?: boolean;
    contextWindow?: number | null;
    enabled?: boolean;
  }>,
  baseUrl?: string
) {
  const draft = await prisma.draftProvider.findUnique({ where: { id } });
  if (!draft) throw new Error("Draft not found");

  // Ensure a Provider exists (in case configure is called directly).
  let provider = await prisma.provider.findUnique({
    where: { draftProviderId: id },
  });
  if (!provider) {
    provider = await prisma.provider.create({
      data: {
        name: draft.name,
        baseUrl: baseUrl || draft.baseUrl,
        apiFormat: draft.apiFormat,
        notes: draft.notes,
        draftProviderId: draft.id,
      },
    });
  } else if (baseUrl && baseUrl !== provider.baseUrl) {
    // User corrected the base URL — update the provider too.
    provider = await prisma.provider.update({
      where: { id: provider.id },
      data: { baseUrl },
    });
  }

  // Upsert by (providerId, modelId) to avoid duplicates on re-configure.
  for (const m of models) {
    const row = {
      providerId: provider.id,
      modelId: m.modelId,
      displayName: m.displayName || m.modelId,
      supportsVision: m.supportsVision ?? false,
      supportsFunctionCalling: m.supportsFunctionCalling ?? false,
      contextWindow: m.contextWindow ?? null,
      enabled: m.enabled ?? true,
    };
    const existing = await prisma.providerModel.findFirst({
      where: { providerId: provider.id, modelId: m.modelId },
    });
    if (existing) {
      await prisma.providerModel.update({ where: { id: existing.id }, data: row });
    } else {
      await prisma.providerModel.create({ data: row });
    }
  }

  return prisma.draftProvider.update({
    where: { id },
    data: {
      stage: "CONFIGURED",
      // Persist the (possibly corrected) base URL on the draft too.
      baseUrl: baseUrl && baseUrl !== draft.baseUrl ? baseUrl : undefined,
      discoveredModels: JSON.stringify(models),
    },
    include: {
      provider: {
        include: {
          apiKeys: { orderBy: { createdAt: "asc" as const } },
          providerModels: { orderBy: { displayName: "asc" as const } },
        },
      },
    },
  });
}

/** Reject a draft (RAW/APPROVED → REJECTED). */
export async function rejectDraft(id: string) {
  return prisma.draftProvider.update({ where: { id }, data: { stage: "REJECTED" } });
}
