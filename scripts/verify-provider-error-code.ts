// Regression test: numeric providerErrorCode must be coerced to a string so
// RequestLog.providerErrorCode (String?) doesn't throw a Prisma validation
// error on every log write — the cause of a phantom "pool exhausted" while all
// keys are still healthy.
import { chatCompletionsAdapter } from "../src/engine/adapters/chat-completions";
import { messagesAdapter } from "../src/engine/adapters/messages";
import { responsesAdapter } from "../src/engine/adapters/responses";
import { normalizeProviderErrorCode } from "../src/engine/canonical";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓", msg);
  } else {
    failed++;
    console.error("  ✗", msg);
  }
}

// 1) normalizeProviderErrorCode coercion
console.log("normalizeProviderErrorCode:");
assert(normalizeProviderErrorCode(404) === "404", "number 404 -> '404'");
assert(normalizeProviderErrorCode(null) === null, "null -> null");
assert(normalizeProviderErrorCode(undefined) === null, "undefined -> null");
assert(normalizeProviderErrorCode("rate_limit") === "rate_limit", "string passthrough");
assert(normalizeProviderErrorCode({ code: 429 }) === '{"code":429}', "object -> JSON string");
assert(normalizeProviderErrorCode(true) === "true", "boolean -> 'true'");
assert(typeof normalizeProviderErrorCode(404) === "string", "number result is a string");

// 2) each adapter's parseError produces a string code for a numeric error.code
const body = JSON.stringify({ error: { code: 404, message: "Model deprecated" } });
console.log("adapter parseError (numeric code 404):");
const cc = chatCompletionsAdapter.parseError(body, 404);
assert(typeof cc.providerErrorCode === "string", `chat-completions -> ${String(cc.providerErrorCode)}`);
const ms = messagesAdapter.parseError(body, 404);
assert(typeof ms.providerErrorCode === "string", `messages -> ${String(ms.providerErrorCode)}`);
const rs = responsesAdapter.parseError(body, 404);
assert(typeof rs.providerErrorCode === "string", `responses -> ${String(rs.providerErrorCode)}`);

// 3) string error.type stays a string (messages adapter reads raw.error?.type)
const bodyType = JSON.stringify({ error: { type: "invalid_request_error", message: "bad" } });
const msType = messagesAdapter.parseError(bodyType, 400);
assert(msType.providerErrorCode === "invalid_request_error", "messages type passthrough");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
