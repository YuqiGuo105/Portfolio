# Yuqi Guo's Portfolio Platform

A modern Next.js portfolio application for showcasing projects, blogs, CV, visitor analytics, and an AI-powered portfolio assistant. The site is designed as both a personal portfolio and a microservice-backed engineering platform, with serverless frontend APIs, Supabase-backed content storage, Kafka-based event fan-out, OpenSearch search, pgvector RAG indexing, notification delivery, and a real-time visitor analytics pipeline.

**Production:** https://www.yuqi.site

---

## Architecture

```mermaid
flowchart LR
    %% ================= Frontend =================
    subgraph FRONTEND["▲ PORTFOLIO FRONTEND · VERCEL"]
        UI["🖥️ Portfolio UI\nNext.js · Blog · Projects · CV\nChat Widget · 3D Visitor Globe"]
        AUTH["🔐 Supabase JWT Guard\nrequireSupabaseUser\nADMIN_ALLOWED_EMAILS gating"]
        API_PROXY["🌐 Serverless API Routes\n/api/agent/chat · /api/rag/answer/stream\n/api/search · /api/track · /api/click\n/api/subscriptions · /api/analytics"]

        UI --> API_PROXY
        AUTH -.-> API_PROXY
    end

    %% ================= Backend =================
    subgraph CLOUD["☁️ GOOGLE CLOUD / MANAGED BACKEND"]
        SESSION_CACHE@{ shape: lin-cyl, label: "⚡ Valkey (frontend)\n/api/track rate limit\nshared across Vercel replicas" }

        %% ================= AI Platform =================
        subgraph AI_SYS["🧠 AI PLATFORM · portfolio-ai-platform"]
            AGENT["🤖 Agent Service\nsafety → retrieval → generation\nintent classify · RBAC · SSE /api/chat"]
            MCP["🧰 MCP Gateway\ntyped tool catalog · risk gating\nidempotency · audit log"]
            KNOWLEDGE["🔎 Knowledge Service\nhybrid BM25+kNN · RRF merge\nOpenAI embed · /internal/v1/knowledge/search"]
            LLM["✨ LLM Providers\nGemini 2.5 Flash/Pro (safety + gen)\nOpenAI text-embedding-3-small"]
            AI_EVENTS@{ shape: cyl, label: "📡 OpenSearch Event Store\nai-agent-runs · ai-answers\nai-safety · ai-retrieval\nai-model-calls" }
            OS_KB@{ shape: cyl, label: "🔎 OpenSearch KB\nportfolio-knowledge-*\nBM25 + kNN chunks" }

            AGENT <--> MCP
            AGENT --> KNOWLEDGE
            KNOWLEDGE -.-> LLM
            AGENT -.-> LLM
            AGENT -. "event outbox" .-> AI_EVENTS
        end

        %% ================= Content Platform =================
        subgraph CONTENT_SYS["🛡️ CONTENT PLATFORM · portfolio-admin-service"]
            ADMIN_API["☕ Admin Service\nBlogs · Projects · Life · Experience\nCRUD · publish · versioning · outbox"]

            CONTENT_DB@{ shape: cyl, label: "🐘 Supabase Postgres\nsource tables · content_versions\noutbox · indexing_jobs · audit" }

            CONTENT_TOPIC@{ shape: das, label: "🟣 Kafka\ncontent.search.index.v1\ncontent.rag.index.v1" }

            SEARCH_INDEXER["🔍 Search Indexer\nconsume search.index.v1\nGemini doc2query · upsert index"]

            RAG_INDEXER["🧩 RAG Indexer\nconsume rag.index.v1\nchunk · OpenAI embed (1536d)"]

            OPENSEARCH@{ shape: cyl, label: "🔎 OpenSearch (Aiven)\nportfolio_content_current" }

            RAG_DB@{ shape: cyl, label: "🐘 Supabase pgvector\nkb_documents (ACTIVE chunks)" }

            ADMIN_API --> CONTENT_DB

            ADMIN_API -->|post-commit publish| CONTENT_TOPIC

            CONTENT_TOPIC -->|consume| SEARCH_INDEXER
            SEARCH_INDEXER -.->|fetch source doc| CONTENT_DB
            SEARCH_INDEXER --> OPENSEARCH

            CONTENT_TOPIC -->|consume| RAG_INDEXER
            RAG_INDEXER -.->|fetch source doc| CONTENT_DB
            RAG_INDEXER --> RAG_DB
        end

        %% ================= Notification Platform =================
        subgraph NOTIF_SYS["🔔 NOTIFICATION PLATFORM · portfolio-notification-service"]
            SUB_API["📬 Notification Service\nsubscribe · preferences · unsubscribe\nKafka fan-out · web feed"]

            NOTIF_DB@{ shape: cyl, label: "🐘 Supabase Postgres\nsubscribers · preferences\nnotifications · recipients" }

            DISPATCH_TOPIC@{ shape: das, label: "📥 Email Dispatch Queue\nnotification_recipients · PENDING\npoll 15s · exponential backoff" }

            EMAIL_WORKER["✉️ Email Dispatch Worker\nclaim batch · render HTML+text\nmax 5 retries · 60→960s backoff"]

            DELIVERY_TRACKER["📈 Delivery Tracker\nPENDING · SENT · FAILED\nREAD · SKIPPED"]

            EMAIL_PROVIDER["📨 Email Provider (SMTP)\nJavaMailSender · Gmail relay"]

            SUB_API --> NOTIF_DB
            SUB_API -->|insert PENDING recipients| DISPATCH_TOPIC

            DISPATCH_TOPIC -->|scheduler claims batch| EMAIL_WORKER
            EMAIL_WORKER --> DELIVERY_TRACKER
            DELIVERY_TRACKER --> NOTIF_DB

            EMAIL_WORKER --> EMAIL_PROVIDER
        end

        %% ================= Analytics Platform =================
        subgraph ANALYTICS_SYS["📊 ANALYTICS PLATFORM · portfolio-analytics-platform"]
            RAW_TOPIC@{ shape: das, label: "🟣 Kafka\nanalytics.raw.events\nSASL_SSL · SCRAM-SHA-256" }

            ANALYTICS_CONSUMER["⚙️ Aggregator Consumer\nUA · IP-hash · geo-snap enrich\nmax.poll 100 · manual ack"]

            ANALYTICS_DB@{ shape: cyl, label: "🐘 Supabase Postgres\nvisitor_logs · geo_time_rollups\nsessions · funnel_steps" }

            DEDUP_CACHE@{ shape: lin-cyl, label: "⚡ Valkey\nSETNX analytics:eid: · 24h TTL\nresponse cache · IP rate limit" }

            DLQ@{ shape: das, label: "🟣 Kafka\nanalytics.events.dlq\nretention 14d" }

            SESSION_AGG["🧭 Session Aggregator\nsessions · funnel_steps\nentry/exit · duration"]

            ROLLUP_JOB["🧮 Rollup · Retention Job\n5m + 1d rollups · daily 03:15\nreplay backfill from visitor_logs"]

            VISITS_API["🌎 Public Visits API\n/visits/summary · markers · sessions\nETag · 304 · 30s cache"]

            ALERTS["🚨 Alerts Service\nalert_rules · incidents\npoll 1m · notify on breach"]

            RAW_TOPIC -->|batch of 100| ANALYTICS_CONSUMER

            ANALYTICS_CONSUMER -->|batchUpdate visitor_logs + rollups| ANALYTICS_DB
            ANALYTICS_CONSUMER -->|SETNX dedup| DEDUP_CACHE
            ANALYTICS_CONSUMER -.->|parse errors| DLQ

            ANALYTICS_DB --> SESSION_AGG
            SESSION_AGG --> ANALYTICS_DB

            ANALYTICS_DB --> ROLLUP_JOB
            ROLLUP_JOB --> ANALYTICS_DB

            VISITS_API -->|read rollups + sessions| ANALYTICS_DB
            VISITS_API --> DEDUP_CACHE

            ALERTS -->|poll rollups| ANALYTICS_DB
        end

        %% ================= Intra-cloud connections =================
        ADMIN_API -->|content.notification.*.v1 Kafka| SUB_API

        MCP -->|admin.* tools| ADMIN_API
        MCP -->|notification.* tools| SUB_API

        SEARCH_INDEXER -.->|Gemini doc2query| LLM
        RAG_INDEXER -.->|OpenAI embeddings| LLM

        ALERTS -->|POST /api/content-events| SUB_API
    end

    %% ================= Cross-subgraph (Frontend → Cloud) =================
    API_PROXY -->|/api/agent/chat SSE| AGENT
    API_PROXY -->|/api/admin dashboard| ADMIN_API
    API_PROXY -->|/api/subscriptions| SUB_API
    API_PROXY -->|/api/track · /api/click| RAW_TOPIC
    API_PROXY -->|/api/analytics /visits/*| VISITS_API
    API_PROXY -->|rate limit| SESSION_CACHE
    API_PROXY -->|/api/search| OPENSEARCH
    API_PROXY -->|/api/rag/answer/stream (serverless)\nGemini + pgvector direct| RAG_DB
    API_PROXY -.->|Kafka down fallback| ANALYTICS_DB

    %% ================= Styles =================
    classDef frontend fill:#ecfeff,stroke:#0891b2,stroke-width:1.8px,color:#164e63
    classDef service fill:#ffffff,stroke:#334155,stroke-width:1.2px,color:#0f172a
    classDef database fill:#eff6ff,stroke:#2563eb,stroke-width:1.4px,color:#1e3a8a
    classDef kafka fill:#faf5ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef cache fill:#fff7ed,stroke:#f97316,stroke-width:1.7px,color:#7c2d12
    classDef external fill:#f9fafb,stroke:#6b7280,stroke-width:1.1px,color:#111827

    class UI,AUTH,API_PROXY frontend
    class AGENT,MCP,KNOWLEDGE,ADMIN_API,SEARCH_INDEXER,RAG_INDEXER,SUB_API,EMAIL_WORKER,DELIVERY_TRACKER,ANALYTICS_CONSUMER,SESSION_AGG,ROLLUP_JOB,VISITS_API,ALERTS service
    class CONTENT_DB,RAG_DB,NOTIF_DB,ANALYTICS_DB,OPENSEARCH,OS_KB,AI_EVENTS database
    class CONTENT_TOPIC,DISPATCH_TOPIC,RAW_TOPIC,DLQ kafka
    class SESSION_CACHE,DEDUP_CACHE cache
    class LLM,EMAIL_PROVIDER external

    style FRONTEND fill:#ecfeff,stroke:#0891b2,stroke-width:2px,color:#164e63
    style CLOUD fill:#f8fafc,stroke:#94a3b8,stroke-width:2px,color:#0f172a
    style AI_SYS fill:#f5f3ff,stroke:#8b5cf6,stroke-width:2px,color:#4c1d95
    style CONTENT_SYS fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#78350f
    style NOTIF_SYS fill:#fef2f2,stroke:#ef4444,stroke-width:2px,color:#7f1d1d
    style ANALYTICS_SYS fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#064e3b
```

---

## Microservices GitHub Repositories

| Service                            | Repository                                                                                                | Responsibility                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Portfolio Frontend**             | [YuqiGuo105/Portfolio](https://github.com/YuqiGuo105/Portfolio)                                           | Next.js frontend, project pages, blogs, API proxy routes, chat widget, visitor globe                          |
| **portfolio-ai-platform**          | [YuqiGuo105/portfolio-ai-platform](https://github.com/YuqiGuo105/portfolio-ai-platform)                   | Agent service (safety → retrieval → generation pipeline, event observability), knowledge service (hybrid BM25+kNN, RRF, OpenAI embed), MCP gateway (typed tools, RBAC, idempotency, audit) |
| **portfolio-admin-service**        | [YuqiGuo105/portfolio-admin-service](https://github.com/YuqiGuo105/portfolio-admin-service)               | Content CRUD, optimistic concurrency, transactional outbox, Kafka publishing, OpenSearch indexer, RAG indexer |
| **portfolio-notification-service** | [YuqiGuo105/portfolio-notification-service](https://github.com/YuqiGuo105/portfolio-notification-service) | Subscription APIs, notification dispatch, email sender worker, retry handling, delivery tracking              |
| **portfolio-analytics-platform**   | [YuqiGuo105/portfolio-analytics-platform](https://github.com/YuqiGuo105/portfolio-analytics-platform)     | Spring Boot Kafka batch consumer, UA/IP/geo enrichment, Valkey dedup, pre-aggregated 5m + 1d rollups, public visits API, alerts service |

---

## Features

* **Modern portfolio frontend** built with Next.js, including projects, blogs, CV, parallax project detail pages, and guided navigation.
* **AI chat assistant** with RAG retrieval, multi-round reasoning, intent classification, and MCP tool execution.
* **Admin dashboard** for managing blogs, projects, life posts, and portfolio content.
* **Kafka-driven content pipeline** that publishes content change events to search, RAG, and notification consumers.
* **Professional search stack** using OpenSearch for indexed portfolio search and ranking.
* **RAG indexing pipeline** using embeddings stored in Supabase PostgreSQL with pgvector.
* **Notification system** with subscription management, dispatch service, email sender worker, retry handling, and delivery tracking.
* **Supabase backend** for PostgreSQL, pgvector, storage, RLS policies, and server-side API integration.
* **3D geospatial visitor globe** and a real-time `/analytics` dashboard powered by a Kafka → Spring Boot aggregator pipeline (Valkey dedup, pre-aggregated `geo_time_rollups`, public visits API).
* **SEO support** with reusable metadata, `robots.txt`, and `sitemap.xml`.

---

## Getting Started

Follow these steps to run the frontend locally.

### Prerequisites

* Node.js
* npm

Install the latest npm globally if needed:

```sh
npm install npm@latest -g
```

### Installation

Clone the repository:

```sh
git clone https://github.com/YuqiGuo105/Portfolio.git
cd Portfolio
```

Install dependencies:

```sh
npm install
```

Start the local development server:

```sh
npm run dev
```

Open the application at:

```txt
http://localhost:3000
```

To open the chat widget automatically, append `?openChat=1`:

```txt
http://localhost:3000/?openChat=1
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

```sh
cp .env.example .env.local
```

See [`.env.example`](.env.example) for all variables with descriptions. For production, configure the same variables in **Vercel → Project Settings → Environment Variables**.

---

## Supabase Setup

1. Create a Supabase project at [app.supabase.com](https://app.supabase.com).
2. Copy the Project URL and anon public API key from **Project Settings → API**.
3. Add them to `.env` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Copy the `service_role` key and set it as `SUPABASE_SERVICE_ROLE_KEY`.
5. Open the Supabase SQL Editor.
6. Run the schema and RLS policy script from `create_sql.txt` in the repository root.
7. Confirm that required tables, policies, and server-side access patterns are configured correctly.

---

## Usage

* Browse projects, blogs, and portfolio details.
* Use the contact form to send messages to the portfolio owner.
* Use the AI chat widget to ask questions about the portfolio.
* Use the Admin Dashboard to edit portfolio content.
* Use Supabase as the source of truth for editable content.
* Use OpenSearch for fast search experiences.
* Use Kafka consumers to keep search, RAG, and notifications in sync.

---

## SEO

This project includes basic SEO support:

* Reusable SEO metadata component
* Page-level titles and descriptions
* `robots.txt`
* `sitemap.xml`
* Production site URL configuration

---

## Contributing

Contributions are welcome. To contribute:

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Open a pull request with a clear description of the change.

---

## License

MIT License

Copyright (c) 2023 Yuqi Guo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
