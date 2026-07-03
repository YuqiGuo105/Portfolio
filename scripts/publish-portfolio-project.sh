#!/usr/bin/env bash
# Publish the "Portfolio Platform" project article to the admin service.
#
# Requires ONE of the following auth methods (see AdminAuthFilter.java):
#
#   A) Supabase Bearer JWT for an email in portfolio.supabase.allowed-emails:
#        export SUPABASE_JWT="<paste access_token from a signed-in browser session>"
#
#   B) Server-to-server admin secret (portfolio.admin.secret):
#        export ADMIN_SECRET="$(gcloud secrets versions access latest --secret=ADMIN_SECRET)"
#
# Then run:
#   ./scripts/publish-portfolio-project.sh
#
# What this does:
#   POST /api/admin/content/PROJECT   { data: {...}, publish: true }
#     → inserts a row into public."Projects"
#     → snapshots content_versions
#     → writes content_event_outbox
#     → post-commit publishes to Kafka topics:
#         - content.search.index.v1     (→ search-indexer → OpenSearch)
#         - content.rag.index.v1        (→ rag-indexer → pgvector kb_documents)
#         - content.notification.feature-updates.v1   (→ notification-service → email subscribers)
#
# NOTE: publish=true will actually enqueue emails to every ACTIVE subscriber
# with FEATURE_UPDATES enabled. Set publish=false in the JSON if you want to
# create as a draft first, then publish separately later.

set -euo pipefail

ADMIN_BASE_URL="${ADMIN_BASE_URL:-https://portfolio-admin-service-y45c2mnbja-uc.a.run.app}"
PAYLOAD_FILE="$(dirname "$0")/portfolio-platform-project.json"

if [[ ! -f "$PAYLOAD_FILE" ]]; then
  echo "❌ Missing payload: $PAYLOAD_FILE" >&2
  exit 1
fi

# Pick auth header
AUTH_HEADER=()
if [[ -n "${SUPABASE_JWT:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${SUPABASE_JWT}")
  echo "🔐 Using Supabase Bearer JWT"
elif [[ -n "${ADMIN_SECRET:-}" ]]; then
  AUTH_HEADER=(-H "X-Admin-Secret: ${ADMIN_SECRET}")
  echo "🔐 Using X-Admin-Secret"
else
  echo "❌ Set SUPABASE_JWT or ADMIN_SECRET in your environment first." >&2
  echo "   e.g. export ADMIN_SECRET=\"\$(gcloud secrets versions access latest --secret=ADMIN_SECRET)\"" >&2
  exit 1
fi

echo "📤 POST ${ADMIN_BASE_URL}/api/admin/content/PROJECT"
echo

curl -sS -X POST \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  --data @"${PAYLOAD_FILE}" \
  "${ADMIN_BASE_URL}/api/admin/content/PROJECT" \
  | tee /tmp/portfolio-publish-response.json \
  | python3 -m json.tool

echo
echo "✅ Done. Response saved to /tmp/portfolio-publish-response.json"
echo
echo "Next steps to verify the downstream pipeline:"
echo "  1. Search Indexer:   curl -s '${ADMIN_BASE_URL}/api/admin/indexing-jobs?jobType=SEARCH_INDEX&limit=5' | jq"
echo "  2. RAG Indexer:      curl -s '${ADMIN_BASE_URL}/api/admin/indexing-jobs?jobType=RAG_INDEX&limit=5' | jq"
echo "  3. Outbox events:    curl -s '${ADMIN_BASE_URL}/api/admin/outbox-events?limit=5' | jq"
echo "  4. OpenSearch:       new doc in portfolio_content_current"
echo "  5. Notification:     new PENDING rows in notification_recipients"
