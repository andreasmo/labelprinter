# Server-Variante: gleiche Oberfläche, im Netz erreichbar, Einstellungen im Volume /data
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist/server.js ./server.js
RUN mkdir -p /data && chown node:node /data
ENV ZPL_MODE=server \
    ZPL_DATA_DIR=/data \
    ZPL_PORT=8910
VOLUME /data
EXPOSE 8910
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8910/api/info >/dev/null || exit 1
CMD ["node", "server.js"]
