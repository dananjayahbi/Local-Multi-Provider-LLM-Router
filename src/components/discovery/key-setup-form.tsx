"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/pools/copy-button";
import { KeyRound, Plus, Trash2, ShieldCheck, Settings2 } from "lucide-react";
import { ProviderApiKey } from "./discovery-types";
import { KeyLimitsDialog } from "./key-limits-dialog";

interface Props {
  providerId: string;
  keys: ProviderApiKey[];
  onChanged: () => void;
}

/** Approved-stage key configuration (task 04). Sets a PROVIDER-LEVEL API key
 *  (shared across pools — task 05). The key secret is always copyable. Each
 *  key also gets a per-key rate/token limit editor (RPM, TPM, TPD, context,
 *  etc.) since limits differ per provider. */
export function KeySetupForm({ providerId, keys, onChanged }: Props) {
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [limitsKey, setLimitsKey] = useState<ProviderApiKey | null>(null);

  const handleAdd = async () => {
    if (!secret.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/providers/${providerId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || "Provider key",
          secret: secret.trim(),
          rpmLimit: null,
          tpmLimit: null,
        }),
      });
      setSecret("");
      setLabel("");
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this API key?")) return;
    await fetch(`/api/admin/keys/${id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            placeholder="e.g. Production key"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-xs">API Key Secret</Label>
          <Input
            placeholder="Paste provider API key..."
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
        <Button
          size="icon"
          onClick={handleAdd}
          disabled={!secret.trim() || saving}
          className="mt-5"
          title="Add key"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {keys.length === 0 ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3 w-3" /> No API keys set yet. Add one above to enable routing.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-3 w-3 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{k.label}</span>
                </div>
                {k.secret && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <code className="truncate">{k.secret.slice(0, 8)}…</code>
                    <CopyButton value={k.secret} />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLimitsKey(k)}
                  title="Edit rate/token limits"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(k.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <KeyLimitsDialog
        keyData={limitsKey}
        onOpenChange={(open) => !open && setLimitsKey(null)}
        onSaved={onChanged}
      />
    </div>
  );
}
