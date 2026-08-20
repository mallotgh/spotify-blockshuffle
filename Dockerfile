# ---- Frontend bauen ----
FROM node:22-bookworm-slim AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

# ---- Backend bauen ----
FROM node:22-bookworm-slim AS serverbuild
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Laufzeit ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/config \
    STATIC_DIR=/app/public \
    PORT=8973
WORKDIR /app
COPY --from=serverbuild /app/node_modules ./node_modules
COPY --from=serverbuild /app/dist ./dist
COPY --from=webbuild /app/web/dist ./public
COPY package.json ./
VOLUME /config
EXPOSE 8973
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8973)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
