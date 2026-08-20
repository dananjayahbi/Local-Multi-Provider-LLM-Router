// ─── Copilot askQuestion Injection Builder ─────────────
// Tasks 06 & 07. Builds the ROUTER-GUIDANCE block that the gateway
// would append to the next outgoing request so the model surfaces a
// "hit a limit → switch vs. compact chat" decision via Copilot's
// askQuestion tool. This is experimental; phrasing is tuned in the
// Playground's Injection Lab.

import { LimitName } from "./types";

export interface InjectionInput {
  keyLabel: string;
  limitName: LimitName;
  nextKeyLabel: string | null;
  promptTokens: number;
  lastPromptTokens: number;
}

export const LIMIT_DISPLAY: Record<LimitName, string> = {
  RPM: "Requests Per Minute (RPM)",
  TPM: "Tokens Per Minute (TPM)",
  RPD: "Requests Per Day (RPD)",
  TPD: "Tokens Per Day (TPD)",
  CONTEXT: "Context Window",
};

/** Pre-defined, copyable guidance templates. */
export const INJECTION_TEMPLATES = {
  compact_first: (
    i: InjectionInput
  ): string => `[ROUTER-GUIDANCE]
The API key "${i.keyLabel}" just hit the ${LIMIT_DISPLAY[i.limitName]} limit
(prompt is ${i.promptTokens.toLocaleString()} tokens).
Before continuing, present the user with these two choices using the askQuestion tool:
  A. Continue on the next most reliable key (${i.nextKeyLabel ?? "auto"}) with the current,
     uncached context.
  B. Compact / summarize this chat first, then continue.
If the user picks B, tell them to use the summarization (compact) action, then continue on
the next key afterward.
[/ROUTER-GUIDANCE]`,

  direct_only: (
    i: InjectionInput
  ): string => `[ROUTER-GUIDANCE]
The API key "${i.keyLabel}" hit the ${LIMIT_DISPLAY[i.limitName]} limit. Rotate to the next
most reliable key (${i.nextKeyLabel ?? "auto"}). If the user prefers, they may compact the
chat first to reduce the (now uncached) ${i.promptTokens.toLocaleString()}-token context.
Present this as a single askQuestion with option "Go to the next one directly".
[/ROUTER-GUIDANCE]`,
};

export type TemplateName = keyof typeof INJECTION_TEMPLATES;

export function buildInjection(template: TemplateName, input: InjectionInput): string {
  return INJECTION_TEMPLATES[template](input);
}

/** The askQuestion options we expect the model to surface. */
export function expectedOptions(input: InjectionInput): string[] {
  return [
    `Go to the next one directly (${input.nextKeyLabel ?? "auto"})`,
    "Compact / summarize this chat first",
  ];
}
