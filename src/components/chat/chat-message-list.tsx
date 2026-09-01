"use client";

import { useEffect, useRef } from "react";
import { ChatMessageBubble } from "./chat-message-bubble";
import { ChatMessage } from "./chat-types";

interface Props {
  messages: ChatMessage[];
}

/** Scrollable list of chat bubbles. Auto-scrolls to the newest message. */
export function ChatMessageList({ messages }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a model and start chatting. Responses will be recorded in Usage.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((m, i) => (
        <ChatMessageBubble key={i} message={m} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
