"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * A real interactive terminal backed by xterm.js that connects
 * to the persistent Hermes PTY terminal server over WebSocket.
 *
 * The server keeps a single long-lived shell, so leaving the page
 * and coming back re-attaches to the SAME session and replays the
 * accumulated output — previous work is never erased. Hermes is NOT
 * auto-started; the user runs it manually from the prompt.
 *
 * NOTE: This component must be loaded via `next/dynamic` with
 * `ssr: false` because xterm.js touches the DOM at import time.
 */
export function HermesTerminal({
  wsUrl,
  wsPath = "/terminal",
}: {
  wsUrl?: string;
  wsPath?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Character offset of the terminal stream already shown. Persists
  // across within-page reconnects; resets to 0 on a fresh mount, which
  // tells the server to replay the full buffer.
  const offsetRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#000000",
        foreground: "#e6e6e6",
        cursor: "#00ff00",
        green: "#00ff00",
      },
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;
    term.focus();

    // Determine the terminal server origin.
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname || "localhost";
    const url = wsUrl || `${proto}://${host}:4007${wsPath}`;

    let ws: WebSocket | null = null;
    let closed = false;
    // Serializes async message processing so the offset count stays
    // consistent even when Blob/ArrayBuffer frames arrive.
    let chain: Promise<void> = Promise.resolve();

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(url);
      } catch {
        setTimeout(connect, 3000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        // Tell the server where to resume the buffer from. A fresh
        // mount sends 0 (full replay); a within-page reconnect sends
        // the last offset (delta only).
        ws?.send(JSON.stringify({ type: "sync", offset: offsetRef.current }));
        // Ensure the PTY matches the fitted size right away.
        if (term.cols && term.rows) {
          ws?.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
        term.focus();
      };
      ws.onmessage = (e) => {
        const data = e.data;
        chain = chain.then(() => {
          let text: string;
          if (typeof data === "string") {
            text = data;
          } else if (data instanceof Blob) {
            return data.text().then((t) => {
              term.write(t);
              offsetRef.current += t.length;
            });
          } else if (data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(data);
          } else {
            return;
          }
          term.write(text);
          offsetRef.current += text.length;
        });
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
    };

    connect();

    // Send keystrokes to the PTY.
    const inputDisposable = term.onData((data) => {
      wsRef.current?.send(data);
    });

    // Keep the PTY dimensions in sync with the container.
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const onWindowResize = () => {
      try {
        fitAddon.fit();
      } catch {}
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      closed = true;
      window.removeEventListener("resize", onWindowResize);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      try {
        ws?.close();
      } catch {}
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [wsUrl, wsPath]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-black p-1" />;
}
