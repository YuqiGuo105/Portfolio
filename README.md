# Yuqi Guo's Portfolio Platform

A modern Next.js portfolio application for showcasing projects, blogs, CV, visitor analytics, and an AI-powered portfolio assistant. The site is designed as both a personal portfolio and a microservice-backed engineering platform, with serverless frontend APIs, Supabase-backed content storage, Kafka-based event fan-out, OpenSearch search, pgvector RAG indexing, notification delivery, and a real-time visitor analytics pipeline.

**Production:** https://www.yuqi.site

---

## Architecture

<p align="center">
  <img src="docs/architecture/platform-system-flow.svg" alt="Portfolio microservice platform architecture" width="100%" />
</p>

> **Maintain this diagram:** edit [`docs/architecture/platform-system-flow.json`](docs/architecture/platform-system-flow.json), then run `node scripts/render-architecture-diagram.mjs docs/architecture/platform-system-flow.json`.

---

## Admin / MCP Operations

Sign in to the protected admin console, enter a platform command, review the
proposed action, and confirm it. Read operations run immediately; write
operations require explicit approval.

<p align="center">
  <img src="docs/readme-assets/admin-mcp-operate-console.png" alt="Admin MCP operate console" width="760" />
</p>

### Connect from Codex

Open **+ → Plugins**, select **Yuqi Portfolio**, and ask Codex to use its tools.
For direct MCP setup:

```sh
codex mcp add yuqi-portfolio --url https://www.yuqi.site/mcp
codex mcp add yuqi-portfolio-admin --url https://www.yuqi.site/mcp/admin
```

Complete sign-in when prompted for admin tools. Write operations still require
explicit confirmation.

<p align="center">
  <img src="docs/readme-assets/codex-yuqi-portfolio-plugin.png" alt="Yuqi Portfolio plugin available in Codex" width="680" />
</p>

---

## Chrome Extension: Application Copilot

Application Copilot is a Chrome Manifest V3 extension that runs directly on job
application pages. Select **Auto-fill Application**, review the resolved fields,
and apply the approved values. Resume attachment is automatic; final submission
remains manual.

<p align="center">
  <a href="https://github.com/YuqiGuo105/portfolio-application-copilot">
    <img src="docs/readme-assets/application-copilot-autofill.png" alt="Portfolio Application Copilot reviewing an autofilled job application" width="820" />
  </a>
</p>

**[View the Chrome extension repository →](https://github.com/YuqiGuo105/portfolio-application-copilot)**

---

## Microservices GitHub Repositories

| Service                            | Repository                                                                                                | Responsibility                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Portfolio Frontend**             | [YuqiGuo105/Portfolio](https://github.com/YuqiGuo105/Portfolio)                                           | Next.js frontend, project pages, blogs, API proxy routes, chat widget, visitor globe                          |
| **Public Portfolio MCP Server**    | [YuqiGuo105/portfolio-mcp-server](https://github.com/YuqiGuo105/portfolio-mcp-server)                     | Public, read-only Streamable HTTP MCP tools for projects, articles, architecture diagrams, and profile data   |
| **portfolio-ai-platform**          | [YuqiGuo105/portfolio-ai-platform](https://github.com/YuqiGuo105/portfolio-ai-platform)                   | Agent service (safety → retrieval → generation pipeline, event observability), knowledge service (hybrid BM25+kNN, RRF, OpenAI embed), MCP gateway (typed tools, RBAC, idempotency, audit) |
| **portfolio-admin-service**        | [YuqiGuo105/portfolio-admin-service](https://github.com/YuqiGuo105/portfolio-admin-service)               | Content CRUD, optimistic concurrency, transactional outbox, Kafka publishing, OpenSearch indexer, RAG indexer |
| **portfolio-notification-service** | [YuqiGuo105/portfolio-notification-service](https://github.com/YuqiGuo105/portfolio-notification-service) | Subscription APIs, notification dispatch, email sender worker, retry handling, delivery tracking              |
| **portfolio-analytics-platform**   | [YuqiGuo105/portfolio-analytics-platform](https://github.com/YuqiGuo105/portfolio-analytics-platform)     | Spring Boot Kafka batch consumer, UA/IP/geo enrichment, Valkey dedup, pre-aggregated 5m + 1d rollups, public visits API, alerts service |
| **portfolio-application-copilot**  | [YuqiGuo105/portfolio-application-copilot](https://github.com/YuqiGuo105/portfolio-application-copilot)   | Chrome MV3 assisted application UI, MCP career workflow, encrypted application memory, and private resume vault |

---

## Features

* **Modern portfolio frontend** built with Next.js, including projects, blogs, CV, parallax project detail pages, and guided navigation.
* **AI chat assistant** with RAG retrieval, multi-round reasoning, intent classification, and MCP tool execution.
* **Public MCP integration** that gives ChatGPT, Claude, GitHub Copilot, Cursor, and other MCP clients read-only access to projects, articles, stored architecture diagrams, and public profile data.
* **Application Copilot** that combines an authenticated Chrome extension, MCP workflow, deterministic field resolution, private resume assets, and explicit review before any sensitive field is applied.
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
