# ─── Lightweight HTTP MCP Server ────────────────────────
# Minimal alpine image with no external dependencies.
# Exposes search / fetch_content / query_docs over HTTP.

FROM node:20-alpine

WORKDIR /app

# No dependencies to install — just copy the server
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
