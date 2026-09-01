"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square } from "lucide-react";

interface Props {
  disabled?: boolean;
  streaming?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/** Message composer: textarea that grows, Enter to send / Shift+Enter for newline. */
export function ChatInput({ disabled, streaming, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px";
    }
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setText("");
    onSend(trimmed);
  };

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        placeholder="Type a message…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        className="flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
      {streaming ? (
        <Button size="icon" onClick={onStop} title="Stop">
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          size="icon"
          onClick={submit}
          disabled={disabled || !text.trim()}
          title="Send"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
