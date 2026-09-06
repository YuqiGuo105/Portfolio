export function evidenceUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value, "https://www.yuqi.site")
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch { return null }
}

export function mergeEvidence(...groups) {
  const byUrl = new Map()
  for (const item of groups.flat()) {
    if (!item || typeof item !== "object") continue
    const url = evidenceUrl(item.url)
    if (!url) continue
    const previous = byUrl.get(url) || {}
    byUrl.set(url, { ...previous, ...item, url,
      title: item.title || previous.title || new URL(url).hostname,
      snippet: item.snippet || previous.snippet || "" })
  }
  return [...byUrl.values()].slice(0, 12)
}

export function isSourceLinked(answer, url) {
  const links = String(answer || "").matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)
  return [...links].some((match) => evidenceUrl(match[1]) === url)
}
