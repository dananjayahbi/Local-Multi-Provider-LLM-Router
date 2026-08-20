"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Plus, Inbox } from "lucide-react";
import { DraftBoard } from "@/components/discovery/draft-board";
import { CreateDraftDialog } from "@/components/discovery/create-draft-dialog";
import { ResearchTrigger } from "@/components/discovery/research-trigger";
import { ProviderCard } from "@/components/discovery/provider-card";
import { ProviderDetailDialog } from "@/components/discovery/provider-detail-dialog";
import { ApprovedProviderCard } from "@/components/discovery/approved-provider-card";
import { ConfiguredProviderCard } from "@/components/discovery/configured-provider-card";
import { Draft, STAGES } from "@/components/discovery/discovery-types";
import {
  DiscoveryFilterBar,
  matchesDiscoveryFilters,
  DiscoveryFilters,
} from "@/components/discovery/discovery-filter-bar";

export default function DiscoveryPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailDraft, setDetailDraft] = useState<Draft | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filters, setFilters] = useState<DiscoveryFilters>({ query: "", format: "" });

  const loadDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/drafts");
      const data = await res.json();
      setDrafts(Array.isArray(data) ? data : []);
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

  const handleApprove = async (draft: Draft) => {
    const res = await fetch(`/api/admin/drafts/${draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (res.ok) {
      setDetailOpen(false);
      setDetailDraft(null);
      loadDrafts();
    }
  };

  const handleReject = async (draft: Draft) => {
    if (!confirm(`Reject ${draft.name}?`)) return;
    const res = await fetch(`/api/admin/drafts/${draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    if (res.ok) {
      setDetailOpen(false);
      setDetailDraft(null);
      loadDrafts();
    }
  };

  const filteredDrafts = drafts.filter((d) => matchesDiscoveryFilters(d, filters));

  const byStage = (stage: string) =>
    filteredDrafts.filter((d) => d.stage === stage);

  const stageMeta: Record<string, { title: string; desc: string; variant: "default" | "warning" | "success" }> = {
    RAW: { title: "Raw Findings", desc: "Agent-discovered providers", variant: "default" },
    APPROVED: { title: "Approved", desc: "Set API keys, then configure", variant: "warning" },
    CONFIGURED: { title: "Configured", desc: "Models ready for pools", variant: "success" },
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Provider Discovery</h1>
          <p className="text-muted-foreground">
            Review agent findings → approve → set API keys → configure models
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadDrafts}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Provider
          </Button>
        </div>
      </div>

      <ResearchTrigger onTriggered={loadDrafts} />

      <DiscoveryFilterBar
        value={filters}
        onChange={setFilters}
        totalCount={filteredDrafts.length}
      />

      {/* ── 3-stage pipeline columns ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {STAGES.map((stage) => {
          const meta = stageMeta[stage];
          const items = byStage(stage);
          return (
            <div key={stage} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">{meta.title}</h2>
                  <p className="text-xs text-muted-foreground">{meta.desc}</p>
                </div>
                <Badge variant={meta.variant}>{items.length}</Badge>
              </div>

              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-muted-foreground">
                  <Inbox className="h-5 w-5" />
                  <span className="text-xs">Empty</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {items.map((draft) => {
                    if (stage === "RAW") {
                      return (
                        <ProviderCard
                          key={draft.id}
                          draft={draft}
                          onReadMore={(d) => {
                            setDetailDraft(d);
                            setDetailOpen(true);
                          }}
                        />
                      );
                    }
                    if (stage === "APPROVED") {
                      return <ApprovedProviderCard key={draft.id} draft={draft} onChanged={loadDrafts} />;
                    }
                    return <ConfiguredProviderCard key={draft.id} draft={draft} onChanged={loadDrafts} />;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legacy board kept for drafts stuck in old statuses (REJECTED) */}
      <DraftBoard drafts={filteredDrafts.filter((d) => d.stage === "REJECTED")} onChanged={loadDrafts} />

      <ProviderDetailDialog
        draft={detailDraft}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      <CreateDraftDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={handleCreated} />
    </div>
  );
}
