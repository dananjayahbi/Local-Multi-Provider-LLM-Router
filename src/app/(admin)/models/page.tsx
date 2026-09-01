"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Plus } from "lucide-react";
import { ModelTable, ModelRow } from "@/components/models/model-table";
import { AddModelDialog } from "@/components/models/add-model-dialog";
import { SortSelect } from "@/components/ui/sort-select";
import {
  ModelFilterBar,
  matchesModelFilters,
  ModelFilters,
} from "@/components/models/model-filter-bar";

function isModelSort(v: string): v is "createdAt" | "name" {
  return v === "createdAt" || v === "name";
}

export default function ModelsPage() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [filters, setFilters] = useState<ModelFilters>({
    query: "",
    providerId: "",
    capability: "",
    status: "",
  });
  const [sortKey, setSortKey] = useState<string>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    try {
      const [mRes, pRes] = await Promise.all([
        fetch("/api/admin/models"),
        fetch("/api/admin/providers"),
      ]);
      const m = await mRes.json();
      const p = await pRes.json();
      setModels(Array.isArray(m) ? m : []);
      setProviders(Array.isArray(p) ? p : []);
    } catch {
      setModels([]);
      setProviders([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  const filteredModels = models
    .filter((m) => matchesModelFilters(m, filters))
    .sort((a, b) => {
      const key = isModelSort(sortKey) ? sortKey : "createdAt";
      let cmp = 0;
      if (key === "name") cmp = a.provider.name.localeCompare(b.provider.name);
      else {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        cmp = at - bt;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Models</h1>
          <p className="text-muted-foreground">
            All configured models across providers — the source of truth for pool creation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Model
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <ModelFilterBar
          value={filters}
          onChange={setFilters}
          providers={providers}
          totalCount={filteredModels.length}
        />
        <SortSelect
          options={[
            { value: "createdAt", label: "Created date" },
            { value: "name", label: "Provider name" },
          ]}
          value={sortKey}
          dir={sortDir}
          onValueChange={setSortKey}
          onDirChange={setSortDir}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          {models.length > 0 && filteredModels.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-muted-foreground">
              <p className="text-sm">No models match your current filters.</p>
            </div>
          ) : (
            <ModelTable models={filteredModels} onChanged={load} />
          )}
        </CardContent>
      </Card>

      <AddModelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        providers={providers}
        onCreated={load}
      />
    </div>
  );
}
