# Document 07 — First-Time Setup & Usage Guide

**Purpose**: Step-by-step, beginner-friendly instructions for setting up and using the Local Multi-Provider LLM Router for the very first time — including Docker setup for the Hermes discovery agent.

**Last Updated**: 2026-08-18

---

## 0. What This System Does (Quick Overview)

This is a **self-hosted LLM router** that sits between your AI client (like VS Code Copilot) and multiple LLM providers (OpenAI, Anthropic, Groq, DeepSeek, etc.). It gives you:

1. **One unified API key** — you paste a single key into your client, and the router distributes requests across all your provider keys.
2. **Automatic failover** — if one provider fails or is rate-limited, it tries the next one.
3. **Silent throttle detection** — it benchmarks your keys and detects providers that are secretly slowing you down.
4. **Provider discovery** — an optional Docker agent (Hermes) that searches the web for free/cheap LLM endpoints and stages them for you to review.

---

## 1. Prerequisites

Before you begin, make sure you have these installed on your PC:

| Requirement | How to check | Where to get it |
|---|---|---|
| **Node.js** (v20 or newer) | Open a terminal and run `node -v` | https://nodejs.org |
| **npm** (comes with Node) | Run `npm -v` | Included with Node.js |
| **Docker Desktop** (optional, for Hermes agent) | Run `docker --version` | https://www.docker.com/products/docker-desktop/ |
| **Git** (optional, to clone) | Run `git --version` | https://git-scm.com |

> **Note**: Docker is only needed if you want to use the **Hermes provider discovery agent** (Section 7). The core router works fine without Docker.

---

## 2. Get the Code

### Option A: You already have the project folder
If you already have the `Local-Multi-Provider-LLM-Router` folder on your PC, skip to Section 3.

### Option B: Clone from GitHub
```bash
git clone https://github.com/dananjayahabi/Local-Multi-Provider-LLM-Router.git
cd Local-Multi-Provider-LLM-Router
```

---

## 3. Install Dependencies

Open a terminal in the project root folder (`Local-Multi-Provider-LLM-Router`) and run:

```bash
npm install
```

This installs all required packages. It may take a few minutes on the first run.

> The `postinstall` script automatically runs `prisma generate`, which creates the database client code. If it doesn't run automatically, run `npx prisma generate` manually.

---

## 4. Create Your Environment File (`.env`)

The router needs a secret key to encrypt your provider API keys at rest. **This is required** — the app will refuse to start without it.

1. In the project root, create a file named `.env`
2. Add the following content:

```env
# Encryption secret — MUST be a strong random string (at least 32 chars)
ENCRYPTION_SECRET=change-me-to-a-long-random-string-64-characters-minimum

# Database location (SQLite file). Default is fine.
DATABASE_URL="file:./dev.db"

# Port the router listens on (default 4006)
PORT=4006
```

3. **Generate a real random secret.** Do NOT use the placeholder above. On Windows PowerShell, run:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output and paste it as your `ENCRYPTION_SECRET` value.

> ⚠️ **Important**: If you ever change `ENCRYPTION_SECRET` after adding provider keys, those keys can no longer be decrypted. Keep it safe and don't change it casually.

---

## 5. Set Up the Database

The router uses a local SQLite database file. Run this to create the tables:

```bash
npx prisma db push
```

You should see output confirming the database was created and synced. This creates `prisma/dev.db`.

---

## 6. Start the Router

### First-time start (to see your gateway key)

```bash
npm start
```

On the very first boot, the terminal will print a **Unified Gateway Key** like this:

```
══════════════════════════════════════════════════════
  LOCAL MULTI-PROVIDER LLM ROUTER
  Running on http://localhost:4006
══════════════════════════════════════════════════════

  🔑 YOUR UNIFIED GATEWAY KEY:
     sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

  Copy this key now. It will NOT be shown again.
══════════════════════════════════════════════════════
```

> ⚠️ **Copy this key immediately.** It is shown only once. If you lose it, you can regenerate it from the Settings page (Section 8.5).

### For development (auto-reload on code changes)
```bash
npm run dev
```

### Using the provided batch file
There's also a `bat/start-router.bat` file you can double-click to start the router.

Once started, open your browser to **http://localhost:4006** — you'll see the Admin Dashboard.

---

## 7. (Optional) Set Up the Hermes Discovery Agent in Docker

The Hermes agent automatically searches the web for free/cheap LLM endpoints and stages them as "drafts" for you to review. It runs in Docker alongside three MCP servers.

### 7.1 Start Docker Desktop
Make sure Docker Desktop is running (the whale icon in your system tray should be active).

### 7.2 Create the shared Docker network
The agent and the router must be on the same network. Run:

```bash
docker network create llm-router-net
```

### 7.3 Run the router in Docker (required for the agent to reach it)

> **Important**: The Hermes agent reaches the router at `http://llm-router:4006`. This only works if the **router itself is also running in Docker** with the container name `llm-router`. If you run the router with `npm start` on your host, the agent cannot reach it.

The project currently has a `hermes/docker-compose.yml` for the agent + MCP servers, but **the router itself is not yet containerized**. To run everything together, you have two options:

**Option A — Run the router on the host, agent in Docker (simplest, but agent can't auto-reach it):**
- Start the router with `npm start` (Section 6).
- Run the agent with `docker compose -f hermes/docker-compose.yml up --build`.
- The agent will try to reach `http://llm-router:4006` and fail unless you change `ROUTER_ADMIN_URL` in `hermes/docker-compose.yml` to `http://host.docker.internal:4006/api/admin` (Windows/Mac Docker supports `host.docker.internal`).

**Option B — Containerize the router too (recommended for full auto-discovery):**
1. Create a `Dockerfile` in the project root that builds the Next.js app.
2. Add the router as a service named `llm-router` in `hermes/docker-compose.yml` on the `llm-router-net` network.
3. Run `docker compose -f hermes/docker-compose.yml up --build`.

> This is a known enhancement. For now, if you just want to try the discovery feature quickly, use **Option A** with the `host.docker.internal` URL change.

### 7.4 Build and start the agent
```bash
cd hermes
docker compose up --build
```

This starts:
- `hermes-agent` — the discovery agent
- `mcp-duckduckgo` — web search
- `mcp-fetch` — web page fetching
- `mcp-context7` — documentation lookup

The agent runs a discovery session on startup, then every 6 hours. Discovered endpoints appear as **drafts** in the Discovery page (Section 8.4).

---

## 8. Using the Admin Dashboard

Open **http://localhost:4006** in your browser. Use the sidebar to navigate.

### 8.1 Dashboard
Overview of your router's health, recent requests, and key status.

### 8.2 Providers
1. Click **Providers** in the sidebar.
2. Click **Add Provider**.
3. Enter:
   - **Name** — e.g. "OpenAI"
   - **Base URL** — e.g. `https://api.openai.com/v1`
   - **API Format** — `CHAT_COMPLETIONS` (OpenAI), `MESSAGES` (Anthropic), or `RESPONSES`
4. Save, then add your API key(s) and model(s) for that provider.

### 8.3 Pools
Pools group models from different providers behind a single "virtual model name."
1. Click **Pools**.
2. Create a pool, give it a **virtual model name** (e.g. `gpt-4o`), and add provider models as members.
3. Set routing strategy (`ROUND_ROBIN` or `PRIORITY`).

### 8.4 Discovery (Draft Board)
- Shows endpoints discovered by the Hermes agent (or added manually).
- For a draft with status `PENDING_KEY`, paste your API key and click **Validate**.
- If validation passes, the draft becomes an active provider.

### 8.5 Settings
- **Unified Gateway Key** — view prefix, regenerate if lost.
- **Benchmark Engine** — set Target TPS, Target RPM, drift thresholds, cooldown, max parallel tests.
- **Penalty Engine** — tune cooldown/multiplier for failed keys.

### 8.6 Benchmarks
- Click **Run All Benchmarks** to test all eligible keys.
- Watch live progress (TTFT → TPS → RPM burst stages).
- The **Throttle Analytics Matrix** shows each key's drift ratio vs. the baseline and whether it's throttled.

### 8.7 Logs & Usage
- **Logs** — request history with outcomes and error classifications.
- **Usage** — rate-limit charts and usage statistics.

---

## 9. Connect Your AI Client (VS Code Copilot Example)

1. Open VS Code.
2. Open **Settings** → search for `chat.disableImplicitContext` and set it to `true` (recommended).
3. Configure your Copilot/OpenAI-compatible client to use:
   - **Base URL**: `http://localhost:4006/api/gateway/v1`
   - **API Key**: your Unified Gateway Key (`sk-...`)
4. Start chatting — requests will be routed through your pools.

---

## 10. Common Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| App won't start, "ENCRYPTION_SECRET is not set" | Missing `.env` | Create `.env` with a strong secret (Section 4) |
| "Table does not exist" errors | DB not set up | Run `npx prisma db push` (Section 5) |
| Port 4006 already in use | Another app on that port | Change `PORT` in `.env` |
| Hermes agent can't reach router | Router not in Docker / wrong URL | Use `host.docker.internal` or containerize router (Section 7.3) |
| `docker: command not found` | Docker not installed/running | Install Docker Desktop and start it |
| Lost gateway key | Not copied on first boot | Regenerate from Settings → Unified Gateway Key |
| Provider requests all fail | Wrong base URL / API format / key | Double-check Provider config (Section 8.2) |

---

## 11. Quick-Start Checklist

- [ ] Node.js installed
- [ ] `npm install` completed
- [ ] `.env` created with a strong `ENCRYPTION_SECRET`
- [ ] `npx prisma db push` run
- [ ] `npm start` — copied the Unified Gateway Key
- [ ] Added at least one Provider + API key + model
- [ ] Created a Pool with a virtual model name
- [ ] Connected your client to `http://localhost:4006/api/gateway/v1`
- [ ] (Optional) Docker network + Hermes agent running
- [ ] (Optional) Ran a benchmark to check key health
