"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatModelSelector } from "./chat-model-selector";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import { ChatModel, ChatMessage } from "./chat-types";

/** Chat page (task): select a configured model and chat directly with it.
 *  Requests run through the orchestrator so usage is recorded in /usage. */
export function ChatPage() {
  const [models, setModels] = useState<ChatModel[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/models");
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setModels(list);
      if (list.length > 0 && !list.some((m: ChatModel) => m.id === selectedId)) {
        setSelectedId(list[0].id);
      }
    } catch {
      setModels([]);
    }
    setLoading(false);
  }, [selectedId]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleSend = async (text: string) => {
    if (!selectedId || streaming) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setStreaming(true);

    const history: ChatMessage[] = [
      ...messages.filter((m) => !m.streaming && !m.error),
      { role: "user", content: text },
    ];

    const body = {
      providerModelId: selectedId,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    try {
      const res = await fetch("/api/admin/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        let message = "Request failed";
        try {
          const data = await res.json();
          message = data.error?.message || message;
        } catch {}
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: "", error: message },
        ]);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = {
                  ...last,
                  content: last.content + delta,
                };
                return next;
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: "", error: "Network error while streaming." },
        ]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.streaming ? { ...m, streaming: false } : m
        )
      );
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleClear = () => {
    if (streaming) return;
    setMessages([]);
  };

  const selectedModel = models.find((m) => m.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
          <p className="text-muted-foreground">
            {selectedModel
              ? `${selectedModel.displayName} — ${selectedModel.provider.name}`
              : "Pick a model to begin"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadModels} title="Refresh models">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear} disabled={streaming}>
            Clear
          </Button>
        </div>
      </div>

      <ChatModelSelector
        models={models}
        selectedId={selectedId}
        onSelect={setSelectedId}
        disabled={loading || streaming}
      />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <ChatMessageList messages={messages} />
          <ChatInput
            disabled={loading || !selectedId}
            streaming={streaming}
            onSend={handleSend}
            onStop={handleStop}
          />
        </CardContent>
      </Card>
    </div>
  );
}
