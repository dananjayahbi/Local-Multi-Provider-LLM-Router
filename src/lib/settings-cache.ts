// ─── AppSettings Read Cache ─────────────────────────────
// `appSettings` is a singleton row that changes only via the admin UI. Reading
// it on every gateway request added a Prisma round-trip to the pre-dispatch hot
// path (a TTFT cost). We cache it in-process with a short TTL.
//
// Auth is still verified cryptographically against the (possibly slightly
// stale) hash, and admin writes call `invalidateAppSettingsCache()` so a key
// rotation takes effect immediately within the same process.

import { prisma } from "@/lib/prisma";

type AppSettingsRow = NonNullable<
  Awaited<ReturnType<typeof prisma.appSettings.findUnique>>
>;

const TTL_MS = 30_000;

let cache: { value: AppSettingsRow; at: number } | null = null;
let inflight: Promise<AppSettingsRow | null> | null = null;

export async function getAppSettingsCached(): Promise<AppSettingsRow | null> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = prisma.appSettings
    .findUnique({ where: { id: "singleton" } })
    .then((value) => {
      if (value) cache = { value, at: Date.now() };
      return value;
    })
    .catch(() => cache?.value ?? null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function invalidateAppSettingsCache(): void {
  cache = null;
}
