# Document 06 — Implementation Plan: Autonomous Benchmarking & Discovery

> **Purpose**: Tracked plan for implementing `Autonomous_Benchmarking_Discovery_Architecture.md`. This is the source of truth to keep the large refactor on track.
> **Last Updated**: 2026-08-18

---

## 1. Scope Summary

Implement the Autonomous Benchmarking, Silent Throttle Engine, and Agentic Provider Discovery subsystem across 4 phases:

| Phase | Focus | Deliverables |
|---|---|---|
| **1** | Engine Core & Metrics | DB schema, benchmark metrics engine, synthetic workflow prompts |
| **2** | Throttle & State Machine | Baseline calibration, drift calc, scheduler with mutex locks, orchestrator exclusion |
| **3** | Agent Sandbox & Discovery | DraftProvider schema, admin REST endpoints, Hermes agent scaffolding |
| **4** | UI & Analytics | /benchmarks, /discovery pages, settings panels |

---

## 2. Architecture Decisions

### 2.1 New Database Models (Prisma)

| Model | Purpose | Key Fields |
|---|---|---|
| `ApiKeyBenchmark` | Historical benchmark run metrics | `apiKeyId`, `ttftMs`, `avgTps`, `latencyDriftRatio`, `isThrottled`, `passed`, `failureReason`, `testedAt` |
| `BenchmarkConfig` | Singleton benchmark rules | `baselineProviderModelId`, `targetTps`, `targetRpm`, `ttftDriftThreshold`, `tpsDriftThreshold`, `postTestCooldownSeconds`, `maxParallelTests` |
| `DraftProvider` | Discovered endpoints awaiting key | `name`, `baseUrl`, `apiFormat`, `sourceUrl`, `status`, `discoveredModels` (JSON) |

### 2.2 Enum Extensions

- **ApiKeyStatus**: Add `TESTING`, `COOLDOWN`
- **DraftStatus** (new): `PENDING_KEY`, `TESTING`, `ACCEPTED`, `REJECTED`

### 2.3 New Engine Modules

| Module | Path | Responsibility |
|---|---|---|
| `benchmark/metrics.ts` | `src/engine/benchmark/metrics.ts` | TTFT/ITL/TPS calculation from stream |
| `benchmark/prompts.ts` | `src/engine/benchmark/prompts.ts` | Synthetic agentic workflow prompt suite |
| `benchmark/runner.ts` | `src/engine/benchmark/runner.ts` | Single-key benchmark execution |
| `benchmark/scheduler.ts` | `src/engine/benchmark/scheduler.ts` | Parallel scheduler with per-provider mutex |
| `benchmark/config.ts` | `src/engine/benchmark/config.ts` | BenchmarkConfig data access |
| `data-access/benchmarks.ts` | `src/engine/data-access/benchmarks.ts` | ApiKeyBenchmark CRUD |
| `data-access/drafts.ts` | `src/engine/data-access/drafts.ts` | DraftProvider CRUD |

### 2.4 New API Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/admin/benchmarks` | GET, POST | List/trigger benchmarks |
| `/api/admin/benchmarks/status` | GET | Live scheduler status |
| `/api/admin/drafts` | GET, POST | Draft provider list/create |
| `/api/admin/drafts/[id]` | GET, PUT, DELETE | Draft detail/update/delete |
| `/api/admin/drafts/[id]/validate` | POST | Validate & onboard draft |

### 2.5 New UI Pages

| Route | Purpose |
|---|---|
| `/benchmarks` | Live benchmarking dashboard |
| `/discovery` | Provider discovery & draft board |

---

## 3. Phase 1 — Engine Core & Metrics Collection

### Tasks
- [x] Extend `ApiKeyStatus` enum with `TESTING`, `COOLDOWN`
- [x] Add `ApiKeyBenchmark`, `BenchmarkConfig`, `DraftProvider` models
- [x] Build `benchmark/metrics.ts` — streaming observer for TTFT/ITL/TPS
- [x] Build `benchmark/prompts.ts` — synthetic agentic workflow prompt suite
- [x] Build `benchmark/config.ts` — BenchmarkConfig data access
- [x] Build `data-access/benchmarks.ts` — ApiKeyBenchmark CRUD

### Files Created
- `prisma/schema.prisma` (modified)
- `src/engine/benchmark/metrics.ts`
- `src/engine/benchmark/prompts.ts`
- `src/engine/benchmark/config.ts`
- `src/engine/data-access/benchmarks.ts`

---

## 4. Phase 2 — Silent Throttling & State Machine

### Tasks
- [x] Implement baseline calibration + drift calculation in `benchmark/calibration.ts`
- [x] Update `orchestrator.ts` to skip `TESTING`/`COOLDOWN` keys
- [x] Build `benchmark/runner.ts` — single-key benchmark execution
- [x] Build `benchmark/scheduler.ts` — parallel scheduler with per-provider mutex
- [x] Implement early stopping based on target thresholds
- [x] Add health-engine transitions for TESTING/COOLDOWN

### Files Created
- `src/engine/benchmark/calibration.ts`
- `src/engine/benchmark/runner.ts`
- `src/engine/benchmark/scheduler.ts`
- `src/engine/health-engine.ts` (modified)
- `src/engine/orchestrator.ts` (modified)

---

## 5. Phase 3 — Agent Sandbox & MCP Discovery

### Tasks
- [x] Create `data-access/drafts.ts` — DraftProvider CRUD
- [x] Create `/api/admin/drafts` REST endpoints
- [x] Create `/api/admin/benchmarks` REST endpoints
- [x] Scaffold Hermes agent Docker config + MCP client
- [x] Build agent prompt templates for discovery

### Files Created
- `src/engine/data-access/drafts.ts`
- `src/app/api/admin/drafts/route.ts`
- `src/app/api/admin/drafts/[id]/route.ts`
- `src/app/api/admin/drafts/[id]/validate/route.ts`
- `src/app/api/admin/benchmarks/route.ts`
- `src/app/api/admin/benchmarks/status/route.ts`
- `hermes/Dockerfile`
- `hermes/docker-compose.yml`
- `hermes/agent/` (scaffolding)

---

## 6. Phase 4 — UI & Visual Analytics

### Tasks
- [x] Build `/benchmarks` page with live progress + drift matrix
- [x] Build `/discovery` page for draft review + key handover
- [x] Add benchmark config panel to `/settings`
- [x] Add nav items to sidebar

### Files Created
- `src/app/(admin)/benchmarks/page.tsx`
- `src/app/(admin)/discovery/page.tsx`
- `src/components/benchmarks/*` (sub-components)
- `src/components/discovery/*` (sub-components)
- `src/components/layout/sidebar.tsx` (modified)
- `src/app/(admin)/settings/page.tsx` (modified)

---

## 7. Validation Checklist

- [ ] `npx prisma migrate dev` succeeds
- [ ] `npx prisma generate` succeeds
- [ ] `npm run build` succeeds (TypeScript compiles)
- [ ] Orchestrator excludes TESTING/COOLDOWN keys
- [ ] Benchmark scheduler respects per-provider mutex
- [ ] Draft validation promotes to active provider

---

## 8. Progress Log

| Date | Phase | Status |
|---|---|---|
| 2026-08-18 | Plan created | ✅ |
| 2026-08-18 | Phase 1 — Engine Core & Metrics | ✅ |
| 2026-08-18 | Phase 2 — Throttle & State Machine | ✅ |
| 2026-08-18 | Phase 3 — Agent Sandbox & Discovery | ✅ |
| 2026-08-18 | Phase 4 — UI & Analytics | ✅ |
| 2026-08-18 | Build validation (`npm run build`) | ✅ |

## 9. Implementation Notes

### Completed Deliverables

**Phase 1 — Engine Core & Metrics**
- `prisma/schema.prisma`: Added `ApiKeyBenchmark`, `BenchmarkConfig`, `DraftProvider` models; extended `ApiKeyStatus` with `TESTING`/`COOLDOWN`
- `src/engine/benchmark/metrics.ts`: Streaming observer for TTFT/ITL/TPS
- `src/engine/benchmark/prompts.ts`: Synthetic agentic workflow prompt suite (3 stages)
- `src/engine/benchmark/config.ts`: BenchmarkConfig singleton data access
- `src/engine/data-access/benchmarks.ts`: ApiKeyBenchmark CRUD + throttle matrix

**Phase 2 — Silent Throttling & State Machine**
- `src/engine/benchmark/calibration.ts`: Baseline calibration + drift ratio formulas
- `src/engine/benchmark/runner.ts`: Single-key 3-stage benchmark with early stopping
- `src/engine/benchmark/scheduler.ts`: Parallel scheduler with per-provider mutex locks
- `src/engine/health-engine.ts`: Added `setKeyTesting`, `setKeyCooldown`, `setKeyActive`, `checkAndRecoverExpiredCooldowns`
- `src/engine/orchestrator.ts`: Excludes TESTING/COOLDOWN keys; recovers expired cooldowns

**Phase 3 — Agent Sandbox & Discovery**
- `src/engine/data-access/drafts.ts`: DraftProvider CRUD
- `src/app/api/admin/drafts/route.ts`: GET/POST drafts
- `src/app/api/admin/drafts/[id]/route.ts`: GET/PUT/DELETE draft
- `src/app/api/admin/drafts/[id]/validate/route.ts`: Validate & onboard (creates provider + key + models + pool)
- `src/app/api/admin/benchmarks/route.ts`: GET/POST benchmarks
- `src/app/api/admin/benchmarks/status/route.ts`: Live scheduler status + throttle matrix
- `hermes/Dockerfile`, `hermes/docker-compose.yml`: Hermes agent + MCP servers
- `hermes/agent/`: index.js, mcp-client.js, prompts.js, discovery.js

**Phase 4 — UI & Analytics**
- `src/app/(admin)/benchmarks/page.tsx`: Live benchmarking dashboard
- `src/app/(admin)/discovery/page.tsx`: Provider discovery & draft board
- `src/components/benchmarks/`: benchmark-status-panel, throttle-matrix
- `src/components/discovery/`: draft-board, create-draft-dialog
- `src/components/settings/benchmark-settings-panel.tsx`: Benchmark config panel
- `src/components/layout/sidebar.tsx`: Added Benchmarks + Discovery nav items
- `src/app/api/admin/settings/route.ts`: Extended with benchmark config GET/PUT

### Validation
- `npx prisma db push` — schema applied successfully
- `npx prisma generate` — client regenerated
- `npm run build` — ✅ compiled successfully, all routes registered
