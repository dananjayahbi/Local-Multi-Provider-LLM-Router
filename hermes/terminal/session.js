// ─── Persistent Terminal Session ──────────────────────
// A single long-lived PTY that survives client disconnects.
//
// The plain shell is spawned lazily on first attach and is NOT
// killed when the last WebSocket client leaves. This means:
//   • Navigating away from the page keeps the shell / agent alive.
//   • Returning to the page re-attaches to the SAME session.
//   • The accumulated output buffer is replayed so previous chat
//     output is never erased.
//
// No auto-start: we do NOT write `hermes` here. The page simply
// presents a normal bash prompt; the user runs `hermes` manually.

const os = require("os");
const pty = require("node-pty");

const SHELL = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");
const CWD = "/app";
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const MAX_BUFFER = 200000; // ~200 KB of scrollback kept for replay

class TerminalSession {
  constructor() {
    this.clients = new Set();
    // Scrollback buffer: array of { text, absStart } where absStart is
    // the absolute character offset of text within the whole stream.
    this.buffer = [];
    this.totalBytes = 0;
    this.term = null;
  }

  /** Lazily spawn (or respawn) the persistent shell. */
  ensureSpawned() {
    if (this.term) return;
    const term = pty.spawn(SHELL, SHELL.includes("bash") ? ["-l"] : [], {
      name: "xterm-256color",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: CWD,
      env: process.env,
    });
    this.term = term;

    term.onData((data) => {
      this.append(data);
      for (const client of this.clients) {
        try {
          client.send(data);
        } catch {}
      }
    });

    // When the shell exits (e.g. the user typed `exit`), drop the
    // reference and respawn a fresh prompt shortly after. The buffer
    // is preserved, so history is never lost.
    term.onExit(() => {
      this.term = null;
      setTimeout(() => this.ensureSpawned(), 50);
    });
  }

  /** Append output to the scrollback buffer, trimming old data. */
  append(data) {
    this.buffer.push({ text: data, absStart: this.totalBytes });
    this.totalBytes += data.length;
    while (
      this.buffer.length > 1 &&
      this.totalBytes - this.buffer[0].absStart > MAX_BUFFER
    ) {
      this.buffer.shift();
    }
  }

  /**
   * Attach a client. Replays the buffer starting from `offset`
   * (the character offset the client has already seen), so both
   * fresh mounts (offset 0) and within-page reconnects (nonzero)
   * render exactly the right content.
   */
  attach(client, offset) {
    this.clients.add(client);
    this.ensureSpawned();
    const from = Math.max(0, Number(offset) || 0);
    for (const chunk of this.buffer) {
      const end = chunk.absStart + chunk.text.length;
      if (end <= from) continue;
      const start = Math.max(0, from - chunk.absStart);
      try {
        client.send(chunk.text.slice(start));
      } catch {}
    }
  }

  detach(client) {
    this.clients.delete(client);
  }

  resize(cols, rows) {
    if (this.term) {
      try {
        this.term.resize(cols, rows);
      } catch {}
    }
  }

  write(data) {
    if (this.term) {
      try {
        this.term.write(data);
      } catch {}
    }
  }
}

// Export a single shared instance so every WebSocket connection
// (and every page visit) talks to the same persistent shell.
module.exports = new TerminalSession();
