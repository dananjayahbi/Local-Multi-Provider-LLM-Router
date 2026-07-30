"use client";

import React, { useEffect, useState } from "react";
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
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Filter,
} from "lucide-react";

interface LogEntry {
  id: string;
  outcome: string;
  errorClassification: string | null;
  httpStatus: number | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  requestedVirtualModel: string;
  tier: string | null;
  createdAt: string;
  apiKey?: { id: string; label: string; provider: { name: string } } | null;
  pool?: { id: string; name: string } | null;
  providerModel?: { id: string; displayName: string } | null;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function OutcomeBadge({ outcome, classification }: { outcome: string; classification: string | null }) {
  if (outcome === "SUCCESS") return <Badge variant="success">Success</Badge>;
  return <Badge variant="destructive">{classification || "FAILURE"}</Badge>;
}

export default function LogsPage() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    outcome: "",
    errorClassification: "",
  });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const loadLogs = async (p: number = page) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("pageSize", "50");
    if (filters.outcome) params.set("outcome", filters.outcome);
    if (filters.errorClassification) params.set("errorClassification", filters.errorClassification);

    const res = await fetch(`/api/admin/logs?${params.toString()}`);
    const result = await res.json();
    setData(result);
    setLoading(false);
  };

  useEffect(() => { loadLogs(page); }, [page, filters]);

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
          <p className="text-muted-foreground">Request history and diagnostics</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filters.outcome} onValueChange={(v) => setFilters({ ...filters, outcome: v })}>
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
          <Select value={filters.errorClassification} onValueChange={(v) => setFilters({ ...filters, errorClassification: v })}>
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
          <Button variant="outline" size="icon" onClick={() => loadLogs(page)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
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
                <TableHead>Outcome</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.logs.map((log) => (
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
                      <TableCell colSpan={7} className="bg-muted/30">
                        <div className="grid grid-cols-3 gap-2 text-xs py-2 px-4">
                          <div>
                            <span className="text-muted-foreground">HTTP Status:</span>{" "}
                            {log.httpStatus || "N/A"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Pool:</span>{" "}
                            {log.pool?.name || "Direct"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Model:</span>{" "}
                            {log.providerModel?.displayName || "N/A"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Prompt Tokens:</span>{" "}
                            {log.promptTokens ?? "?"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Completion Tokens:</span>{" "}
                            {log.completionTokens ?? "?"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Error:</span>{" "}
                            {log.errorClassification || "None"}
                          </div>
                        </div>
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
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => setPage(data.page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => setPage(data.page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
