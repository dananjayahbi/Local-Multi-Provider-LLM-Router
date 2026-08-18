// ─── DraftProvider Data Access ─────────────────────────

import { prisma } from "@/lib/prisma";

export interface CreateDraftInput {
  name: string;
  baseUrl: string;
  apiFormat: string;
  sourceUrl?: string | null;
  discoveredModels?: unknown[];
  notes?: string | null;
}

export async function getAllDrafts() {
  return prisma.draftProvider.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function getDraftById(id: string) {
  return prisma.draftProvider.findUnique({ where: { id } });
}

export async function createDraft(data: CreateDraftInput) {
  return prisma.draftProvider.create({
    data: {
      name: data.name,
      baseUrl: data.baseUrl,
      apiFormat: data.apiFormat,
      sourceUrl: data.sourceUrl,
      discoveredModels: JSON.stringify(data.discoveredModels ?? []),
      notes: data.notes,
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
    status: string;
    discoveredModels: unknown[];
    notes: string | null;
  }>
) {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.baseUrl !== undefined) updateData.baseUrl = data.baseUrl;
  if (data.apiFormat !== undefined) updateData.apiFormat = data.apiFormat;
  if (data.sourceUrl !== undefined) updateData.sourceUrl = data.sourceUrl;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.discoveredModels !== undefined) {
    updateData.discoveredModels = JSON.stringify(data.discoveredModels);
  }

  return prisma.draftProvider.update({ where: { id }, data: updateData });
}

export async function deleteDraft(id: string) {
  await prisma.draftProvider.delete({ where: { id } });
}
