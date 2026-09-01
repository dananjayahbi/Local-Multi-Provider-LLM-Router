"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/pools/copy-button";
import { KeyRound, RefreshCw } from "lucide-react";

interface PoolGatewayKeyProps {
  gatewayKey: string | undefined;
  gatewayKeyPrefix?: string;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

/**
 * Displays the pool's plaintext gateway key (always shown fully + copyable)
 * with an optional "Regenerate key" action.
 */
export function PoolGatewayKey({ gatewayKey, gatewayKeyPrefix, onRegenerate, regenerating }: PoolGatewayKeyProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="h-4 w-4" /> Gateway Key
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!gatewayKey ? (
          <p className="text-sm text-muted-foreground">No gateway key set for this pool.</p>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <code className="flex-1 break-all font-mono text-sm">{gatewayKey}</code>
            <CopyButton value={gatewayKey} className="shrink-0" />
          </div>
        )}
        {gatewayKeyPrefix && (
          <p className="mt-1 text-xs text-muted-foreground">
            Masked preview: <code className="bg-muted px-1 rounded">{gatewayKeyPrefix}</code>
          </p>
        )}
        {onRegenerate && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRegenerate} disabled={regenerating}>
            <RefreshCw className={`mr-1 h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating..." : "Regenerate key"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
