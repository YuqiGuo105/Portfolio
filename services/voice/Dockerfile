FROM node:24-slim
WORKDIR /app
COPY services/voice/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/voice/server.mjs services/voice/relay.mjs services/voice/qwenTransport.mjs services/voice/modelGateway.mjs ./services/voice/
COPY src/lib/voice/protocol.mjs src/lib/voice/publicProfile.mjs src/lib/voice/qwenProtocol.mjs src/lib/voice/history.mjs src/lib/voice/spendGuard.mjs src/lib/voice/qwenDictation.mjs ./src/lib/voice/
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "services/voice/server.mjs"]
