import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/calibration/options
 * Returns providers, each with its keys and models, so the
 * calibration session form can render the cascading
 * provider → key → model selectors. Calibration only needs
 * providers that actually have at least one key.
 */
export async function GET() {
  try {
    const providers = await prisma.provider.findMany({
      include: {
        apiKeys: {
          where: { status: { not: "DISABLED" } },
          select: {
            id: true,
            label: true,
            calibrated: true,
            lastCalibratedAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        providerModels: {
          where: { enabled: true },
          select: {
            id: true,
            displayName: true,
            contextWindow: true,
          },
          orderBy: { displayName: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    const options = providers
      .filter((p) => p.apiKeys.length > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        keys: p.apiKeys,
        models: p.providerModels,
      }));

    return NextResponse.json(options);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
