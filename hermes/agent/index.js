// ─── Hermes Control Console ───────────────────────────
// Interactive REPL that controls the entire LLM Router.
// Unlike the old auto-discovery agent, this console does NOT
// search free-LLM-API lists on startup. It presents a prompt
// and lets you issue commands to manage providers, pools,
// drafts, keys, discovery, benchmarks, usage, logs, settings.

const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { dispatch, helpFor } = require("./commands");
const { style } = require("./ui");
const { isConfigured, LLM_MODEL } = require("./llm-client");
const { BASE: ROUTER_ADMIN_URL } = require("./router-client");

const BANNER = `
${style.bold(style.cyan("Hermes"))} — ${style.bold("LLM Router control console")}
  router admin : ${style.dim(ROUTER_ADMIN_URL)}
  llm          : ${isConfigured() ? style.green(LLM_MODEL) : style.red("not configured (HERMES_LLM_API_KEY)")}
  type ${style.bold("help")} to see commands, ${style.bold("exit")} to quit.
`;

async function main() {
  console.log(BANNER);
  console.log(helpFor());

  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });

  // Ctrl+C / EOF closes the readline → exit the console gracefully
  // instead of looping on a closed interface.
  rl.on("SIGINT", () => {
    console.log(style.yellow("\nBye."));
    process.exit(0);
  });

  while (true) {
    let line;
    try {
      line = await rl.question(style.green("hermes❯ "));
    } catch (err) {
      // Interface closed (EOF / Ctrl+D or similar) — stop the console.
      process.exit(0);
    }
    await dispatch(line);
  }
}

main();
