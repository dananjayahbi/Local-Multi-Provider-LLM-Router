// ─── Chat Data Access ──────────────────────────────────
// CRUD for chat sessions, messages, and uploaded files.
// Follows the same thin-wrapper pattern as the other
// data-access modules (discovery-requests, drafts, etc.).

import { prisma } from "@/lib/prisma";

// ─── Sessions ──────────────────────────────────────────

export async function getChatSessions(limit = 100) {
  return prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      _count: { select: { messages: true } },
    },
  });
}

export async function getChatSessionById(id: string) {
  return prisma.chatSession.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      files: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function createChatSession(title: string) {
  return prisma.chatSession.create({
    data: { title },
  });
}

export async function updateChatSessionTitle(id: string, title: string) {
  return prisma.chatSession.update({ where: { id }, data: { title } });
}

export async function deleteChatSession(id: string) {
  await prisma.chatSession.delete({ where: { id } });
}

// ─── Messages ──────────────────────────────────────────

export interface CreateChatMessageInput {
  sessionId: string;
  role: "USER" | "AGENT";
  kind?: "TEXT" | "ASSETS" | "ERROR";
  content: string;
  assets?: unknown[] | null;
}

export async function createChatMessage(data: CreateChatMessageInput) {
  return prisma.chatMessage.create({
    data: {
      sessionId: data.sessionId,
      role: data.role,
      kind: data.kind ?? "TEXT",
      content: data.content,
      assets: data.assets != null ? JSON.stringify(data.assets) : null,
    },
  });
}

export async function getChatMessages(sessionId: string, limit = 500) {
  return prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

// ─── Files ─────────────────────────────────────────────

export interface CreateChatFileInput {
  sessionId: string;
  name: string;
  mimeType: string;
  size: number;
  data: string; // base64
}

export async function createChatFile(data: CreateChatFileInput) {
  return prisma.chatFile.create({
    data: {
      sessionId: data.sessionId,
      name: data.name,
      mimeType: data.mimeType,
      size: data.size,
      data: data.data,
    },
  });
}

export async function getChatFiles(sessionId: string) {
  return prisma.chatFile.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteChatFile(id: string) {
  await prisma.chatFile.delete({ where: { id } });
}
