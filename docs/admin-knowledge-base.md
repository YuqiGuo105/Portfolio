# Admin Knowledge Base

The protected `/admin/knowledge` page manages canonical owner notes in
`kb_documents`. Search, filter, page, create, edit and delete without exposing
private database access to the browser. Generated article/project chunks remain
read-only; edit the original content instead.

## API Contract

All routes require an administrator identity at the Admin API. The browser uses
its Supabase JWT; authenticated admin MCP calls use the existing trusted gateway.
The public MCP catalog does not expose these tools.

| MCP tool | Admin API | Behavior |
| --- | --- | --- |
| `knowledge.list` | `POST /api/admin/knowledge/search` | Search and pagination |
| `knowledge.get` | `GET /api/admin/knowledge/{id}` | Full record, revision, indexing state |
| `knowledge.batch_get` | `POST /api/admin/knowledge/batch-get` | 1-25 IDs per call |
| `knowledge.create` | `POST /api/admin/knowledge` | Private draft by default |
| `knowledge.update` | `PUT /api/admin/knowledge/{id}` | Full replacement with revision check |
| `knowledge.delete` | `DELETE /api/admin/knowledge/{id}?expectedRevision=...` | Remove original and derived answer chunks |

Search request:

```json
{
  "filter": { "query": "reliability", "scope": "OWNED", "status": "ALL" },
  "page": { "size": 25, "offset": 0 }
}
```

Mutation request (`id` is also a tool argument for MCP updates):

```json
{
  "document": {
    "title": "Platform reliability",
    "question": "How are failed events recovered?",
    "content": "An owner-reviewed answer."
  },
  "policy": { "status": "DRAFT", "answerVisibility": "private" },
  "preconditions": { "revision": "revision returned by knowledge.get" }
}
```

Omit `preconditions` on create. Updates/deletes require the exact current
32-character revision. Create requires a stable `Idempotency-Key`; the MCP
gateway supplies it through its existing operation ledger. Same-key creates
with different payloads and stale updates return conflicts, not silent overwrites.

Batch request: `{ "ids": ["uuid-1", "uuid-2"] }`. One bounded call returns
`items: [{id, found, record?}]` and batch counts. Duplicate IDs are read once;
missing records do not discard successful results. Record and indexing reads
use two set-based SQL queries, not one query per ID. No bulk delete is exposed.

## Publication and Recovery

- Drafts/private notes are not used for public answers. Selecting `ACTIVE` with
  `public` requires explicit approval; approved text is sent to the existing
  Gemini embedding service. Original source access stays admin-only.
- Saving, invalidating old chunks, creating the versioned indexing job and audit
  snapshot share a transaction. Kafka dispatch happens after commit, with
  bounded execution and the existing durable job recovery path.
- A saved record is not necessarily indexed. Read `indexing.status` and its job
  ID, then refresh or inspect Admin Jobs. Failed jobs retain retry/error state.
- The indexer checks the original row, version and content fingerprint before
  inserting derived chunks. Stale events cannot overwrite newer content or
  recreate a deleted original.
- Deletes remove answer data but retain the administrator audit snapshot.
  Direct `anon`/`authenticated` table access remains disabled; no new RLS grant
  or database service is introduced.

## Release and Verification

### Local Live Read-Only Preview

To inspect the existing AI knowledge data before deploying the new CRUD service,
start the actual admin app with the development-only preview enabled:

```sh
NEXT_PUBLIC_KNOWLEDGE_READ_ONLY_PREVIEW=true npm run dev -- --hostname 127.0.0.1 -p 3072
```

Open `/admin/knowledge` and sign in with an existing administrator account.
The local environment must provide `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and server-only `SUPABASE_SERVICE_ROLE_KEY` for
the existing portfolio project. `WRITER_API_URL` can point to the existing Admin
service for the normal role-verification fallback.

This mode reads real `kb_documents` records, never fixtures. Search uses nested
`filter` and `page` objects with at most 25 rows; detail batches accept at most
25 UUIDs. No embeddings are sent to the browser and no LLM calls are made.
The local API verifies the Supabase identity and managed administrator role,
rejects write actions, and disables itself outside development or for non-local
hostnames. Create, save and delete controls are unavailable. No production
record, RLS policy or permission is changed by this preview.

### Test Coverage

Deploy the compatible Admin service and RAG indexer before the MCP catalog and
frontend. Until then the production backend does not support these routes.
No new subscription is needed; activating changed text uses existing embedding
capacity and can incur its normal provider cost.

Verification includes Java authorization/transaction/replay tests, isolated
Postgres CRUD and projection SQL tests, gateway transport/confirmation tests,
JavaScript nested-envelope tests and browser desktop/mobile interaction checks.
The Postgres projection fixture substitutes a text domain for pgvector: it
checks SQL and provenance, not vector similarity. Initial editor interaction
tests use synthetic fixtures. The opt-in live preview additionally verifies real
read queries; authenticated browser testing requires an administrator to sign
in locally. Neither is a live Gemini indexing end-to-end test. No production
knowledge is changed by these tests.
