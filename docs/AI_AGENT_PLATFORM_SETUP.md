# AI Agent Platform Setup & Technical Scope

> Branch: `docs/ai-agent-architecture`  
> Purpose: 将 `CHAT_AGENT_ARCHITECTURE.md` 拆成可执行的工程落地范围。

---

## 1. Recommended MVP Scope

MVP 目标不是一次性实现所有 Agent framework，而是先建立稳定主链路：

```text
Next.js ChatWidget
  → API Gateway
  → Spring Boot Chat Orchestrator
  → Redis Session
  → PostgreSQL / pgvector
  → Kafka ChatEvent
  → Evaluation Service
  → OpenTelemetry
```

MVP 推荐技术栈：

| Area | Choice |
|---|---|
| Frontend | Next.js 12, React 18, custom SSE client, optional AI SDK-compatible adapter |
| Backend Core | Spring Boot |
| Java AI Layer | Spring AI |
| Agent Runtime | adk-java Runner + Plugin Chain |
| Tool Protocol | MCP client/server pattern |
| Session | Redis Cluster or single Redis for dev |
| OLTP DB | PostgreSQL |
| Vector DB | pgvector |
| Event Bus | Kafka or Redpanda for local dev |
| Observability | OpenTelemetry + Prometheus/Grafana + Elasticsearch/Kibana |
| Evaluation | custom LLM-as-Judge first, Ragas/DeepEval optional later |

---

## 2. Repository Strategy

There are two possible repo strategies.

### Option A: Monorepo inside Portfolio

```text
Portfolio/
  src/                         # existing Next.js frontend
  services/
    chat-orchestrator-service/
    evaluation-service/
    analytics-service/
    notification-service/
    mcp-tools-service/
  infra/
    docker-compose.yml
    postgres/
    redis/
    kafka/
    otel/
  docs/
```

Pros:

- Easy to demo in one repository;
- Strong portfolio storytelling;
- All architecture docs and frontend code stay together.

Cons:

- Repo becomes heavier;
- Frontend deployment and backend deployment concerns mix together.

### Option B: Frontend repo + backend repo

```text
YuqiGuo105/Portfolio              # Next.js frontend only
YuqiGuo105/ai-agent-platform      # Spring Boot / Agent backend
```

Pros:

- Cleaner production ownership;
- Backend can evolve independently;
- Better if backend becomes a larger microservice platform.

Cons:

- Demo setup requires two repositories;
- Cross-repo documentation needs more discipline.

Recommended path:

- Short term: keep docs in Portfolio;
- Medium term: create `ai-agent-platform` repo when implementation begins;
- Portfolio uses environment variables to connect to backend.

```text
NEXT_PUBLIC_CHAT_API_BASE_URL=https://api.yuqi.site
NEXT_PUBLIC_CHAT_STREAM_PATH=/api/rag/answer/stream
```

---

## 3. Frontend Setup Scope

### 3.1 Files to add

```text
src/lib/telemetry/chatTelemetryClient.js
src/lib/chat/chatRequestBuilder.js
src/lib/chat/chatSession.js
```

### 3.2 Files to modify

```text
src/components/ChatWidget.js
```

### 3.3 Frontend changes

- Replace raw `console.log` logger with structured telemetry client;
- Generate and pass `traceId`, `sessionId`, `messageId`, `clientEventId`;
- Keep SSE rendering behavior unchanged;
- Replace frontend final persistence with backend-owned persistence;
- Keep localStorage only for UI continuity;
- Add optional telemetry endpoint for frontend events.

### 3.4 Frontend event schema

```json
{
  "eventType": "message_submitted",
  "traceId": "trace-uuid",
  "sessionId": "session-uuid",
  "messageId": "message-uuid",
  "pageUrl": "https://www.yuqi.site/...",
  "timestamp": "2026-04-27T00:00:00Z",
  "payload": {}
}
```

---

## 4. Backend Setup Scope

### 4.1 Chat Orchestrator Service

Recommended module:

```text
services/chat-orchestrator-service
```

Responsibilities:

- Expose `/api/rag/answer/stream`;
- Accept frontend metadata;
- Run ValidatorPlugin / ProcessorPlugin / EnricherPlugin / AnalyticsPlugin;
- Use Spring AI for model and vector abstraction;
- Use adk-java Runner for agent execution;
- Use RedisSessionService instead of InMemorySessionService;
- Write chat messages to PostgreSQL;
- Produce `chat-events` to Kafka;
- Emit OpenTelemetry spans.

### 4.2 Evaluation Service

Recommended module:

```text
services/evaluation-service
```

Responsibilities:

- Consume Kafka `chat-events`;
- Run LLM-as-Judge;
- Score relevance, accuracy, completeness, helpfulness, groundedness, safety;
- Write `chat_quality_scores`;
- Produce `quality-scores`.

### 4.3 MCP Tools Service

Recommended module:

```text
services/mcp-tools-service
```

Initial tools:

- `searchPortfolio`;
- `getProject`;
- `getBlog`;
- `retrieveChunks`;
- `rerankSources`;
- `queryChatHistory`.

---

## 5. Infrastructure Setup Scope

### 5.1 Local docker-compose components

```text
postgres
redis
redpanda or kafka
elasticsearch
kibana
prometheus
grafana
otel-collector
```

### 5.2 PostgreSQL extensions

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;
```

### 5.3 Kafka topics

```text
chat-events
quality-scores
chat-errors
frontend-events
```

Recommended local topic settings:

```text
partitions: 3
replication-factor: 1
retention: 7d
```

---

## 6. Suggested Issues

### Issue 1: Add frontend telemetry client

Scope:

- Add `chatTelemetryClient.js`;
- Replace raw logger in ChatWidget;
- Emit frontend events for message submit, SSE start, final response, client error.

### Issue 2: Define chat event and database schema

Scope:

- Add SQL migration for `chat_sessions`, `chat_messages`, `chat_quality_scores`;
- Add JSON schema docs for `ChatEvent` and `QualityScore`.

### Issue 3: Build chat orchestrator service skeleton

Scope:

- Spring Boot service;
- `/api/rag/answer/stream` endpoint;
- mock streaming response;
- OpenTelemetry trace skeleton.

### Issue 4: Implement Redis session service

Scope:

- Implement `RedisSessionService`;
- Replace in-memory session usage;
- Add TTL and dedup keys.

### Issue 5: Add Kafka chat event producer

Scope:

- Produce `chat-events` after final answer;
- Include trace/session/message metadata;
- Add retry / outbox consideration.

### Issue 6: Add Evaluation Service MVP

Scope:

- Consume `chat-events`;
- Run LLM-as-Judge;
- Write `chat_quality_scores`;
- Produce `quality-scores`.

---

## 7. Recommended Implementation Order

1. Documentation and schema;
2. Frontend telemetry client;
3. Backend stream endpoint skeleton;
4. PostgreSQL persistence;
5. Redis session;
6. Kafka ChatEvent;
7. Evaluation Service;
8. Analytics dashboard;
9. MCP tools;
10. Advanced framework workers such as LangGraph / AutoGen / CrewAI.

---

## 8. Non-goals for MVP

Do not include in the first implementation pass:

- Full multi-agent system;
- Production BigQuery pipeline;
- PagerDuty integration;
- Complex LangGraph state machine;
- AutoGen / CrewAI worker;
- Multi-tenant auth model;
- Full prompt registry;
- Full experiment platform.

These should be added after the main ChatWidget → Orchestrator → Redis/PostgreSQL → Kafka path is stable.

---

## 9. Success Criteria

MVP is successful when:

- ChatWidget can stream answer from backend;
- Every request has traceId/sessionId/messageId;
- Chat history is persisted by backend, not frontend;
- Redis session allows backend horizontal scaling;
- Kafka receives `chat-events`;
- Evaluation Service can produce quality scores;
- Grafana/Kibana can show basic latency and error traces;
- The architecture can later plug in LangGraph, AutoGen, CrewAI, or LlamaIndex without changing the ChatWidget contract.
