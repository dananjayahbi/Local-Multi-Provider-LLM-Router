# Local Multi-Provider LLM Router

A self-hosted application that routes LLM requests through a single **OpenAI-compatible API gateway**, automatically distributing them across multiple providers and API keys — with built-in failover, health monitoring, and a full admin dashboard.

---

## Why Does This Exist?

Most LLM providers (OpenAI, Anthropic, Google, Mistral, etc.) offer **free-tier API access** with rate limits. Instead of being locked to one provider or hitting a single key's quota, this router lets you:

- **Pool multiple free-tier API keys** from different providers
- **Automatically failover** when one key hits rate limits or errors
- **Expose a single OpenAI-compatible endpoint** that any tool can consume (VS Code, Continue, Open WebUI, etc.)
- **Monitor everything** — requests, token usage, errors, key health — from a web dashboard

Think of it as a **load balancer for LLM APIs**.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│  Your Apps (VS Code, Continue, Open WebUI, etc.)    │
│         ↓  OpenAI-compatible requests               │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│              API Gateway (Single Endpoint)           │
│  POST /api/gateway/v1/chat/completions              │
│  • Auth via unified Bearer token                    │
│  • Rate limiting (120 req/min)                      │
│  • Model → Pool resolution                          │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│              Routing Engine (Orchestrator)           │
│  • Builds candidate list (Tier 1 → Tier 2)          │
│  • Strategy: Priority-based or Round-Robin          │
│  • Failover on errors (retry next candidate)        │
│  • Streaming & non-streaming support                │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│           Provider Adapters (3 formats)             │
│  • Chat Completions  (OpenAI, Mistral, Groq, etc.) │
│  • Messages           (Anthropic Claude)            │
│  • Responses           (OpenAI Responses API)       │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│          External LLM Provider APIs                 │
│  OpenAI │ Anthropic │ Google │ Mistral │ Groq │ …  │
└─────────────────────────────────────────────────────┘
```

---

## Core Concepts

### Providers
A **provider** represents an LLM service (e.g., OpenAI, Anthropic, Google AI). Each provider has:
- A **name** and **base URL** (API endpoint)
- An **API format** — one of: `CHAT_COMPLETIONS`, `MESSAGES`, or `RESPONSES`
- One or more **API keys** (stored encrypted with AES-256-GCM)

### Models
Each provider exposes one or more **models** (e.g., `gpt-4o`, `claude-3-haiku`, `gemini-2.0-flash`). Models declare:
- Display name and model ID
- Capabilities: **vision**, **function calling**, **reasoning/thinking**
- Token limits (context window and max output)
- Cost info (input/output per 1M tokens)

### Pools (Virtual Models)
A **pool** is the core routing concept. It maps a **virtual model name** (e.g., `my-fast-model`) to one or more provider models with:
- **Priority ordering** — which model/key to try first
- **Routing strategy** — `PRIORITY` (ordered) or `ROUND_ROBIN` (least-recently-used)
- **Health-aware routing** — unhealthy keys are automatically skipped

### API Keys & Health
Each provider has API keys that go through a **health state machine**:

```
ACTIVE ──(recoverable error)──→ PENALIZED ──(cooldown expires)──→ ACTIVE
ACTIVE ──(quota/auth error)──→ SUSPENDED (manual reactivation needed)
```

- **Penalties** escalate: base cooldown × multiplier^level, capped at max cooldown
- **Tier 1** = healthy ACTIVE keys (used first)
- **Tier 2** = PENALIZED keys whose cooldown has expired (fallback)

---

## Features

### 🚀 Unified API Gateway
- Single OpenAI-compatible endpoint: `POST /api/gateway/v1/chat/completions`
- Works with any tool that supports the OpenAI API format (Copilot, Continue, Open WebUI, curl, etc.)
- Supports both **streaming** (SSE) and **non-streaming** responses
- Supports **tool/function calling**, **vision**, and **reasoning/thinking** models
- Bearer token authentication with bcrypt-verified keys
- Built-in rate limiting (120 requests/minute)

### 🔀 Smart Routing & Failover
- Automatic failover across providers when errors occur
- **Error classification** system categorizes failures into 7 types:
  - `RATE_LIMIT` — temporary rate limit (retry-worthy)
  - `SERVER_ERROR` — upstream 5xx (retry-worthy)
  - `TRANSIENT` — network/timeout (retry-worthy)
  - `QUOTA_EXCEEDED` — billing/quota exhausted (suspend key)
  - `AUTH_ERROR` — invalid credentials (suspend key)
  - `INVALID_REQUEST` — client-side error (no retry, no penalty)
  - `UNKNOWN` — unrecognized errors (treated as retry-worthy)
- Only failover-worthy errors trigger retries — client errors don't waste keys
- Configurable routing strategies per pool

### 🏥 Health Engine
- Automatic penalty escalation for failing keys
- **Exponential backoff** cooldowns: `base × multiplier^level`, capped at configurable max
- Automatic recovery when penalty window expires
- Configurable reset window — if no penalty within N seconds, penalty level resets
- Manual key suspension/reactivation from the dashboard

### 📊 Admin Dashboard
- **Dashboard** — Real-time overview: active keys, healthy percentage, request success rate, token usage, animated rolling numbers
- **Providers** — Add/edit/delete providers, manage API keys (add/rotate/delete), view key health status
- **Models** — Register models per provider with capability flags (vision, function calling, reasoning)
- **Pools** — Create virtual models, add pool members with priority ordering, quick-mode and advanced-mode pool creation
- **Logs** — Paginated request logs with outcome/error filtering, expandable detail rows, latency tracking
- **Usage** — Token usage analytics with date range presets (today, 24h, 7d, 30d, 90d, custom), per-provider/pool/key filtering, auto-refresh every 5 seconds
- **Settings** — Configure penalty parameters (base cooldown, multiplier, max cooldown, reset window), regenerate gateway API key

### 🔐 Security
- API keys stored **encrypted** (AES-256-GCM) in the database — never in plaintext
- Gateway key stored as **bcrypt hash** — plaintext shown only once at creation/rotation
- Key rotation supported with immediate effect

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | SQLite via libSQL / Turso |
| ORM | Prisma 7 |
| UI | React 19, Tailwind CSS 4, Radix UI, shadcn/ui |
| Icons | Lucide React |
| Encryption | Node.js `crypto` (AES-256-GCM) |
| Auth | bcryptjs (key hashing) |

---

## Database Schema

The database has 7 main tables:

| Table | Purpose |
|-------|---------|
| `Provider` | LLM services (OpenAI, Anthropic, Google, etc.) |
| `ProviderModel` | Models available per provider with capability flags |
| `ApiKey` | Encrypted API keys with health state tracking |
| `Pool` | Virtual model routing groups with strategy |
| `PoolMember` | Links pools → provider models with priority |
| `RequestLog` | Every request through the gateway (outcome, latency, tokens) |
| `AppSettings` | Singleton config (penalty params, gateway key hash) |

---

## API Endpoints

### Gateway (Public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gateway/v1/chat/completions` | OpenAI-compatible chat completions |

### Admin (Internal)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST` | `/api/admin/providers` | List / create providers |
| `GET/PUT/DELETE` | `/api/admin/providers/[id]` | Manage a provider |
| `GET/POST` | `/api/admin/providers/[id]/keys` | List / add API keys |
| `DELETE` | `/api/admin/providers/[id]/keys` | Delete an API key |
| `GET/POST` | `/api/admin/providers/[id]/models` | List / add models |
| `GET/PUT/DELETE` | `/api/admin/models/[id]` | Manage a model |
| `GET/POST` | `/api/admin/pools` | List / create pools |
| `GET/PUT/DELETE` | `/api/admin/pools/[id]` | Manage a pool |
| `GET` | `/api/admin/logs` | Paginated request logs |
| `GET` | `/api/admin/usage` | Token usage analytics |
| `GET/PUT` | `/api/admin/settings` | App settings & key rotation |

---

## How It Works (Request Flow)

1. **Client** sends a standard OpenAI chat completion request with `model: "my-pool-name"`
2. **Gateway** authenticates the Bearer token, checks rate limits
3. **Model Resolution** — looks up `my-pool-name` as a Pool's `virtualModelName`
4. **Orchestrator** builds a candidate list from pool members:
   - **Tier 1**: All `ACTIVE` keys, sorted by priority (or round-robin / LRU)
   - **Tier 2**: `PENALIZED` keys whose cooldown has expired
5. **Adapter** translates the canonical request to the provider's API format (Chat Completions, Messages, or Responses)
6. **Provider** responds → if error: classify → penalize key → try next candidate
7. **Response** is translated back to OpenAI format and returned to the client
8. **RequestLog** is created with outcome, latency, token counts, and error details

---

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── gateway/v1/chat/completions/   # Public API gateway endpoint
│   │   │   └── admin/                          # Admin REST API routes
│   │   │       ├── providers/                  # CRUD for providers, keys, models
│   │   │       ├── pools/                      # CRUD for pools
│   │   │       ├── logs/                       # Request log queries
│   │   │       ├── usage/                      # Token usage analytics
│   │   │       └── settings/                   # App config & key rotation
│   │   └── (admin)/                            # Admin dashboard (route group)
│   │       ├── layout.tsx                      # Sidebar layout wrapper
│   │       ├── dashboard/page.tsx              # Overview stats
│   │       ├── providers/page.tsx              # Provider management
│   │       ├── pools/page.tsx                  # Pool management
│   │       ├── logs/page.tsx                   # Request log viewer
│   │       ├── usage/page.tsx                  # Token usage analytics
│   │       └── settings/page.tsx               # App configuration
│   ├── components/
│   │   ├── ui/                                 # Reusable UI primitives (shadcn/ui)
│   │   │   ├── badge.tsx, button.tsx, card.tsx
│   │   │   ├── dialog.tsx, input.tsx, label.tsx
│   │   │   ├── select.tsx, table.tsx, textarea.tsx
│   │   ├── layout/sidebar.tsx                  # Navigation sidebar
│   │   └── usage/                              # Usage page sub-components
│   │       ├── date-range-selector.tsx
│   │       ├── rolling-number.tsx
│   │       ├── usage-filter-bar.tsx
│   │       └── usage-stat-cards.tsx
│   ├── engine/                                 # Core routing engine
│   │   ├── canonical.ts                        # Internal request/response types
│   │   ├── orchestrator.ts                     # Routing & failover logic
│   │   ├── health-engine.ts                    # Key penalty state machine
│   │   ├── error-classifier.ts                 # Error categorization
│   │   ├── serializer.ts                       # Canonical → OpenAI format
│   │   ├── adapters/
│   │   │   ├── index.ts                        # Adapter registry
│   │   │   ├── chat-completions.ts             # OpenAI/Mistral/Groq format
│   │   │   ├── messages.ts                     # Anthropic Messages format
│   │   │   └── responses.ts                    # OpenAI Responses format
│   │   └── data-access/                        # Database access layer
│   │       ├── api-keys.ts, models.ts, pools.ts
│   │       ├── providers.ts, request-logs.ts, settings.ts
│   └── lib/                                    # Shared utilities
│       ├── encryption.ts                       # AES-256-GCM encrypt/decrypt
│       ├── gateway-key.ts                      # Key hashing & verification
│       ├── prisma.ts                           # Prisma client singleton
│       ├── startup.ts                          # Boot-time initialization
│       └── utils.ts                            # General utilities
├── prisma/
│   └── schema.prisma                           # Database schema
├── bat/
│   └── start-router.bat                        # Quick-start Windows script
└── architecture-plan.md                        # Detailed design document
```

---

## Getting Started

### Prerequisites
- **Node.js** 18+
- **npm**

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
#    Create a .env file with:
#    ENCRYPTION_KEY=<your-random-32-byte-hex-key>
#    DATABASE_URL=file:./prisma/dev.db

# 3. Initialize the database
npx prisma db push

# 4. Start the development server
npm run dev
```

The app runs at **http://localhost:4006**.

### First-Time Setup
1. Open **http://localhost:4006** → you'll see the admin dashboard
2. Go to **Settings** → copy the gateway API key (shown only once!)
3. Go to **Providers** → add a provider (e.g., OpenAI with base URL `https://api.openai.com/v1`)
4. Add an **API Key** to that provider
5. Add a **Model** (e.g., `gpt-4o`)
6. Go to **Pools** → create a pool with a virtual model name (e.g., `my-model`) and add your model
7. Use it from any OpenAI-compatible client:

```bash
curl http://localhost:4006/api/gateway/v1/chat/completions \
  -H "Authorization: Bearer <your-gateway-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-model",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## License

Private project — for personal use.
│  • Responses           (OpenAI Responses API)       │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│          External LLM Provider APIs                 │
│  OpenAI │ Anthropic │ Google │ Mistral │ Groq │ …  │
└─────────────────────────────────────────────────────┘
```

---

## Core Concepts

### Providers
A **provider** represents an LLM service (e.g., OpenAI, Anthropic, Google AI). Each provider has:
- A **name** and **base URL** (API endpoint)
- An **API format** — one of: `CHAT_COMPLETIONS`, `MESSAGES`, or `RESPONSES`
- One or more **API keys** (stored encrypted)

### Models
Each provider exposes one or more **models** (e.g., `gpt-4o`, `claude-3-haiku`, `gemini-2.0-flash`). Models declare:
- Display name and model ID
- Capabilities: **vision**, **function calling**, **reasoning/thinking**
- Token limits (context window and max output)
- Cost info (input/output per 1M tokens)

### Pools (Virtual Models)
A **pool** is the core routing concept. It maps a **virtual model name** (e.g., `my-fast-model`) to one or more provider models with:
- **Priority ordering** — which model/key to try first
- **Routing strategy** — `PRIORITY` (ordered) or `ROUND_ROBIN` (least-recently-used)
- **Health-aware routing** — unhealthy keys are automatically skipped

### API Keys & Health
Each provider has API keys that go through a **health state machine**:

```
ACTIVE ──(recoverable error)──→ PENALIZED ──(cooldown expires)──→ ACTIVE
ACTIVE ──(quota/auth error)──→ SUSPENDED (manual reactivation needed)
```

- **Penalties** escalate: base cooldown × multiplier^level, capped at max cooldown
- **Tier 1** = healthy keys (used first)
- **Tier 2** = penalized keys whose cooldown has expired (fallback)

---

## Features

### 🚀 Unified API Gateway
- Single OpenAI-compatible endpoint: `POST /api/gateway/v1/chat/completions`
- Works with any tool that supports the OpenAI API format
- Supports both **streaming** and **non-streaming** responses
- Supports **tool/function calling**, **vision**, and **reasoning** models
- Bearer token authentication with bcrypt-verified keys
- Built-in rate limiting (120 requests/minute)

### 🔀 Smart Routing & Failover
- Automatic failover across providers when errors occur
- Error classification: `RATE_LIMIT`, `AUTH_ERROR`, `QUOTA_EXCEEDED`, `SERVER_ERROR`, `TRANSIENT`, `INVALID_REQUEST`, `UNKNOWN`
- Only failover-worthy errors trigger retries; client errors don't waste keys
- Configurable routing strategies per pool

### 🏥 Health Engine
- Automatic penalty escalation for failing keys
- Exponential backoff cooldowns (configurable base, multiplier, max)
- Automatic recovery when penalty window expires
- Manual key suspension/reactivation from the dashboard

### 📊 Admin Dashboard
- **Overview** — Real-time stats: active keys, healthy percentage, request success rate, token usage
- **Providers** — Add/edit/delete providers, manage API keys (add/rotate/delete)
- **Models** — Register models per provider with capability flags
- **Pools** — Create virtual models, add pool members with priority ordering
- **Logs** — Paginated request logs with outcome filtering, error details, and latency
- **Usage** — Token usage analytics with date range presets (today, 24h, 7d, 30d, 90d, custom), per-provider/pool/key filtering, and auto-refresh
- **Settings** — Configure penalty parameters, regenerate gateway key

### 🔐 Security
- API keys stored **encrypted** (AES-256-GCM) in the database
- Gateway key stored as **bcrypt hash** (plaintext shown only once at creation)
- Key rotation supported with immediate effect

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | SQLite via libSQL / Turso |
| ORM | Prisma 7 |
| UI | React 19, Tailwind CSS 4, Radix UI |
| Icons | Lucide React |
| Encryption | Node.js `crypto` (AES-256-GCM) |

---

## Database Schema (Prisma)

The database has 8 main tables:

| Table | Purpose |
|-------|---------|
| `Provider` | LLM services (OpenAI, Anthropic, etc.) |
| `ProviderModel` | Models available per provider |
| `ApiKey` | Encrypted API keys with health state |
| `Pool` | Virtual model routing groups |
| `PoolMember` | Links pools to provider models with priority |
| `RequestLog` | Every request through the gateway |
| `AppSettings` | Singleton config (penalty params, gateway key hash) |

---

## API Endpoints

### Gateway (Public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gateway/v1/chat/completions` | OpenAI-compatible chat endpoint |

### Admin (Internal)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST` | `/api/admin/providers` | List / create providers |
| `GET/PUT/DELETE` | `/api/admin/providers/[id]` | Manage a provider |
| `GET/POST` | `/api/admin/providers/[id]/keys` | List / add API keys |
| `DELETE` | `/api/admin/providers/[id]/keys` | Delete an API key |
| `GET/POST` | `/api/admin/providers/[id]/models` | List / add models |
| `GET/PUT/DELETE` | `/api/admin/models/[id]` | Manage a model |
| `GET/POST` | `/api/admin/pools` | List / create pools |
| `GET/PUT/DELETE` | `/api/admin/pools/[id]` | Manage a pool |
| `GET` | `/api/admin/logs` | Paginated request logs |
| `GET` | `/api/admin/usage` | Token usage analytics |
| `GET/PUT` | `/api/admin/settings` | App settings & key rotation |

---

## How It Works (Request Flow)

1. **Client** sends a standard OpenAI chat completion request with `model: "my-pool-name"`
2. **Gateway** authenticates the Bearer token, checks rate limits
3. **Model Resolution** — looks up `my-pool-name` as a pool's virtual model name
4. **Orchestrator** builds a candidate list from pool members:
   - **Tier 1**: All ACTIVE keys, sorted by priority (or round-robin)
   - **Tier 2**: PENALIZED keys whose cooldown has expired
5. **Adapter** translates the canonical request to the provider's API format
6. **Provider** responds; if error → classify, penalize key, try next candidate
7. **Response** is translated back to OpenAI format and returned to the client
8. **RequestLog** is created with outcome, latency, token counts, and error details

---

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── gateway/v1/chat/completions/   # Public API gateway
│   │   │   └── admin/                          # Admin REST API
│   │   └── (admin)/                            # Admin dashboard pages
│   │       ├── dashboard/                      # Overview stats
│   │       ├── providers/                      # Provider management
│   │       ├── pools/                          # Pool (virtual model) management
│   │       ├── logs/                           # Request log viewer
│   │       ├── usage/                          # Token usage analytics
│   │       └── settings/                       # App configuration
│   ├── components/
│   │   ├── ui/                                 # Reusable UI primitives
│   │   ├── layout/sidebar.tsx                  # Navigation sidebar
│   │   └── usage/                              # Usage page components
│   ├── engine/                                 # Core routing engine
│   │   ├── canonical.ts                        # Request/response types
│   │   ├── orchestrator.ts                     # Routing & failover logic
│   │   ├── health-engine.ts                    # Key penalty state machine
│   │   ├── error-classifier.ts                 # Error categorization
│   │   ├── serializer.ts                       # Response format translation
│   │   ├── adapters/                           # Provider API format adapters
│   │   └── data-access/                        # Database access layer
│   └── lib/                                    # Shared utilities
│       ├── encryption.ts                       # AES-256-GCM encryption
│       ├── gateway-key.ts                      # Gateway key hashing
│       ├── prisma.ts                           # Prisma client singleton
│       └── startup.ts                          # Boot initialization
├── prisma/
│   └── schema.prisma                           # Database schema
└── bat/
    └── start-router.bat                        # Quick-start script
```

---

## Getting Started

### Prerequisites
- **Node.js** 18+
- **npm** or **pnpm**

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
#    Create .env with:
#    ENCRYPTION_KEY=<random 32-byte hex key>
#    DATABASE_URL=file:./prisma/dev.db
#    # For Turso: DATABASE_URL=libsql://your-db.turso.io

# 3. Initialize the database
npx prisma db push

# 4. Start the development server
npm run dev
```

The app runs on **http://localhost:4006**.

### First-Time Setup
1. Open the admin dashboard at `http://localhost:4006`
2. Go to **Settings** and note your gateway API key (shown once)
3. Add a **Provider** (e.g., OpenAI) with an API key
4. Register **Models** for that provider
5. Create a **Pool** — give it a virtual model name and add models
6. Use the gateway endpoint with any OpenAI-compatible client:
   ```
   POST http://localhost:4006/api/gateway/v1/chat/completions
   Authorization: Bearer <your-gateway-key>
   { "model": "your-pool-name", "messages": [...] }
   ```

---

## License

Private project — for personal use.
