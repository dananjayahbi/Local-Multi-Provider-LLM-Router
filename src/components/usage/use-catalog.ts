"use client";

import { useEffect, useState } from "react";

export interface CatalogKey {
  id: string;
  label: string;
  providerName: string;
  poolNames: string[];
  requestsLastHour: number;
  hasLimits: boolean;
}

/**
 * Fetches the rate-limit catalog (all keys + provider/pool metadata) once.
 * Shared by the picker and the mesh so key options stay consistent.
 */
export function useCatalog() {
  const [catalog, setCatalog] = useState<CatalogKey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/rate-limits/catalog")
      .then((r) => r.json())
      .then((data: CatalogKey[]) => {
        if (!active) return;
        setCatalog(data);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { catalog, loading };
}
