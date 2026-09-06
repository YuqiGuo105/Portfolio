// Only owner-reviewed or versioned current records are eligible for generation.
export function selectCurrentEvidence(rows, maxChars = 36000) {
  const eligible = (rows || []).filter((row) => {
    const meta = row.metadata || {}
    if (meta.retrieval_eligible === false) return false
    if (meta.status && meta.status !== "ACTIVE") return false
    return meta.status === "ACTIVE" || meta.evidence_review === "approved"
  })
  const latest = new Map()
  for (const row of eligible) {
    const meta = row.metadata || {}
    const key = `${meta.source_type || meta.source}:${meta.source_id || row.id}`
    latest.set(key, Math.max(latest.get(key) || 0, Number(meta.source_version) || 0))
  }
  let used = 0
  const seen = new Set()
  return eligible.filter((row) => {
    const meta = row.metadata || {}
    const key = `${meta.source_type || meta.source}:${meta.source_id || row.id}`
    if ((Number(meta.source_version) || 0) !== latest.get(key)) return false
    const text = String(row.content || "").trim()
    if (!text || seen.has(text) || used + text.length > maxChars) return false
    seen.add(text)
    used += text.length
    return true
  })
}
