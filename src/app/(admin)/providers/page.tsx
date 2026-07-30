"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Server, Key, Box, ChevronRight } from "lucide-react";

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  _count: { apiKeys: number; providerModels: number };
}

export default function ProvidersPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiFormat: "CHAT_COMPLETIONS",
    notes: "",
  });

  const loadProviders = () => {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((data) => {
        setProviders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadProviders(); }, []);

  const handleCreate = async () => {
    const res = await fetch("/api/admin/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setOpen(false);
      setForm({ name: "", baseUrl: "", apiFormat: "CHAT_COMPLETIONS", notes: "" });
      loadProviders();
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Providers</h1>
          <p className="text-muted-foreground">Manage your upstream LLM providers</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Provider</DialogTitle>
            </DialogHeader>
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
                  onValueChange={(v) => setForm({ ...form, apiFormat: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHAT_COMPLETIONS">Chat Completions (OpenAI-compatible)</SelectItem>
                    <SelectItem value="MESSAGES">Messages (Anthropic-style)</SelectItem>
                    <SelectItem value="RESPONSES">Responses (New OpenAI)</SelectItem>
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
              <Button onClick={handleCreate} className="w-full">Create Provider</Button>
            </div>
          </DialogContent>
        </Dialog>
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
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => (
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
                    <Badge variant="outline">{p.apiFormat}</Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Key className="h-3 w-3" /> {p._count.apiKeys} keys
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Box className="h-3 w-3" /> {p._count.providerModels} models
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
