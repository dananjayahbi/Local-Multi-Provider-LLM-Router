"use client";

import { useEffect, useRef, useState } from "react";

interface MermaidDiagramProps {
  /** Raw Mermaid source (no ``` fences). */
  chart: string;
  /** Optional caption rendered below the diagram. */
  caption?: string;
}

/**
 * Client-side Mermaid renderer. Mermaid only runs in the browser, so this is
 * a "use client" component that lazily imports `mermaid` and renders into a
 * ref'd div. Re-renders when `chart` changes.
 */
export function MermaidDiagram({ chart, caption }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "default",
          flowchart: { htmlLabels: true, curve: "basis" },
        });
        const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
        const rendered = await mermaid.render(id, chart);
        if (!cancelled && rendered.svg) {
          setSvg(rendered.svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-red-300 p-4 text-xs text-red-600 dark:text-red-400">
        <p className="font-semibold mb-1">Could not render diagram</p>
        <p className="font-mono">{error}</p>
      </div>
    );
  }

  return (
    <figure className="my-4">
      <div
        ref={containerRef}
        className="overflow-x-auto rounded-lg border bg-white dark:bg-slate-950 p-4"
        // Mermaid output is a bound SVG; inject safely via innerHTML (only
        // after mermaid sanitizes it under securityLevel: "loose").
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {caption && (
        <figcaption className="mt-2 text-center text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
