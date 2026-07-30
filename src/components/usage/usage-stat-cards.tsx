import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Coins, ArrowUpRight, ArrowDownRight, Hash, CheckCircle2, XCircle } from "lucide-react";
import { RollingNumber } from "./rolling-number";

interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

interface UsageStatCardsProps {
  stats: UsageStats | null;
}

export function UsageStatCards({ stats }: UsageStatCardsProps) {
  if (!stats) return null;

  const cards = [
    { title: "Total Tokens", value: stats.totalTokens, icon: Coins, color: "text-violet-500" },
    { title: "Prompt Tokens", value: stats.promptTokens, icon: ArrowUpRight, color: "text-blue-500" },
    { title: "Completion Tokens", value: stats.completionTokens, icon: ArrowDownRight, color: "text-emerald-500" },
    { title: "Total Requests", value: stats.requestCount, icon: Hash, color: "text-amber-500" },
    { title: "Successful", value: stats.successCount, icon: CheckCircle2, color: "text-green-500" },
    { title: "Failed", value: stats.failureCount, icon: XCircle, color: "text-red-500" },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {c.title}
            </CardTitle>
            <c.icon className={`h-4 w-4 ${c.color}`} />
          </CardHeader>
          <CardContent>
            <RollingNumber value={c.value} className="text-2xl font-bold tabular-nums" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
