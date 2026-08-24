"use client";

import React, { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Filter } from "lucide-react";
import { useLogsPolling } from "@/components/logs/use-logs-polling";
import { LogDetailPanel, type LogEntry } from "@/components/logs/log-detail-panel";

function OutcomeBadge({ outcome, classification }: { outcome: string; classification: string | null }) {
  if (outcome === "SUCCESS") return <Badge variant="success">Success</Badge>;
  return <Badge variant="destructive">{classification || "FAILURE"}</Badge>;
}

export default function LogsPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ outcome: "", errorClassification: "" });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const { data, loading, lastUpdated, refresh } = useLogsPolling(page, filters);

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logs</h1>
          <p className="text-muted-foreground">
            Request history and diagnostics{" "}
            {lastUpdated > 0 && (
              <span className="text-xs text-muted-foreground/70">
                · live · updated {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filters.outcome} onValueChange={(v) => setFilters((f) => ({ ...f, outcome: v }))}>
            <SelectTrigger className="w-32">
              <Filter className="mr-1 h-3 w-3" />
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="SUCCESS">Success</SelectItem>
              <SelectItem value="FAILURE">Failure</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.errorClassification} onValueChange={(v) => setFilters((f) => ({ ...f, errorClassification: v }))}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All errors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All errors</SelectItem>
              <SelectItem value="RATE_LIMITED">Rate Limited</SelectItem>
              <SelectItem value="QUOTA_EXCEEDED">Quota Exceeded</SelectItem>
              <SelectItem value="SERVER_ERROR">Server Error</SelectItem>
              <SelectItem value="NETWORK_ERROR">Network Error</SelectItem>
              <SelectItem value="AUTH_ERROR">Auth Error</SelectItem>
              <SelectItem value="INVALID_REQUEST">Invalid Request</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : !data || data.logs.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center">No request logs yet.</div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Key / Provider</TableHead>
                <TableHead>Pool</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.logs.map((log: LogEntry) => (
                <React.Fragment key={log.id}>
                  <TableRow className="cursor-pointer" onClick={() => toggleExpand(log.id)}>
                    <TableCell>
                      <ChevronDown className={`h-3 w-3 transition-transform ${expandedRows.has(log.id) ? "rotate-180" : ""}`} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.requestedVirtualModel}</TableCell>
                    <TableCell className="text-xs">
                      {log.apiKey?.label || "?"} @ {log.apiKey?.provider?.name || "?"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.pool?.name || "Direct"}
                    </TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={log.outcome} classification={log.errorClassification} />
                    </TableCell>
                    <TableCell className="text-xs">{log.latencyMs}ms</TableCell>
                    <TableCell className="text-xs">
                      {log.tier && <Badge variant="outline">{log.tier}</Badge>}
                    </TableCell>
                  </TableRow>
                  {expandedRows.has(log.id) && (
                    <TableRow key={`${log.id}-expand`}>
                      <TableCell colSpan={8} className="bg-muted/30 p-0">
                        <LogDetailPanel log={log} />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Page {data.page} of {data.totalPages} ({data.total} total)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => setPage(data.page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
