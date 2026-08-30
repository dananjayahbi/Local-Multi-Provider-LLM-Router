"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Server, Key, Box, ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  ProviderForm,
  type ProviderFormValues,
} from "@/components/providers/provider-form";
import { DeleteProviderDialog } from "@/components/providers/delete-provider-dialog";
import { apiFormatLabel } from "@/lib/api-formats";
import { SearchInput } from "@/components/ui/search-input";
import { SortSelect } from "@/components/ui/sort-select";

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  notes: string | null;
  createdAt: string;
  _count: { apiKeys: number; providerModels: number };
}

export default function ProvidersPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  // Delete dialog
  const [deleting, setDeleting] = useState<Provider | null>(null);

  // Search + sort state
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const loadProviders = useCallback(() => {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((data) => {
        setProviders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleCreate = async (values: ProviderFormValues) => {
    const res = await fetch("/api/admin/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) {
      setCreateOpen(false);
      loadProviders();
      return true;
    }
    const err = await res.json().catch(() => ({ error: "Failed to create provider" }));
    alert(err.error || "Failed to create provider");
    return false;
  };

  const openEdit = (provider: Provider) => {
    setEditing(provider);
    setEditOpen(true);
  };

  const handleEdit = async (values: ProviderFormValues) => {
    if (!editing) return false;
    const res = await fetch(`/api/admin/providers/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) {
      setEditOpen(false);
      setEditing(null);
      loadProviders();
      return true;
    }
    const err = await res.json().catch(() => ({ error: "Failed to update provider" }));
    alert(err.error || "Failed to update provider");
    return false;
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  const q = query.trim().toLowerCase();
  const filteredProviders = providers
    .filter((p) => !q || `${p.name} ${p.baseUrl} ${p.apiFormat}`.toLowerCase().includes(q))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
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
          <h1 className="text-2xl font-bold tracking-tight">Providers</h1>
          <p className="text-muted-foreground">Manage your upstream LLM providers</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Provider
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Provider</DialogTitle>
            </DialogHeader>
            <ProviderForm
              onSubmit={handleCreate}
              submitLabel="Create Provider"
              submittingLabel="Creating..."
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search providers..."
          className="w-full max-w-xs"
        />
        <SortSelect
          options={[
            { value: "createdAt", label: "Created date" },
            { value: "name", label: "Name" },
          ]}
          value={sortKey}
          dir={sortDir}
          onValueChange={setSortKey}
          onDirChange={setSortDir}
        />
      </div>

      {providers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Server className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No providers configured yet.</p>
            <p className="text-sm text-muted-foreground">
              Add your first provider to start routing LLM requests.
            </p>
          </CardContent>
        </Card>
      ) : filteredProviders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <p className="text-sm">No providers match your current search.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredProviders.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push(`/providers/${p.id}`)}
            >
              <CardContent className="flex items-center justify-between p-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{p.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{apiFormatLabel(p.apiFormat)}</Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Key className="h-3 w-3" /> {p._count.apiKeys} keys
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Box className="h-3 w-3" /> {p._count.providerModels} models
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEdit(p)}
                    title="Edit provider"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setDeleting(p)}
                    title="Delete provider"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Provider</DialogTitle>
          </DialogHeader>
          {editing && (
            <ProviderForm
              initial={{
                name: editing.name,
                baseUrl: editing.baseUrl,
                apiFormat: editing.apiFormat as ProviderFormValues["apiFormat"],
                notes: editing.notes ?? "",
              }}
              onSubmit={handleEdit}
              submitLabel="Save Changes"
              submittingLabel="Saving..."
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteProviderDialog
        provider={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={loadProviders}
      />
    </div>
  );
}
