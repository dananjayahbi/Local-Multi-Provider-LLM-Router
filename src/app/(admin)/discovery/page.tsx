"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Plus } from "lucide-react";
import { DraftBoard } from "@/components/discovery/draft-board";
import { CreateDraftDialog } from "@/components/discovery/create-draft-dialog";
import { ResearchTrigger } from "@/components/discovery/research-trigger";

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

export default function DiscoveryPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/drafts");
      const data = await res.json();
      setDrafts(data);
    } catch {
      setDrafts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const handleCreated = () => {
    setDialogOpen(false);
    loadDrafts();
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Provider Discovery</h1>
          <p className="text-muted-foreground">
            Review discovered endpoints and onboard new providers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadDrafts}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Draft
          </Button>
        </div>
      </div>

      <ResearchTrigger onTriggered={loadDrafts} />

      <DraftBoard drafts={drafts} onChanged={loadDrafts} />

      <CreateDraftDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={handleCreated} />
    </div>
  );
}
