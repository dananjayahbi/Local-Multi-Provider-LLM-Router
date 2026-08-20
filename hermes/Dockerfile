# ─── Hermes Agent Dockerfile ────────────────────────────
# Isolated agent container for provider discovery + a real
# PTY terminal server. Communicates with the LLM Router over
# the bridge network.
#
# Uses Debian node:20 (not Alpine) because node-pty compiles a
# native addon that is only reliably supported on glibc.

FROM node:20

WORKDIR /app

# node-pty needs build tools for its native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy agent source + terminal server
COPY agent ./agent
COPY terminal ./terminal

# Install terminal deps (node-pty, ws)
RUN cd terminal && npm install

# Install the `hermes` CLI launcher (generated via printf to keep a
# clean LF shebang — copying from Windows can inject a CR that breaks
# `/bin/sh` resolution and causes "required file not found").
RUN printf '#!/bin/sh\nexec node /app/agent/index.js\n' > /usr/local/bin/hermes \
    && chmod +x /usr/local/bin/hermes

# MCP servers + router are configured via env vars / config
ENV NODE_ENV=production
ENV ROUTER_ADMIN_URL=http://llm-router:4006/api/admin
ENV TERMINAL_PORT=4007

EXPOSE 4007

CMD ["node", "terminal/server.js"]
