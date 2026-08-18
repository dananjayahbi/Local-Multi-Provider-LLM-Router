# ─── Hermes Agent Dockerfile ────────────────────────────
# Isolated agent container for provider discovery.
# Communicates with the LLM Router over the bridge network.

FROM node:20-alpine

WORKDIR /app

# No external dependencies — copy agent source directly
COPY agent ./agent

# MCP servers are configured via env vars / config
ENV NODE_ENV=production
ENV ROUTER_ADMIN_URL=http://llm-router:4006/api/admin

CMD ["node", "agent/index.js"]
