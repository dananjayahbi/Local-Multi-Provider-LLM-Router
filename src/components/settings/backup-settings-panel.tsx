"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatabaseBackup } from "lucide-react";
import { BackupExportSection } from "./backup-export-section";
import { BackupRestoreSection } from "./backup-restore-section";

export function BackupSettingsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4" /> Backup &amp; Restore
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold mb-1">Export</h3>
          <BackupExportSection />
        </div>
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-1">Restore</h3>
          <BackupRestoreSection />
        </div>
      </CardContent>
    </Card>
  );
}
