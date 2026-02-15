# Yuqi Guo's Portfolio

A personal portfolio website built with **Next.js** showcasing professional work, technical blogs, life experiences, and real-time analytics. Features an AI-powered chat assistant using RAG (Retrieval-Augmented Generation) with SSE streaming and a 3D visitor globe.

**Live**: [https://www.yuqi.site](https://www.yuqi.site)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Core Systems](#core-systems)
  - [AI Chat System](#1-ai-chat-system)
  - [Real-time Analytics Dashboard](#2-real-time-analytics-dashboard)
  - [3D Visitor Globe](#3-3d-visitor-globe)
  - [Content Management](#4-content-management)
  - [Visitor Intelligence](#5-visitor-intelligence)
- [API Routes](#api-routes)
- [Database Schema](#database-schema)
- [Authentication Flow](#authentication-flow)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Technology Stack](#technology-stack)
- [Glossary](#glossary)

---

## Overview

### Purpose

This site serves as a full-featured portfolio and content hub with two primary audiences:

| Audience | Capabilities |
|---|---|
| **Visitors / Recruiters** | Browse projects, read technical and life blogs, view professional experience timeline, interact with AI chat assistant, explore real-time analytics dashboards |
| **Site Owner** | Manage content via Supabase console, receive contact form submissions by email, monitor visitor analytics on a 3D globe |

### Key Capabilities

- **AI Chat Assistant** -- Streaming, context-aware responses powered by a RAG system that searches blog embeddings for relevant information. Supports file uploads, MathJax LaTeX rendering, and two modes: FAST and DEEPTHINKING.
- **Real-time Analytics** -- Dashboard panels display live market data (Yahoo Finance), currency conversion, local weather, and visitor geolocation on an interactive 3D globe.
- **Content Management** -- Portfolio projects, technical blogs, and life blogs stored in Supabase with protected content requiring authentication.
- **Visitor Intelligence** -- Comprehensive tracking of page views, clicks, and geographic locations stored for analytics.
- **Instagram-like Stories** -- Hero section with modal stories viewer, auto-advancing with progress bars.
- **SEO** -- Meta tags via a reusable `SeoHead` component, `robots.txt` and `sitemap.xml` in `public/`.

---

## Architecture

```
                            +--------------------+
                            |    Vercel (CDN)    |
                            |  Next.js SSR/SSG   |
                            +---------+----------+
                                      |
              +-----------+-----------+-----------+-----------+
              |           |           |           |           |
       /api/track   /api/click  /api/market  /api/weather /api/currency
              |           |           |           |           |
              v           v           |           |           |
        +-----------+                 v           v           v
        |  Supabase |          Yahoo Finance  Open-Meteo  Exchange
        | PostgreSQL|          (+ fallback)   (+ ipwho)   Rate API
        |  + Vector |
        +-----------+
              ^
              |
     +--------+--------+
     |                  |
  ChatWidget      RotatingGlobe
  (SSE -> RAG)    (Supabase pins)
```

---

## Project Structure

```
Portfolio/
├── pages/
│   ├── index.js                       # Main landing page
│   ├── blog-single/[id].js           # Technical blog detail (dynamic route)
│   ├── life-blog/[id].js             # Life blog detail (protected, auth-gated)
│   ├── work-single/[id].js           # Project detail page
│   ├── works.js                       # Works gallery
│   └── api/
│       ├── track.js                   # Visitor page-view tracking
│       ├── click.js                   # Click event tracking
│       ├── contact.js                 # Contact form email (Nodemailer)
│       ├── market-data.js             # Yahoo Finance proxy with fallback
│       ├── currency.js                # Exchange rate conversion
│       ├── weather.js                 # Weather + IP geolocation
│       ├── search.js                  # Content search endpoint
│       └── hello.js                   # Health check
│
├── src/
│   ├── components/
│   │   ├── ChatWidget.js              # AI chat -- SSE streaming, file uploads, MathJax
│   │   ├── DashboardPanels.js         # Analytics dashboard -- market, currency, weather, visitors
│   │   ├── RotatingGlobe.js           # 3D globe -- react-globe.gl, adaptive clustering
│   │   ├── ProjectIsotop.js           # Portfolio grid with Isotope.js filtering
│   │   ├── ContactForm.js             # Contact form with email delivery
│   │   ├── LogInDialog.js             # Auth modal for protected content
│   │   ├── SiteTour.js                # Guided tour for first-time visitors
│   │   ├── SeoHead.js                 # Reusable meta tags component
│   │   ├── SearchOverlay.js           # Full-screen search overlay
│   │   ├── TestimonialSlider.js       # Testimonial carousel
│   │   └── WorkIsotope.js             # Works page grid
│   ├── layout/
│   │   ├── Layout.js                  # Page wrapper (Header + Footer + ChatWidget)
│   │   ├── Header.js                  # Navigation + dark/light theme switcher
│   │   ├── Footer.js                  # Social links
│   │   └── PreLoader.js               # Loading spinner
│   ├── supabase/
│   │   └── supabaseClient.js          # Singleton Supabase client instance
│   ├── lib/
│   │   └── searchItems.ts             # Search index definitions
│   ├── utils.js                       # Shared utility functions
│   ├── scrolla.js                     # Scroll animation helpers
│   └── sliderProps.js                 # Slider configuration
│
├── styles/
│   ├── globals.css                    # Global styles + dark/light themes + animations
│   ├── chatWidget.css                 # Chat widget styles (bubbles, stages, resize)
│   └── carousel.css                   # Blog carousel overrides
│
├── public/
│   ├── textures/earth_day_8k.jpg      # 8K globe texture
│   ├── robots.txt                     # SEO crawling rules
│   ├── sitemap.xml                    # SEO sitemap
│   └── assets/                        # Images, fonts, CSS vendors
│
├── .github/workflows/
│   └── deploy.yml                     # Vercel deployment via GitHub Actions
│
├── creat_sql.txt                      # Complete database schema (SQL)
├── next.config.js                     # Next.js configuration
└── package.json                       # Dependencies and scripts
```

---

## Core Systems

### 1. AI Chat System

**Files**: `src/components/ChatWidget.js`, `styles/chatWidget.css`

The most complex feature -- a full-featured chat interface with streaming AI responses.

#### How It Works

1. User sends a message (optionally with file attachments).
2. Files are uploaded to Supabase Storage with a 2-minute TTL via `uploadToSupabaseWithProgress()`.
3. A POST request is sent to the RAG API endpoint using Server-Sent Events (SSE) via `postSSE()`.
4. The backend streams events with stage indicators: `search`, `rerank`, `deep_plan_done`, etc.
5. `StageToast` displays real-time thinking stages (e.g., "Searching 12 documents...").
6. Markdown is rendered with `react-markdown` + `remark-gfm` + `rehype-highlight`.
7. LaTeX math expressions are rendered via MathJax v3 (loaded lazily from CDN).
8. Completed messages are persisted to the Supabase `Chat` table.

#### Key Functions

| Function | Purpose |
|---|---|
| `sendMessage()` | Orchestrates the full send flow: file upload, SSE stream, persistence |
| `startRagSSE()` | Initiates SSE connection to `/api/rag/answer/stream` |
| `postSSE()` | Generic SSE handler with AbortController and timeout |
| `setStage()` | Updates the thinking indicator with stage info and payload |
| `finalizeAssistant()` | Completes streaming, saves Q&A to Supabase |
| `pickFiles()` | File upload with progress tracking (max 2 files) |
| `ensureMathJaxLoaded()` | Lazy-loads MathJax v3 for LaTeX rendering |
| `escapeMathDelimitersOutsideCode()` | Preserves `\[...\]` and `\(...\)` delimiters through Markdown parsing |
| `maskIncompleteMathBlocks()` | Hides half-written math during streaming |
| `stripQAPrefix()` | Removes `[QA]` / `【QA】` markers from AI responses |

#### Chat Modes

| Mode | Description |
|---|---|
| **FAST** | Standard RAG: retrieve relevant docs, generate streaming answer |
| **DEEPTHINKING** | Extended reasoning with subtask planning. Shows a `TodoList` component with the AI's breakdown |

#### Session Management

- Sessions identified by UUID stored in `localStorage`.
- 15-minute TTL (`SESSION_TTL_MS`). Expired sessions auto-clear messages.
- Messages persisted to `localStorage` for tab-refresh survival.

---

### 2. Real-time Analytics Dashboard

**File**: `src/components/DashboardPanels.js`

Four interconnected dashboard panels rendered on the landing page.

#### Panels

| Panel | Data Source | Cache TTL | Fallback |
|---|---|---|---|
| **Market Data** | Yahoo Finance via `/api/market-data` | 2 min (in-memory) | `simulateFromBaseline()` wave simulation |
| **Currency Converter** | Exchange rate API via `/api/currency` | 10 min | `computeFallbackRate()` from static rates |
| **Weather** | Open-Meteo via `/api/weather` | 10 min | Static NYC data |
| **Visitor Insights** | Supabase `visitor_logs` (direct client query) | `localStorage` | Cached previous data |

#### Multi-Phase Visitor Fetching Strategy

The visitor panel uses a progressive data loading strategy to maximize perceived performance:

| Phase | What It Fetches | Why |
|---|---|---|
| **Phase -1** | Restore from `localStorage` cache | Instant display on repeat visits |
| **Phase 0** | Latest 120 located rows (no date filter) | Pins appear on globe immediately |
| **Phase 1** | 30-day sample (360 rows) | Compute top visitor sources |
| **Phase 1b** | Estimated counts + device UA parsing | Visitor count stats and device breakdown |
| **Phase 2** | All-time aggregation (runs during idle) | Complete pin coverage via `requestIdleCallback` |

---

### 3. 3D Visitor Globe

**File**: `src/components/RotatingGlobe.js`

Interactive 3D globe built with `react-globe.gl` showing visitor locations as pins.

#### Pin Fetching Strategy

The globe uses an adaptive **bootstrap -> focused** pin fetching approach:

1. **Bootstrap Mode**: On mount, fetches globally balanced pins using `balancedSamplePins()` which divides the globe into latitude bands and longitude bins for even geographic coverage.
2. **Focused Mode**: After user interaction (zoom/pan), switches to `fetchPinsForFocusedArea()` which fetches pins only within the current viewport.

#### Adaptive Clustering

Pins are clustered based on zoom level to prevent visual clutter:

| Zoom Level | Cluster Radius | Max Pins |
|---|---|---|
| World (`z >= 0.78`) | 1700 - 2800 miles | 40 |
| Continent (`0.48 <= z < 0.78`) | 650 - 1350 miles | 110 |
| Local (`z < 0.48`) | 50 miles | 160 - 360 |

The clustering algorithm (`clusterByMiles`) uses **grid-accelerated nearest-neighbor merging** with circular longitude averaging to handle dateline edge cases.

#### Supabase Table Discovery

The globe auto-discovers the best pin source table using `discoverPinSource()`, checking in order:
1. `visitor_pin_cells`
2. `visitor_pins_grid_mv`
3. `visitor_pin_region`

Column names are guessed dynamically (e.g., `center_lat`, `latitude`, `avg_lat`, `lat`).

---

### 4. Content Management

Content is managed directly through the Supabase console. The site reads from:

| Table | Purpose |
|---|---|
| `Projects` | Portfolio items with tech tags, ordered by `num` desc |
| `Blogs` | Technical blog posts (Markdown content) |
| `life_blogs` | Personal blog posts with optional `require_login` flag |
| `experience` | Professional timeline entries |
| `blog_embeddings` | Vector store (1536-dim) for RAG semantic search |
| `Chat` | Persisted chat Q&A history |

#### Project Filtering

`ProjectIsotop` uses Isotope.js for masonry grid layout with filter categories (e.g., Full-Stack, Backend, Web-Infra). Projects are fetched from `Projects` table ordered by `num` descending.

#### Blog Display

- **Technical Blogs**: Displayed in a `react-slick` carousel on the landing page.
- **Life Blogs**: Displayed in a grid. Posts with `require_login = true` trigger the `LogInDialog` modal before navigation.

---

### 5. Visitor Intelligence

Two tracking endpoints collect visitor data:

| Endpoint | Trigger | Data Collected |
|---|---|---|
| `POST /api/track` | Page load | IP, user agent, geolocation (via ipwho.org / ipapi.co), local time |
| `POST /api/click` | Link/button click | Click event name, target URL, IP, user agent, geolocation |

Geolocation is resolved server-side with a 6-hour IP cache (`GEO_CACHE`). Private IPs (`isLocalIp()`) skip geolocation and default to NYC coordinates.

---

## API Routes

All API routes implement a **three-tier strategy**: Primary fetch -> Fallback data -> Cache.

| Route | Method | Description | External Source | Cache TTL |
|---|---|---|---|---|
| `/api/market-data` | GET | Stock market quotes | Yahoo Finance | 2 min |
| `/api/currency` | GET | Currency conversion | Exchange rate API | 10 min |
| `/api/weather` | GET | Weather + geolocation | Open-Meteo + ipwho.org | 10 min |
| `/api/track` | POST | Record page view | ipwho.org (geo) | 6 hr (geo) |
| `/api/click` | POST | Record click event | ipwho.org (geo) | 6 hr (geo) |
| `/api/contact` | POST | Send contact email | Nodemailer (SMTP) | -- |
| `/api/search` | GET | Content search | Supabase | -- |

---

## Database Schema

Full schema is in [`creat_sql.txt`](creat_sql.txt). Key tables:

```sql
-- Portfolio projects (ordered by num desc)
Projects (id UUID PK, title, content, image_url, URL, category, year, technology, num INT)

-- Technical blogs
Blogs (id UUID PK, date, title, description, content TEXT, category, image_url, tags)

-- Life blogs (with auth gate)
life_blogs (id SERIAL PK, title, image_url, category, description, content TEXT,
            require_login BOOLEAN DEFAULT false, published_at, tags)

-- RAG vector store (IVFFlat cosine index)
blog_embeddings (id BIGINT PK, source, source_id, chunk_index, content, embedding VECTOR, url)

-- Visitor tracking
visitor_logs (id BIGINT PK, ip, event, ua, country, region, city, latitude, longitude, created_at)
visitor_clicks (id SERIAL PK, click_event, target_url, ip, event, ua, country, region, city, latitude, longitude)

-- Chat persistence
Chat (id UUID PK, question TEXT, answer TEXT, createdAt TIMESTAMPTZ, mode TEXT DEFAULT 'regular')

-- Professional timeline
experience (id SERIAL PK, date, name, subname, text)
```

---

## Authentication Flow

Protected life blog posts use Supabase Auth:

```
User clicks protected blog
        |
        v
  require_login = true?
   /              \
  No               Yes
  |                 |
  v                 v
Navigate        Show LogInDialog
directly        (email + password)
                    |
                    v
            supabase.auth.signInWithPassword()
                    |
                    v
            sanitizeNextPath() -> router.push()
```

- `LogInDialog.js` -- Modal component with async `onConfirm` callback.
- `sanitizeNextPath()` -- Security: ensures redirect paths start with `/` to prevent open redirects.
- Sign-up is handled by scrolling to the contact section with a toast message.

---

## Getting Started

### Prerequisites

- Node.js (16+)
- npm
- A [Supabase](https://supabase.com) project

### Installation

```bash
git clone https://github.com/YuqiGuo105/Portfolio.git
cd Portfolio
npm install
```

### Database Setup

1. Create a Supabase project at [app.supabase.com](https://app.supabase.com).
2. Copy **Project URL** and **anon key** from Project Settings > API.
3. Run the contents of [`creat_sql.txt`](creat_sql.txt) in the Supabase SQL Editor to create all tables and indexes.

### Run Locally

```bash
npm run dev
# Open http://localhost:3000
```

To auto-open the chat widget, append `?openChat=1` to the URL.

---

## Environment Variables

Create a `.env` file in the project root:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous API key |
| `EMAIL_USER` | Yes | SMTP email address (for contact form) |
| `EMAIL_PASS` | Yes | SMTP email password |
| `EMAIL_TO` | Yes | Recipient email for contact form |
| `REACT_APP_GITHUB_URL` | No | GitHub profile URL |
| `REACT_APP_LEETCODE_URL` | No | LeetCode profile URL |
| `REACT_APP_INSTAGRAM_URL` | No | Instagram profile URL |
| `NEXT_PUBLIC_START_YEAR` | No | Career start year (for "years of experience" calc) |
| `NEXT_PUBLIC_STORIES_ENDPOINT` | No | External stories API endpoint |
| `NEXT_PUBLIC_STORIES_OWNER` | No | Stories owner identifier |

---

## Deployment

### GitHub Actions -> Vercel

The project deploys automatically on push to `main` via `.github/workflows/deploy.yml`:

```yaml
on:
  push:
    branches: [main]

steps:
  - Install dependencies
  - Build with NEXT_PUBLIC_SUPABASE_* secrets
  - Deploy to Vercel (automatic)
```

**Required GitHub Secrets**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Technology Stack

| Category | Technology |
|---|---|
| **Framework** | Next.js 12.3.1 (Pages Router) |
| **Language** | JavaScript (React 18.2) |
| **Database** | Supabase (PostgreSQL + PGvector) |
| **AI** | RAG streaming via SSE, MathJax v3 for LaTeX |
| **3D Visualization** | react-globe.gl |
| **Styling** | CSS Modules + global CSS + vendor CSS |
| **Grid Layout** | Isotope.js (masonry with filtering) |
| **Carousel** | react-slick + slick-carousel |
| **Markdown** | react-markdown + remark-gfm + rehype-highlight |
| **Auth** | Supabase Auth (email/password) |
| **Email** | Nodemailer (serverless API route) |
| **Deployment** | Vercel via GitHub Actions |
| **Icons** | Lucide React, Font Awesome |

---

## Glossary

### Components

| Term | Description |
|---|---|
| **ChatWidget** | AI chat interface. SSE streaming, file uploads, MathJax rendering, two modes (FAST/DEEPTHINKING). |
| **DashboardPanels** | Real-time analytics: market data, currency, weather, visitor globe. Multi-phase Supabase fetching. |
| **RotatingGlobe** | 3D visitor map using `react-globe.gl`. Bootstrap -> focused pin fetching with adaptive clustering. |
| **ProjectIsotop** | Portfolio gallery with Isotope.js filtering (Full-Stack, Backend, Web-Infra categories). |
| **LogInDialog** | Auth modal with `onConfirm` callback returning `Promise<boolean \| {error}>`. |
| **SiteTour** | Guided walkthrough for first-time visitors. |
| **SeoHead** | Reusable `<Head>` component for page-specific meta tags, titles, descriptions. |

### Chat System

| Term | Description |
|---|---|
| **postSSE()** | Generic SSE parser with timeout/abort support. Handles chunked `data:` lines from the stream. |
| **StageToast** | Displays RAG thinking stages (search, rerank, deep_plan_done) with payload info. |
| **TodoList** | Renders subtasks from DEEPTHINKING mode's `deep_plan_done` event. |
| **SESSION_TTL_MS** | 15-minute session timeout. Expired sessions clear chat history. |
| **UPLOAD_TTL_MS** | 2-minute TTL for uploaded files in Supabase Storage. Auto-deleted via `scheduleAutoDelete()`. |
| **stripQAPrefix()** | Removes `[QA]` / `【QA】` markers from AI response content. |
| **ensureMathJaxLoaded()** | Lazy-loads MathJax v3 CDN. Configures delimiters: `$...$`, `$$...$$`, `\(...\)`, `\[...\]`. |

### Dashboard & Globe

| Term | Description |
|---|---|
| **VISITOR_CACHE_KEY** | `"yuqi_visitors_cache_v4"` -- localStorage key for instant dashboard restore on repeat visits. |
| **aggregatePinsByRegion()** | Groups nearby visitor locations by region/country, averages coordinates for pin placement. |
| **clusterByMiles()** | Grid-accelerated nearest-neighbor clustering. Radius scales with zoom level. |
| **balancedSamplePins()** | Geographic sampling for bootstrap mode: divides globe into latitude bands and longitude bins. |
| **computeLevelFromAltitude()** | Maps camera altitude to zoom level: `world` (>= 2.2), `continent` (>= 1.25), `local`. |
| **discoverPinSource()** | Auto-discovers Supabase pin table from candidates. Guesses column names dynamically. |
| **stableZoomT** | Debounced zoom level (0-1, logarithmic). Triggers pin clustering recalculation with 200ms delay. |

### Theming

| Term | Description |
|---|---|
| **dark-skin / light-skin** | CSS classes on `<body>` for theme switching. Persisted to `localStorage` key `ober-mood`. |

---

## License

MIT
