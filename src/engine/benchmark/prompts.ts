// ─── Synthetic Agentic Workflow Prompts ────────────────
// Multi-turn, multi-tool synthetic prompt loop that mimics
// real agent workload behavior for benchmarking.

import { CanonicalMessage, CanonicalTool } from "../canonical";

/**
 * Stage 1: TTFT & single-turn latency test.
 * A complex code-analysis prompt that forces the model to
 * produce a substantial first token quickly.
 */
export function buildStage1Messages(): CanonicalMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a senior software architect. Analyze code carefully and provide detailed, structured responses.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            "Analyze the following TypeScript function for performance bottlenecks, race conditions, " +
            "and memory leaks. Provide a line-by-line breakdown and suggest concrete optimizations:\n\n" +
            "```typescript\n" +
            "async function processBatch(items: Item[], concurrency = 5) {\n" +
            "  const results: Result[] = [];\n" +
            "  const queue = [...items];\n" +
            "  const workers = Array.from({ length: concurrency }, async () => {\n" +
            "    while (queue.length > 0) {\n" +
            "      const item = queue.shift();\n" +
            "      if (!item) break;\n" +
            "      const data = await fetchData(item.id);\n" +
            "      const transformed = transform(data);\n" +
            "      results.push(transformed);\n" +
            "    }\n" +
            "  });\n" +
            "  await Promise.all(workers);\n" +
            "  return results;\n" +
            "}\n" +
            "```",
        },
      ],
    },
  ];
}

/**
 * Stage 2: TPS & multi-turn tool generation test.
 * Simulates a tool-calling workflow where the model must
 * produce a tool call, then synthesize a solution.
 */
export function buildStage2Messages(): CanonicalMessage[] {
  return [
    {
      role: "system",
      content:
        "You are an autonomous coding agent. Use the provided tools to gather information, then synthesize a complete solution.",
    },
    {
      role: "user",
      content:
        "I need to refactor a legacy Node.js REST API to use TypeScript with proper error handling. " +
        "First, search the codebase for all route handlers that lack try/catch blocks. Then propose a " +
        "complete refactoring plan with code examples.",
    },
    {
      role: "assistant",
      content:
        "I'll search the codebase for route handlers that lack error handling, then propose a refactoring plan.",
    },
    {
      role: "user",
      content:
        "Found 12 route handlers without error handling:\n" +
        "- src/routes/users.ts: lines 15, 42, 78\n" +
        "- src/routes/orders.ts: lines 8, 33, 61, 95\n" +
        "- src/routes/products.ts: lines 12, 29, 55, 88, 120\n\n" +
        "Now write the complete refactored version of src/routes/users.ts with proper async error handling, " +
        "input validation, and consistent response formatting. Include all imports and export statements.",
    },
  ];
}

/**
 * Stage 3: RPM / TPM burst verification.
 * A short, high-frequency prompt used to test request rate limits.
 */
export function buildStage3Messages(): CanonicalMessage[] {
  return [
    {
      role: "system",
      content: "You are a concise assistant. Respond in under 20 words.",
    },
    {
      role: "user",
      content: "Reply with the word 'ok' followed by a random number between 1 and 100.",
    },
  ];
}

/**
 * Tool definitions used in the synthetic agentic workflow.
 */
export function buildBenchmarkTools(): CanonicalTool[] {
  return [
    {
      type: "function",
      function: {
        name: "search_codebase",
        description: "Search the codebase for files matching a pattern.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex pattern to search for" },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute file path" },
          },
          required: ["path"],
        },
      },
    },
  ];
}
