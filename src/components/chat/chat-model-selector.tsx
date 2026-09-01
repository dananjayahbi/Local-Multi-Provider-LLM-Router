"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChatModel } from "./chat-types";

interface Props {
  models: ChatModel[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/** Dropdown to pick which configured model to chat with. */
export function ChatModelSelector({ models, selectedId, onSelect, disabled }: Props) {
  return (
    <Select value={selectedId} onValueChange={onSelect} disabled={disabled}>
      <SelectTrigger className="w-full sm:w-80">
        <SelectValue placeholder="Select a model…" />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.displayName} — {m.provider.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
