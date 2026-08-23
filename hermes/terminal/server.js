// ─── Hermes Terminal Server ───────────────────────────
// WebSocket terminal backed by a SINGLE persistent PTY session
// (see session.js). Every connection attaches to the same shell,
// so navigating between pages never erases previous output and
// the agent keeps running in the background.
//
//   ws://<host>:4007/terminal
//
// Handshake / protocol:
//   Client → server: {"type":"sync","offset":N}  (attach + replay point)
//   Client → server: {"type":"resize","cols":N,"rows":N}
//   Client → server: raw keystrokes (everything else)
//   Server → client: raw terminal byte-stream (ANSI intact)

const http = require("http");
const { WebSocketServer } = require("ws");
const session = require("./session");
const { runCalibrationSession } = require("../agent/calibration");

const PORT = Number(process.env.TERMINAL_PORT || 4007);
const ROUTER_ADMIN_URL = process.env.ROUTER_ADMIN_URL || "http://llm-router:4006/api/admin";
const CALIBRATION_POLL_MS = Number(process.env.CALIBRATION_POLL_MS || 5000);

// ─── Calibration auto-picker ───────────────────────────
// Polls the router for PENDING calibration sessions and runs
// them ONE at a time (the calibration model is provider-scoped).
// Each progress line is mirrored into the shared PTY terminal so
// the on-page terminal shows the Hermes agent's live activity.
// Guards against overlapping runs via the `calibrating` flag.

let calibrating = false;

async function processPendingCalibration() {
  if (calibrating) return;
  let res;
  try {
    res = await fetch(`${ROUTER_ADMIN_URL}/calibration/sessions?status=PENDING`);
  } catch {
    return;
  }
  if (!res.ok) return;
  const list = await res.json();
  const pending = Array.isArray(list) ? list.filter((s) => s.status === "PENDING") : [];
  if (pending.length === 0) return;

  calibrating = true;
  try {
    for (const s of pending) {
      session.broadcast(
        `\r\n\x1b[36m▶ Hermes calibration: ${s.provider?.name || s.providerId}\x1b[0m\r\n`
      );
      await runCalibrationSession(ROUTER_ADMIN_URL, s.id, (line) => {
        session.broadcast(`${line.replace(/^\[calibrate\] /, "")}\r\n`);
      });
    }
  } catch (err) {
    session.broadcast(`\r\n\x1b[31m✖ calibration error: ${err.message}\x1b[0m\r\n`);
  } finally {
    calibrating = false;
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hermes terminal server. Connect via WebSocket at /terminal");
});

const wss = new WebSocketServer({ server, path: "/terminal" });

wss.on("connection", (ws) => {
  let attached = false;

  ws.on("message", (data) => {
    const raw = data.toString();

    // Attach + replay handshake. Must arrive first so we know where
    // to resume the buffer from (0 for a fresh mount).
    if (raw.startsWith('{"type":"sync"')) {
      try {
        const m = JSON.parse(raw);
        session.attach(ws, m.offset);
      } catch {
        session.attach(ws, 0);
      }
      attached = true;
      return;
    }

    // Resize control frame.
    if (raw.startsWith('{"type":"resize"')) {
      try {
        const m = JSON.parse(raw);
        if (m.cols && m.rows) session.resize(m.cols, m.rows);
      } catch {}
      return;
    }

    // Everything else is raw input keystrokes.
    session.write(raw);
  });

  ws.on("close", () => {
    // Detach only — never kill the shared shell, so the agent keeps
    // running and its output stays buffered for the next visit.
    if (attached) session.detach(ws);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[terminal] Hermes terminal server listening on ws://0.0.0.0:${PORT}/terminal`);
  console.log(
    `[terminal] calibration auto-picker active (poll every ${CALIBRATION_POLL_MS}ms → ${ROUTER_ADMIN_URL})`
  );
  setInterval(processPendingCalibration, CALIBRATION_POLL_MS);
});
