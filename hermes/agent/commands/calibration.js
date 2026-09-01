// ─── Calibration Commands ──────────────────────────────
// Manage agent-driven rate-limit calibration sessions:
// list sessions, run pending ones (research-only, no key
// stressing), and inspect a session's findings.

const api = require("../router-client");
const { runCalibrationSession } = require("../calibration");
const { style, table, truncate } = require("../ui");

/** List recent calibration sessions. */
async function listSessions() {
  const sessions = await api.get("/calibration/sessions");
  const rows = sessions.map((s) => [
    s.id,
    s.provider?.name || s.providerId,
    truncate(s.apiKey?.label || s.apiKeyId, 16),
    s.providerModel?.displayName || s.providerModelId,
    s.status || "-",
    s.applied ? "applied" : "-",
    s.createdAt ? String(s.createdAt).slice(0, 16) : "-",
  ]);
  console.log(table(["ID", "PROVIDER", "KEY", "MODEL", "STATUS", "APPLIED", "CREATED"], rows));
}

/** Run all PENDING calibration sessions (one at a time). */
async function runPending() {
  const pending = await api.get("/calibration/sessions?status=PENDING");
  const list = Array.isArray(pending) ? pending : [];
  const onlyPending = list.filter((s) => s.status === "PENDING");
  if (onlyPending.length === 0) {
    console.log(style.dim("No pending calibration sessions."));
    return;
  }
  console.log(style.dim(`Running ${onlyPending.length} pending calibration session(s)…`));
  for (const s of onlyPending) {
    console.log(style.cyan(`▶ calibrating ${s.provider?.name || s.providerId}…`));
    await runCalibrationSession(api.BASE, s.id);
  }
}

/** Show a single session's findings. */
async function showSession(id) {
  const s = await api.get(`/calibration/sessions/${id}`);
  console.log(table(
    ["FIELD", "VALUE"],
    [
      ["id", s.id],
      ["provider", s.provider?.name || s.providerId],
      ["key", s.apiKey?.label || s.apiKeyId],
      ["model", s.providerModel?.displayName || s.providerModelId],
      ["status", s.status],
      ["applied", String(s.applied)],
      ["created", String(s.createdAt)],
    ]
  ));
  if (s.findings) {
    console.log(style.bold("\nFindings:"));
    console.log(s.findings);
  }
}

const help = `calibration commands:
  calibrate              list calibration sessions
  calibrate run          run all PENDING calibration sessions
  calibrate show <id>    show a session's findings`;

module.exports = {
  name: "calibrate",
  help,
  async run(sub, args) {
    if (sub === "run") return runPending();
    if (sub === "show") {
      if (!args[0]) throw new Error("usage: calibrate show <sessionId>");
      return showSession(args[0]);
    }
    if (sub === "list") return listSessions();
    return listSessions();
  },
};
