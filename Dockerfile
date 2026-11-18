FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000

# Sem dependências npm: só Node (http, sqlite e crypto nativos).
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts/import.mjs ./scripts/import.mjs

RUN mkdir -p /data/photos /data/backups && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q --spider http://127.0.0.1:3000/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
