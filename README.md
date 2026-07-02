# Yuqi Guo's Portfolio Blog

A modern Next.js portfolio application for showcasing projects, blogs, CV, visitor analytics, and an AI-powered portfolio assistant. The site is designed as both a personal portfolio and a microservice-backed engineering platform, with serverless frontend APIs, Supabase-backed content storage, Kafka-based event fan-out, OpenSearch search, pgvector RAG indexing, notification delivery, and a real-time visitor analytics pipeline.

🌐 Production: https://www.yuqi.site

---

## Architecture

```mermaid
flowchart LR
    subgraph FRONTEND["<span style='font-size:22px;font-weight:800'>▲ Portfolio (Vercel)</span>"]
        direction TB
        UI["<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nextjs/nextjs-original.svg' width='40' height='40' style='width:40px;height:40px' /><br/><b>Portfolio UI</b><br/><small>Next.js pages · blog · CV</small><br/><small>chat widget · 3D globe</small>"]
        JWT["🔐 <b>JWT Auth</b><br/><small>Supabase JWT verify</small>"]
        APIR["<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nginx/nginx-original.svg' width='56' height='56' style='width:56px;height:56px' /><br/><b>API Proxy</b><br/><small>/api/track · /api/click</small><br/><small>/api/agent · /api/rag · /api/admin</small><br/><small>/api/subscriptions · /api/analytics</small>"]
        UI --> APIR
        JWT -.-> APIR
    end

    subgraph VPC["<span style='font-size:22px;font-weight:800'>☁️ Google Cloud VPC</span>"]
        direction LR

        REDIS_SESS["<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/redis/redis-original.svg' width='16' height='16' style='width:16px;height:16px' /> <b>Redis</b><br/><small>session store</small>"]

        %% ================= AI Platform · portfolio-ai-platform =================
        subgraph AI_SYS["<span style='font-size:22px;font-weight:800'>🧠 AI Platform · portfolio-ai-platform</span>"]
            direction LR
            AGENT["<b>Agent Service</b><br/><small>intent · LLM orchestration</small>"]
            MCP["<b>MCP Gateway</b><br/><small>typed tools · RBAC · audit</small>"]
            RAGR["<b>RAG Retriever</b><br/><small>pgvector search · rerank</small>"]
            subgraph LLM["<span style='font-size:9px'>LLM</span>"]
                direction TB
                GEMINI["<img src='https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googlegemini.svg' width='8' height='8' style='width:8px;height:8px' /> <span style='font-size:9px'>Gemini</span>"]
                OPENAI["<img src='https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/openai.svg' width='8' height='8' style='width:8px;height:8px' /> <span style='font-size:9px'>OpenAI</span>"]
            end
            AGENT <--> MCP
            AGENT --> RAGR
            AGENT -.->|Resilience4j: circuit breaker · retry| GEMINI
            AGENT -.->|Resilience4j: circuit breaker · retry| OPENAI
        end

        %% ================= Content Platform · portfolio-admin-service =================
        subgraph CONTENT_SYS["<span style='font-size:22px;font-weight:800'>🛡️ Content Platform · portfolio-admin-service</span>"]
            direction LR
            ADMIN_API["<b>Admin API</b><br/><small>content CRUD · optimistic lock</small>"]
            OUTBOX["<b>Outbox Publisher</b><br/><small>transactional outbox</small>"]
            KAC@{ shape: das, label: "<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg' width='16' height='16' style='width:16px;height:16px' /> content-index" }
            SIDX["<b>Search Indexer</b><br/><small>OpenSearch projection</small>"]
            RIDX["<b>RAG Indexer</b><br/><small>chunk · embed</small>"]
            AOS["<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/elasticsearch/elasticsearch-original.svg' width='16' height='16' style='width:16px;height:16px' /> <b>OpenSearch</b><br/><small>search index</small>"]
            RAGDB@{ shape: cyl, label: "<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original.svg' width='16' height='16' style='width:16px;height:16px' /> <b>PostgreSQL</b><br/>rag_db" }
            ADMIN_API --> OUTBOX --> KAC
            KAC --> SIDX --> AOS
            KAC --> RIDX --> RAGDB
        end

        %% ================= Notification Platform · portfolio-notification-service =================
        subgraph NOTIF_SYS["<span style='font-size:22px;font-weight:800'>🔔 Notification Platform · portfolio-notification-service</span>"]
            direction LR
            SUB["<b>Subscription API</b><br/><small>subscribe · prefs</small>"]
            CEC["📥 <b>Content Subscriber</b><br/><small>@KafkaListener · portfolio.content-events</small>"]
            KNO@{ shape: das, label: "<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg' width='16' height='16' style='width:16px;height:16px' /> notification-dispatch" }
            EMW["<b>Email Worker</b><br/><small>template · retry · backoff</small>"]
            DTR["<b>Delivery Tracker</b><br/><small>sent · delivered · bounced</small>"]
            NPG@{ shape: cyl, label: "<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original.svg' width='16' height='16' style='width:16px;height:16px' /> <b>PostgreSQL</b><br/>notif_db" }
            SUB --> KNO
            CEC --> KNO
            KNO --> EMW --> DTR --> NPG
        end

        %% ================= Analytics Platform · portfolio-analytics-platform =================
        %% modules: analytics-aggregator-service (consumer, enrich, rollup, session, backfill, Visits API)
        %%          + analytics-alerts-service + analytics-common
        subgraph ANALYTICS_SYS["<span style='font-size:22px;font-weight:800'>📊 Analytics Platform · portfolio-analytics-platform</span>"]
            direction LR
            KAN@{ shape: das, label: "<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg' width='16' height='16' style='width:16px;height:16px' /> analytics.events.raw" }
            AGG["<b>Aggregator</b><br/><small>RawEventConsumer · UA/IP/geo · rollups</small>"]
            SESS["<b>Session Aggregator</b><br/><small>funnel · sessions</small>"]
            BACKFILL["<b>Backfill Job</b><br/><small>rollup replay · retention</small>"]
            DLQ@{ shape: das, label: "<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg' width='16' height='16' style='width:16px;height:16px' /> analytics.events.dlq" }
            VIS["<b>Visits API</b><br/><small>cache · ETag · 304</small>"]
            ALERTS["<b>Alerts Service</b><br/><small>SLO · anomaly · email</small>"]
            ANPG@{ shape: cyl, label: "<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original.svg' width='16' height='16' style='width:16px;height:16px' /> <b>PostgreSQL</b><br/>analytics_db" }
            AVALK["<img src='https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/redis/redis-original.svg' width='16' height='16' style='width:16px;height:16px' /> <b>Redis</b><br/><small>dedup cache</small>"]
            KAN --> AGG
            AGG -.->|bad records| DLQ
            AGG --> SESS
            AGG --> BACKFILL
            AGG --> AVALK
            AGG --> ANPG
            SESS --> ANPG
            BACKFILL --> ANPG
            VIS --> ANPG
            VIS --> AVALK
            ALERTS --> ANPG
        end

        %% ================= External =================
        MAIL["✉️<br/><b>Email Provider</b><br/><small>SMTP · Resend · SES</small>"]

        %% ================= Edges =================
        APIR --> AGENT
        APIR --> REDIS_SESS
        APIR --> ADMIN_API
        APIR --> SUB
        APIR --> KAN
        APIR --> VIS

        MCP --> ADMIN_API
        MCP --> SUB
        MCP --> VIS
        RAGR --> RAGDB
        KAC -->|content-events → subscription update| CEC
        DTR --> MAIL
        ALERTS --> MAIL
    end

    UI --> APIR

    %% ================= Styling =================
    classDef edge    fill:#ffffff,stroke:#0f766e,stroke-width:1.4px,color:#0f172a;
    classDef svc     fill:#ffffff,stroke:#334155,stroke-width:1.1px,color:#111827;
    classDef kafka   fill:#faf5ff,stroke:#7c3aed,stroke-width:1.4px,color:#4c1d95;
    classDef db      fill:#eff6ff,stroke:#1e40af,stroke-width:1.1px,color:#1e3a8a;
    classDef redis   fill:#fef2f2,stroke:#dc2626,stroke-width:1.2px,color:#7f1d1d;
    classDef ext     fill:#f9fafb,stroke:#4b5563,stroke-width:1px,color:#111827;
    classDef client  fill:#eef2ff,stroke:#4338ca,stroke-width:2px,color:#1e1b4b,font-size:14px;
    classDef ui      fill:#f0fdfa,stroke:#0d9488,stroke-width:2px,color:#134e4a,font-size:14px;

    class UI ui;
    class APIR,JWT edge;
    %% Client class removed
    class AGENT,MCP,RAGR,ADMIN_API,OUTBOX,SIDX,RIDX,SUB,CEC,EMW,DTR,AGG,SESS,BACKFILL,ALERTS,VIS svc;
    class KAC,KNO,KAN,DLQ kafka;
    class AOS,RAGDB,NPG,ANPG db;
    class REDIS_SESS,AVALK redis;
    class GEMINI,OPENAI,MAIL ext;

    style FRONTEND      fill:#f0fdfa,stroke:#0d9488,stroke-width:1.5px,color:#134e4a;
    style VPC           fill:#eff6ff,stroke:#93c5fd,stroke-width:1.5px,color:#1e3a8a;
    style AI_SYS        fill:#f5f3ff,stroke:#8b5cf6,stroke-dasharray:4 3;
    style LLM           fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:4 3;
    style CONTENT_SYS   fill:#fffbeb,stroke:#d97706,stroke-dasharray:4 3;
    style NOTIF_SYS     fill:#fef2f2,stroke:#ef4444,stroke-dasharray:4 3;
    style ANALYTICS_SYS fill:#ecfdf5,stroke:#059669,stroke-dasharray:4 3;
```

---

## Microservices GitHub Repositories

| Service                            | Repository                                                                                                | Responsibility                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Portfolio Frontend**             | [YuqiGuo105/Portfolio](https://github.com/YuqiGuo105/Portfolio)                                           | Next.js frontend, project pages, blogs, API proxy routes, chat widget, visitor globe                          |
| **portfolio-ai-platform**          | [YuqiGuo105/portfolio-ai-platform](https://github.com/YuqiGuo105/portfolio-ai-platform)                   | Agent service, intent classification, LLM orchestration, MCP gateway, typed tools, RBAC, idempotency, audit   |
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
