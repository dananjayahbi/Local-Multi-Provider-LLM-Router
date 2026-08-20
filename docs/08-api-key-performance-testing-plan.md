# Document 08 — API Key Functionality & Performance Testing Tool (Plan)

> **Purpose**: Tracked plan for implementing the API key functionality & performance testing tool described by the user. This extends the existing Autonomous Benchmarking & Discovery subsystem.
> **Last Updated**: 2026-08-19
> **Status**: PLANNED (not yet implemented)

---

## 1. Scope Summary

Build a **background performance-testing tool** that simulates an agentic coding workflow against each API key to determine its real-world capability. It measures:

- **Time to First Token (TTFT)**
- **Requests per Minute (RPM)**
- **Tokens per Minute (TPM)**
- **Gateway-level throttling** (silent speed throttling that doesn't throw errors)

The tool runs in the background, marks keys as "in use" during testing so normal routing skips them, applies a smart penalty level after testing, and supports parallel testing of multiple keys. It integrates an internal AI agent (Hermes) with MCP tools (DuckDuckGo search, Fetch, Context7) to run tests intelligently and set configs.

---

## 2. Design Principles (from user requirements)

1. **Local & personal use** — security is not a primary concern.
2. **Background execution** — tests run in the background; keys are marked so normal routing skips them until released.
3. **Smart penalty** — after measurement, the system sets a penalty level based on findings (the key may be exhausted by the test).
4. **Waiting/cooldown mechanism** — e.g., after testing RPM, let the key cool down before testing TPM.
5. **Parallel testing** — test multiple keys with the same workflow simultaneously.
6. **Satisfaction-based early stop** — don't test absolute ceilings; if a metric satisfies the max required value, pass and move to the next test (with cooldown).
7. **Configurable targets** — test values (e.g., 60 TPS for DeepSeek) are configurable in Settings.
8. **AI agent integration** — an internal agent runs tests smartly and sets configs; uses MCPs (DuckDuckGo, Fetch, Context7).
9. **Known-source exploration** — the agent explores known websites/repos for free API keys and reports them on a detailed page for the user to review and hand over keys.
10. **Docker sandbox** — the whole system lives inside a Docker container.

---

## 3. Architecture Decisions

### 3.1 New/Extended Database Models

| Model | Purpose | Key Fields |
|---|---|---|
| `ApiKeyBenchmark` (extend) | Add per-stage metrics | `ttftMs`, `avgTps`, `rpm`, `tpm`, `latencyDriftRatio`, `isThrottled`, `passed`, `failureReason`, `testedAt` |
| `BenchmarkConfig` (extend) | Add configurable targets | `targetTps`, `targetRpm`, `targetTpm`, `maxParallelTests`, `stageCooldownSeconds`, `satisfactionThreshold` |
| `BenchmarkRun` (new) | A full multi-stage test run | `apiKeyId`, `status`, `stages`, `startedAt`, `completedAt`, `result` |
| `BenchmarkStage` (new) | Individual stage results | `runId`, `stage` (TTFT/RPM/TPM), `passed`, `metrics`, `cooldownBeforeNext` |
| `DiscoveryReport` (new) | Known-source exploration results | `sourceUrl`, `providerName`, `apiType`, `requestType`, `notes`, `status` (REVIEW/ACCEPTED) |

### 3.2 New Engine Modules

| Module | Path | Responsibility |
|---|---|---|
| `benchmark/workflow.ts` | `src/engine/benchmark/workflow.ts` | Agentic coding workflow simulation script |
| `benchmark/stage-runner.ts` | `src/engine/benchmark/stage-runner.ts` | Per-stage execution (TTFT, RPM, TPM) with cooldown |
| `benchmark/parallel-scheduler.ts` | `src/engine/benchmark/parallel-scheduler.ts` | Parallel multi-key testing with per-key marking |
| `benchmark/smart-penalty.ts` | `src/engine/benchmark/smart-penalty.ts` | AI-informed penalty level calculation |
| `discovery/known-sources.ts` | `src/engine/discovery/known-sources.ts` | Known websites/repos exploration |
| `discovery/report.ts` | `src/engine/discovery/report.ts` | Discovery report CRUD |

### 3.3 New API Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/admin/benchmarks/runs` | GET, POST | List/trigger benchmark runs |
| `/api/admin/benchmarks/runs/[id]` | GET | Run detail with stage progress |
| `/api/admin/discovery/reports` | GET, POST | Discovery reports list/create |
| `/api/admin/discovery/reports/[id]` | PUT, DELETE | Report review/accept/reject |

### 3.4 New UI Pages

| Route | Purpose |
|---|---|
| `/benchmarks/runs` | Live multi-key test progress & logs |
| `/discovery/reports` | Known-source exploration reports for key handover |

---

## 4. Implementation Phases

### Phase 1 — Workflow Simulation & Stage Runner
- [ ] Build `benchmark/workflow.ts` — agentic coding workflow script (multi-turn tool calls)
- [ ] Build `benchmark/stage-runner.ts` — TTFT/RPM/TPM stage execution with cooldown
- [ ] Extend `ApiKeyBenchmark` schema with RPM/TPM metrics
- [ ] Add `BenchmarkRun` / `BenchmarkStage` models

### Phase 2 — Parallel Scheduler & Key Marking
- [ ] Build `benchmark/parallel-scheduler.ts` — parallel multi-key testing
- [ ] Mark keys as `TESTING` during runs; exclude from routing
- [ ] Implement satisfaction-based early stop (pass if target met)
- [ ] Implement per-stage cooldown/waiting mechanism

### Phase 3 — Smart Penalty & Config
- [ ] Build `benchmark/smart-penalty.ts` — AI-informed penalty level
- [ ] Extend `BenchmarkConfig` with configurable targets (TPS/RPM/TPM)
- [ ] Add Settings UI for test targets
- [ ] Integrate Hermes agent to run tests and set configs

### Phase 4 — Known-Source Discovery & Reports
- [ ] Build `discovery/known-sources.ts` — known websites/repos exploration
- [ ] Build `discovery/report.ts` — report CRUD
- [ ] Add `/discovery/reports` page for key handover
- [ ] Add `/benchmarks/runs` page for progress & logs

---

## 5. Key Design Details

### 5.1 Agentic Workflow Simulation
The test simulates a back-and-forth agentic coding workflow:
1. Send a system prompt + user task
2. Receive tool-call response
3. Execute the tool (simulated)
4. Send tool result back
5. Repeat for N turns

This measures realistic TTFT, TPS, and throughput under agentic load.

### 5.2 Gateway Throttle Detection
Aggregate all response times against the expected time (from a pilot run with a known-good key) to detect silent throttling. Keys that throttle without errors get flagged and penalized.

### 5.3 Satisfaction-Based Early Stop
If a metric satisfies the configured max required value (e.g., 60 TPS), the stage passes immediately and moves to the next stage (after cooldown). No need to test absolute ceilings.

### 5.4 Parallel Testing & Key Marking
Multiple keys are tested in parallel with the same workflow. During testing, keys are marked `TESTING` so normal routing skips them. After testing, a smart penalty level is applied based on findings.

### 5.5 AI Agent (Hermes) Integration
Hermes runs tests intelligently, understands results, and sets configs. It uses:
- **DuckDuckGo MCP** — internet search
- **Fetch MCP** — web page content
- **Context7 MCP** — updated documentation

### 5.6 Known-Source Exploration
The agent explores known websites and GitHub repos for free API keys, reports them on a detailed page. The user reviews, grabs keys, and hands them to the agent to set up. After review, keys move to an accepted group where the user pastes them on the spot (the agent already identified API type, request type, etc.).

---

## 6. Dependencies & Notes

- Extends the existing `ApiKeyBenchmark`, `BenchmarkConfig`, and `DraftProvider` models.
- Reuses the existing Hermes agent, MCP server, and Docker setup.
- The whole system lives inside the existing Docker containers.
- Follows the modular component approach — each module in its own file.
