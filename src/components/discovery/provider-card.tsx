"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, BookOpen } from "lucide-react";
import { Draft, parseDiscoveredModels } from "./discovery-types";

interface Props {
  draft: Draft;
  onReadMore: (draft: Draft) => void;
}

/** RAW-stage card (task 03): provider name, source URL, base URL, API type,
 *  and a "Read more" button that opens the detail popup. */
export function ProviderCard({ draft, onReadMore }: Props) {
  const models = parseDiscoveredModels(draft);
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <h3 className="font-semibold leading-tight">{draft.name}</h3>
          {draft.sourceUrl && (
            <a
              href={draft.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> {draft.sourceUrl}
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{draft.apiFormat}</Badge>
          <code className="truncate">{draft.baseUrl}</code>
        </div>

        {models.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {models.slice(0, 6).map((m) => (
              <Badge key={m.modelId} variant="secondary" className="text-xs">
                {m.modelId}
              </Badge>
            ))}
            {models.length > 6 && (
              <Badge variant="secondary" className="text-xs">
                +{models.length - 6}
              </Badge>
            )}
          </div>
        )}

        <div className="mt-auto pt-1">
          <Button variant="outline" size="sm" className="w-full" onClick={() => onReadMore(draft)}>
            <BookOpen className="mr-2 h-3 w-3" /> Read more
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
