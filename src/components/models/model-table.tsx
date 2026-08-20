"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2, Eye, Braces, Power } from "lucide-react";
import { EditModelDialog } from "./edit-model-dialog";

export interface ModelRow {
  id: string;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  contextWindow: number | null;
  enabled: boolean;
  provider: { id: string; name: string; baseUrl: string; apiFormat: string };
}

interface Props {
  models: ModelRow[];
  onChanged: () => void;
}

/** Models table (task 06): lists every configured model across providers.
 *  Models here are the source of truth for pool creation. Supports editing
 *  each model after it has been listed. */
export function ModelTable({ models, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<ModelRow | null>(null);

  const handleToggle = async (m: ModelRow) => {
    setBusy(m.id);
    try {
      await fetch(`/api/admin/models/${m.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !m.enabled }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (m: ModelRow) => {
    if (!confirm(`Delete model ${m.modelId}?`)) return;
    setBusy(m.id);
    try {
      const res = await fetch(`/api/admin/models/${m.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Delete failed");
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-muted-foreground">
        <Eye className="h-6 w-6" />
        <p className="text-sm">No models configured yet. Add one manually or via Discovery.</p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model ID</TableHead>
            <TableHead>Display Name</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Capabilities</TableHead>
            <TableHead className="text-right">Context</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => (
          <TableRow key={m.id}>
            <TableCell className="font-mono text-sm">{m.modelId}</TableCell>
            <TableCell>{m.displayName}</TableCell>
            <TableCell>
              <div className="text-sm">{m.provider.name}</div>
              <div className="text-xs text-muted-foreground">{m.provider.apiFormat}</div>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                {m.supportsVision && <Badge variant="outline">vision</Badge>}
                {m.supportsFunctionCalling && <Badge variant="outline">function-calling</Badge>}
              </div>
            </TableCell>
            <TableCell className="text-right text-sm">
              {m.contextWindow ? m.contextWindow.toLocaleString() : "∞"}
            </TableCell>
            <TableCell>
              <Button variant="ghost" size="icon" onClick={() => handleToggle(m)} disabled={busy === m.id}>
                <Power className={`h-4 w-4 ${m.enabled ? "text-green-600" : "text-muted-foreground"}`} />
              </Button>
            </TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="icon" onClick={() => setEditing(m)} disabled={busy === m.id}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(m)} disabled={busy === m.id}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        </TableBody>
      </Table>
      <EditModelDialog
        model={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={onChanged}
      />
    </>
  );
}
