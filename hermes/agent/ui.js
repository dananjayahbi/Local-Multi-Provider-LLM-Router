// ─── Console UI Helpers ───────────────────────────────
// Small ANSI + table formatting helpers so the REPL stays
// readable without pulling in any dependencies.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

function color(code, text) {
  return `${code}${text}${RESET}`;
}

const style = {
  bold: (t) => color(BOLD, t),
  dim: (t) => color(DIM, t),
  red: (t) => color(RED, t),
  green: (t) => color(GREEN, t),
  yellow: (t) => color(YELLOW, t),
  blue: (t) => color(BLUE, t),
  magenta: (t) => color(MAGENTA, t),
  cyan: (t) => color(CYAN, t),
  gray: (t) => color(GRAY, t),
};

/** Render a list of rows as an aligned ASCII table. */
function table(headers, rows) {
  if (!rows || rows.length === 0) return style.dim("(no data)");
  const cols = headers.map((h) => h.length);
  for (const row of rows) {
    headers.forEach((_, i) => {
      const v = String(row[i] ?? "");
      cols[i] = Math.max(cols[i], v.length);
    });
  }
  const line = (cells) =>
    cells.map((c, i) => c.padEnd(cols[i])).join("  ").trimEnd();
  const sep = cols.map((c) => "-".repeat(c)).join("  ");
  const out = [style.bold(line(headers)), style.dim(sep)];
  for (const row of rows) out.push(line(row.map((v, i) => String(v ?? ""))));
  return out.join("\n");
}

/** Key/value block renderer for single-object views. */
function kv(pairs) {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs
    .map(([k, v]) => `  ${style.cyan(k.padEnd(width))} : ${v}`)
    .join("\n");
}

/** Format a boolean as green check / red cross. */
function flag(v) {
  return v ? style.green("yes") : style.red("no");
}

/** Truncate a string to a max width. */
function truncate(s, n = 40) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

module.exports = { style, table, kv, flag, truncate, RESET };
