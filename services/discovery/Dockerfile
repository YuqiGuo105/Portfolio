FROM node:22-alpine
WORKDIR /app
COPY services/discovery/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src/lib/discovery ./src/lib/discovery
COPY src/lib/publicContent.mjs src/lib/rankedSearch.mjs ./src/lib/
COPY src/lib/voice ./src/lib/voice
COPY services/voice/modelGateway.mjs services/voice/qwenTransport.mjs ./services/voice/
COPY scripts/discovery-worker.mjs ./scripts/discovery-worker.mjs
USER node
CMD ["node", "scripts/discovery-worker.mjs"]
