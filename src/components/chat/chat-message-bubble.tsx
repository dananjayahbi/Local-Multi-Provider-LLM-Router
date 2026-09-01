"use client";

import { cn } from "@/lib/utils";
import { Bot, User, Loader2, AlertTriangle } from "lucide-react";
import { ChatMessage } from "./chat-types";

interface Props {
  message: ChatMessage;
}

/** A single chat bubble (user or assistant). Streaming shows a blinking caret;
 *  errors render in destructive styling. */
export function ChatMessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  if (message.error) {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[80%] items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="text-destructive">{message.error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[80%] items-start gap-2 rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border bg-card text-card-foreground"
        )}
      >
        <span className="mt-0.5 shrink-0">
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </span>
        <div className="whitespace-pre-wrap wrap-break-word">
          {message.content}
          {message.streaming && (
            <span className="ml-0.5 inline-block animate-pulse">▍</span>
          )}
          {message.streaming && message.content === "" && (
            <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
          )}
        </div>
      </div>
    </div>
  );
}
