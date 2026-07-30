// ─── API Key Data Access ───────────────────────────────

import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

export async function getKeysByProvider(providerId: string) {
  return prisma.apiKey.findMany({
    where: { providerId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getKeyById(id: string) {
  return prisma.apiKey.findUnique({ where: { id } });
}

export async function createApiKey(
  providerId: string,
  data: { label: string; secret: string }
) {
  const secretEncrypted = encrypt(data.secret);
  return prisma.apiKey.create({
    data: {
      providerId,
      label: data.label,
      secretEncrypted,
    },
  });
}

export async function updateApiKey(
  id: string,
  data: { label?: string; secret?: string }
) {
  const updateData: Record<string, unknown> = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.secret !== undefined) {
    updateData.secretEncrypted = encrypt(data.secret);
  }
  return prisma.apiKey.update({ where: { id }, data: updateData });
}

export async function deleteApiKey(id: string) {
  await prisma.apiKey.delete({ where: { id } });
}
