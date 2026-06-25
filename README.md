# Yuqi Guo's Portfolio Blog

A modern Next.js portfolio application for showcasing projects, blogs, CV, visitor analytics, and an AI-powered portfolio assistant. The site is designed as both a personal portfolio and a microservice-backed engineering platform, with serverless frontend APIs, Supabase-backed content storage, Kafka-based event fan-out, OpenSearch search, pgvector RAG indexing, notification delivery, and a real-time visitor analytics pipeline.

🌐 Production: https://www.yuqi.site

---

## Architecture

```mermaid
flowchart LR
    %% =========================
    %% Frontend
    %% =========================
    subgraph FE["🌐 Next.js Frontend · yuqi.site"]
        UI["🧭 Portfolio UI<br/><small>3D Globe · Projects · Blog · CV · /analytics dashboard</small>"]
        Chat["💬 AI Chat Widget"]
        AdminDash["🛠️ Admin Dashboard"]
        Track["📡 /api/track<br/><small>kafkajs producer · UUIDv7 dedup key · best-effort</small>"]
        Proxy["🔀 API Routes<br/><small>serverless proxy layer</small>"]
    end

    %% =========================
    %% AI Platform
    %% =========================
    subgraph AI["🤖 portfolio-ai-platform"]
        Agent["Agent Service<br/><small>intent classification · LLM orchestration · RAG planning</small>"]
        MCP["MCP Gateway<br/><small>typed tools · RBAC · idempotency · audit</small>"]
        Agent --> MCP
    end

    %% =========================
    %% Admin Platform
    %% =========================
    subgraph ADMIN["🛡️ portfolio-admin-service"]
        AdminAPI["Admin Service<br/><small>content CRUD · optimistic concurrency · transactional outbox</small>"]
        OutboxPub["Outbox Publisher<br/><small>reliable event publishing</small>"]
        SearchIndexer["Search Indexer<br/><small>Kafka consumer · OpenSearch projection</small>"]
        RAGIndexer["RAG Indexer<br/><small>Kafka consumer · chunking · embeddings · pgvector</small>"]

        AdminAPI --> OutboxPub
    end

    %% =========================
    %% Notification Platform
    %% =========================
    subgraph NOTIF["🔔 portfolio-notification-service"]
        NotifAPI["Subscription / Notification API<br/><small>subscribe · unsubscribe · preferences</small>"]
        Dispatch["Dispatch Service<br/><small>fan-out · batching · dedupe · idempotency</small>"]
        EmailWorker["Email Sender Worker<br/><small>retry · backoff · provider adapter</small>"]
        Delivery["Delivery Tracking<br/><small>sent · failed · bounced · audit log</small>"]

        NotifAPI --> Dispatch
        Dispatch --> EmailWorker
        EmailWorker --> Delivery
    end

    %% =========================
    %% Analytics Platform
    %% =========================
    subgraph ANALYTICS["📊 portfolio-analytics-platform"]
        Aggregator["Aggregator Service<br/><small>batch Kafka consumer · UA/IP/Geo enrichment · in-memory pre-aggregation · UPSERT batchUpdate</small>"]
        Alerts["Alerts Service<br/><small>SLO checks · anomaly detection · notify hooks</small>"]
        VisitsAPI["Public Visits API<br/><small>/api/public/visits/{summary,markers,markers/area}</small>"]
        Aggregator --> VisitsAPI
    end

    %% =========================
    %% Event Streaming
    %% =========================
    subgraph STREAM["⚙️ Event Streaming Layer"]
        Kafka[["Kafka<br/><small>event bus · queue semantics · partitions · consumer groups · replay</small>"]]
        ContentTopic[["content.index.events<br/><small>content changed · project updated · blog published</small>"]]
        NotificationTopic[["notification.dispatch.events<br/><small>subscriber fan-out jobs</small>"]]
        AnalyticsRaw[["analytics.raw.events<br/><small>page_view · click · 2 partitions · SASL_SSL/SCRAM-SHA-256</small>"]]
        AnalyticsDLQ[["analytics.events.dlq<br/><small>malformed payloads · parse errors</small>"]]

        Kafka --> ContentTopic
        Kafka --> NotificationTopic
        Kafka --> AnalyticsRaw
        Kafka --> AnalyticsDLQ
    end

    %% =========================
    %% Data Stores
    %% =========================
    subgraph DATA["🗄️ Data Stores"]
        Supabase[("Supabase PostgreSQL<br/><small>source of truth · pgvector · RLS · visitor_logs · geo_time_rollups</small>")]
        OpenSearch[("OpenSearch<br/><small>search projection · ranking · analytics</small>")]
        Valkey[("Valkey (Redis)<br/><small>SETNX dedup · 24h TTL · geo cache</small>")]
    end

    %% =========================
    %% External Providers
    %% =========================
    EmailProvider["📧 Email Provider<br/><small>SMTP · SendGrid · SES</small>"]

    %% =========================
    %% Frontend traffic
    %% =========================
    UI -->|"/api/search"| OpenSearch
    UI -->|"page_view beacon"| Track
    UI -->|"/api/analytics/visits/* (proxied)"| VisitsAPI
    Chat -->|"/api/agent/*"| Agent
    AdminDash -->|"/api/admin/*"| AdminAPI
    Proxy -->|"/api/subscriptions & notifications"| NotifAPI

    %% =========================
    %% AI tool calls
    %% =========================
    MCP -->|"authorized tool calls"| AdminAPI

    %% =========================
    %% Writes and event publishing
    %% =========================
    AdminAPI -->|"primary content writes"| Supabase
    OutboxPub -->|"ContentIndexEvent"| Kafka
    NotifAPI -->|"subscription state"| Supabase
    Track -->|"visitor_logs row (source of truth)"| Supabase
    Track -->|"RawEvent JSON (best-effort)"| AnalyticsRaw

    %% =========================
    %% Async consumers
    %% =========================
    ContentTopic -->|"consume content events"| SearchIndexer
    ContentTopic -->|"consume content events"| RAGIndexer
    NotificationTopic -->|"consume dispatch jobs"| Dispatch
    AnalyticsRaw -->|"batch poll · max.poll.records=100"| Aggregator
    Aggregator -.->|"malformed → DLQ"| AnalyticsDLQ

    %% =========================
    %% Analytics dedup + rollups
    %% =========================
    Aggregator -->|"SETNX eventId (24h TTL)"| Valkey
    Aggregator -->|"batchUpdate geo_time_rollups (5m + 1d)"| Supabase
    Alerts -->|"poll rollups"| Supabase

    %% =========================
    %% Projections / derived stores
    %% =========================
    SearchIndexer -->|"update search documents"| OpenSearch
    RAGIndexer -->|"store chunks + embeddings"| Supabase

    %% =========================
    %% Notification delivery
    %% =========================
    Dispatch -->|"create delivery jobs"| NotificationTopic
    EmailWorker -->|"send email"| EmailProvider
    Delivery -->|"delivery status"| Supabase
```

Key properties:

* **At-least-once with idempotency.** Kafka redelivers on DB failure (no ack);
  Valkey `SETNX(eventId, 24h)` guarantees the rollup row is never
  double-counted.
* **One DB round-trip per Kafka poll.** The aggregator pre-aggregates a
  100-record batch in memory keyed by the full UPSERT-conflict tuple, then
  fires a single `jdbc.batchUpdate` per granularity tier (5m + 1d).
* **Truth-data geo centroids.** Enrichment snaps each event to a `geo_areas`
  row (continent / country / region / metro), so map markers use real
  population-weighted centroids instead of raw lat/lng noise.
* **Best-effort producer side.** The Vercel function uses kafkajs with a
  warm-cached singleton producer, 5 s connect timeout, 8 s request timeout,
  2 retries — any Kafka outage degrades to Supabase-only writes.

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
