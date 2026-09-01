"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Trash2, CheckCircle2, XCircle, KeyRound } from "lucide-react";

interface Draft {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  sourceUrl: string | null;
  status: string;
  discoveredModels: string;
  notes: string | null;
  createdAt: string;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "success" | "destructive" | "warning"> = {
  PENDING_KEY: "warning",
  TESTING: "secondary",
  ACCEPTED: "success",
  REJECTED: "destructive",
};

export function DraftBoard({ drafts, onChanged }: { drafts: Draft[]; onChanged: () => void }) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});

  const handleValidate = async (draft: Draft) => {
    const secret = secrets[draft.id];
    if (!secret) return;
    setValidating((v) => ({ ...v, [draft.id]: true }));
    try {
      await fetch(`/api/admin/drafts/${draft.id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      onChanged();
    } finally {
      setValidating((v) => ({ ...v, [draft.id]: false }));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    await fetch(`/api/admin/drafts/${id}`, { method: "DELETE" });
    onChanged();
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/admin/drafts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REJECTED" }),
    });
    onChanged();
  };

  if (drafts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            No draft providers yet. Run the Hermes agent or add a draft manually.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {drafts.map((draft) => {
        let models: string[] = [];
        try {
          const parsed = JSON.parse(draft.discoveredModels);
          models = Array.isArray(parsed) ? parsed.map((m) => m.modelId || m) : [];
        } catch {
          models = [];
        }

        return (
          <Card key={draft.id}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">{draft.name}</CardTitle>
                <code className="text-xs text-muted-foreground">{draft.baseUrl}</code>
              </div>
              <Badge variant={STATUS_VARIANTS[draft.status] ?? "secondary"}>{draft.status}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">{draft.apiFormat}</Badge>
                {draft.sourceUrl && (
                  <a
                    href={draft.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Source
                  </a>
                )}
              </div>

              {models.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {models.map((m) => (
                    <Badge key={m} variant="secondary" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              )}

              {draft.status === "PENDING_KEY" && (
                <div className="space-y-2">
                  <Label className="text-xs">API Key Secret</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="Paste API key..."
                      value={secrets[draft.id] ?? ""}
                      onChange={(e) => setSecrets({ ...secrets, [draft.id]: e.target.value })}
                    />
                    <Button
                      size="sm"
                      onClick={() => handleValidate(draft)}
                      disabled={!secrets[draft.id] || validating[draft.id]}
                    >
                      <KeyRound className="mr-1 h-3 w-3" />
                      {validating[draft.id] ? "Validating..." : "Validate"}
                    </Button>
                  </div>
                </div>
              )}

              {draft.status === "ACCEPTED" && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" /> Validated & onboarded
                </div>
              )}
              {draft.status === "REJECTED" && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <XCircle className="h-4 w-4" /> Rejected
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                {draft.status === "PENDING_KEY" && (
                  <Button variant="outline" size="sm" onClick={() => handleReject(draft.id)}>
                    Reject
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => handleDelete(draft.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
