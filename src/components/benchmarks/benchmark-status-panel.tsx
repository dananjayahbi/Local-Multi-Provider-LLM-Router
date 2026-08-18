"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock } from "lucide-react";

interface ActiveBenchmark {
  apiKeyId: string;
  providerId: string;
  startedAt: number;
  stage: string;
}

interface Status {
  running: boolean;
  active: ActiveBenchmark[];
  queueLength: number;
  maxParallelTests: number;
}

export function BenchmarkStatusPanel({ status }: { status?: Status }) {
  if (!status) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Active Tests</CardTitle>
        </CardHeader>
        <CardContent>
          {status.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active benchmarks</p>
          ) : (
            <ul className="space-y-2">
              {status.active.map((a) => (
                <li key={a.apiKeyId} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <code className="text-xs">{a.apiKeyId.slice(0, 8)}</code>
                  </span>
                  <Badge variant="secondary">{a.stage}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Testing Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-2xl font-bold">{status.queueLength}</span>
            <span className="text-muted-foreground">keys waiting</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Concurrency</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-2xl font-bold">
              {status.active.length}/{status.maxParallelTests}
            </span>
            <span className="text-muted-foreground">parallel tests</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
