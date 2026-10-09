# SilkSol Intelligence — dashboard + REST API in one Node.js container.
#   docker build -t silksol-intelligence .
#   docker run -p 3000:3000 -e SILKSOL_API_KEYS="erp:<key>" silksol-intelligence

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:node

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Nitro traces and bundles the runtime dependencies into .output — no node_modules needed.
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" > /dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
