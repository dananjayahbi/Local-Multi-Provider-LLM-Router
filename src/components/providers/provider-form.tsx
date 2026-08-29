"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  API_FORMATS,
  API_FORMAT_LABELS,
  type ApiFormat,
} from "@/lib/api-formats";

export interface ProviderFormValues {
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  notes: string;
}

export const EMPTY_PROVIDER_FORM: ProviderFormValues = {
  name: "",
  baseUrl: "",
  apiFormat: "CHAT_COMPLETIONS",
  notes: "",
};

interface ProviderFormProps {
  /** Initial values. When provided the form behaves as "edit". */
  initial?: Partial<ProviderFormValues>;
  /** Called on a successful submit. Handles the fetch + response. */
  onSubmit: (values: ProviderFormValues) => Promise<boolean>;
  submitLabel: string;
  submittingLabel?: string;
}

/**
 * Reusable provider form (name / base URL / API format / notes).
 * Used by both the "Add Provider" and "Edit Provider" dialogs. Keeps the
 * field markup in one place so the two flows stay identical.
 */
export function ProviderForm({
  initial,
  onSubmit,
  submitLabel,
  submittingLabel,
}: ProviderFormProps) {
  const [form, setForm] = useState<ProviderFormValues>({
    ...EMPTY_PROVIDER_FORM,
    ...initial,
  });
  const [busy, setBusy] = useState(false);

  // Re-sync when `initial` changes (e.g. dialog re-opened for a different provider).
  useEffect(() => {
    setForm({ ...EMPTY_PROVIDER_FORM, ...initial });
  }, [initial]);

  const canSubmit = form.name.trim() !== "" && form.baseUrl.trim() !== "" && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        apiFormat: form.apiFormat,
        notes: form.notes,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label>Provider Name</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g., Mimo, Gemini Free Tier"
        />
      </div>
      <div className="space-y-2">
        <Label>Base URL</Label>
        <Input
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
        />
      </div>
      <div className="space-y-2">
        <Label>API Format</Label>
        <Select
          value={form.apiFormat}
          onValueChange={(v) => setForm({ ...form, apiFormat: v as ApiFormat })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {API_FORMATS.map((f) => (
              <SelectItem key={f} value={f}>
                {API_FORMAT_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Notes (optional)</Label>
        <Input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Any notes about this provider"
        />
      </div>
      <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
        {busy ? submittingLabel ?? "Saving..." : submitLabel}
      </Button>
    </div>
  );
}
