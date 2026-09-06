import test from "node:test"
import assert from "node:assert/strict"
import { evidenceUrl, isSourceLinked, mergeEvidence } from "../src/lib/chatEvidence.mjs"
import { selectCurrentEvidence } from "../src/lib/knowledgeEvidence.mjs"

test("merges streamed and related sources without losing excerpts", () => {
  const result = mergeEvidence([{ url: "/blogs/1", title: "Article", snippet: "Evidence" }], [{ url: "https://www.yuqi.site/blogs/1", title: "Article" }], [{ url: "https://example.org", type: "web" }])
  assert.equal(result.length, 2)
  assert.equal(result[0].snippet, "Evidence")
})
test("rejects unsafe source URLs and distinguishes linked from retrieved", () => {
  assert.equal(evidenceUrl("javascript:alert(1)"), null)
  assert.equal(evidenceUrl("https://user:secret@example.org"), null)
  assert.equal(isSourceLinked("[Article](/blogs/1)", "https://www.yuqi.site/blogs/1"), true)
  assert.equal(isSourceLinked("No citation", "https://example.org/"), false)
})
test("excludes superseded, quarantined and unreviewed records", () => {
  const row = (id, metadata) => ({ id, content: id, metadata })
  const result = selectCurrentEvidence([
    row("current", { status: "ACTIVE" }), row("old", { status: "SUPERSEDED" }),
    row("qa", { type: "chat_qa" }), row("blocked", { status: "ACTIVE", retrieval_eligible: false }),
    row("reviewed", { evidence_review: "approved" }),
  ])
  assert.deepEqual(result.map((r) => r.id), ["current", "reviewed"])
})
test("keeps latest source version, deduplicates and bounds context", () => {
  const result = selectCurrentEvidence([
    { id: "old", content: "old", metadata: { status: "ACTIVE", source_id: "1", source_type: "BLOG", source_version: 1 } },
    { id: "new", content: "new", metadata: { status: "ACTIVE", source_id: "1", source_type: "BLOG", source_version: 2 } },
    { id: "repeat", content: "new", metadata: { status: "ACTIVE" } },
    { id: "huge", content: "0123456789", metadata: { status: "ACTIVE" } },
  ], 5)
  assert.deepEqual(result.map((r) => r.id), ["new"])
})
