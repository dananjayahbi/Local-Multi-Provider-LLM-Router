import { BookOpen } from "lucide-react";
import { ArchitectureOverview } from "@/components/help/architecture-overview";
import { Scenarios } from "@/components/help/scenarios";

export const metadata = {
  title: "Help — LLM Router",
};

export default function HelpPage() {
  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <BookOpen className="h-6 w-6" /> Help
        </h1>
        <p className="text-muted-foreground">
          A guided tour of the LLM Router — how the system works, and what happens in every
          important scenario.
        </p>
      </div>

      {/* Architecture & engines */}
      <ArchitectureOverview />

      <hr className="border-border" />

      {/* Scenarios */}
      <Scenarios />
    </div>
  );
}
