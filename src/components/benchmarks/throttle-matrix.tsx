"use client";

import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface MatrixEntry {
  apiKeyId: string;
  apiKeyLabel: string;
  providerName: string;
  status: string;
  calibrated: boolean;
  lastCalibratedAt: string | null;
  latestBenchmark: {
    ttftMs: number;
    avgTps: number;
    latencyDriftRatio: number;
    isThrottled: boolean;
    passed: boolean;
    testedAt: string;
  } | null;
}

interface Config {
  targetTps: number;
  targetRpm: number;
  ttftDriftThreshold: number;
  tpsDriftThreshold: number;
}

export function ThrottleMatrix({ matrix, config }: { matrix: MatrixEntry[]; config?: Config }) {
  if (matrix.length === 0) {
    return <p className="text-sm text-muted-foreground">No API keys registered yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Calibrated</TableHead>
          <TableHead>TTFT (ms)</TableHead>
          <TableHead>TPS</TableHead>
          <TableHead>Drift Ratio</TableHead>
          <TableHead>Throttled</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {matrix.map((entry) => {
          const b = entry.latestBenchmark;
          return (
            <TableRow key={entry.apiKeyId}>
              <TableCell className="font-medium">{entry.apiKeyLabel}</TableCell>
              <TableCell>{entry.providerName}</TableCell>
              <TableCell>
                <Badge variant={entry.status === "ACTIVE" ? "success" : "secondary"}>
                  {entry.status}
                </Badge>
              </TableCell>
              <TableCell>
                {entry.calibrated ? (
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="text-xs">Calibrated</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>{b ? b.ttftMs : "—"}</TableCell>
              <TableCell>{b ? b.avgTps.toFixed(1) : "—"}</TableCell>
              <TableCell>{b ? b.latencyDriftRatio.toFixed(2) : "—"}</TableCell>
              <TableCell>
                {b ? (
                  b.isThrottled ? (
                    <Badge variant="destructive">Throttled</Badge>
                  ) : (
                    <Badge variant="success">OK</Badge>
                  )
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                {b ? (
                  b.passed ? (
                    <Badge variant="success">Passed</Badge>
                  ) : (
                    <Badge variant="destructive">Failed</Badge>
                  )
                ) : (
                  "Not tested"
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
