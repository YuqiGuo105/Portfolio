// Turns the links in an answer into something a visitor can scan: which site a link goes to,
// a short readable address, and whether a bullet list is really a list of links.
// Pure functions over URLs and the markdown tree, so they run in tests without a browser.

const SITE_HOSTS = new Set(["yuqi.site", "www.yuqi.site"])

const BRANDS = [
  { kind: "github", name: "GitHub", hosts: ["github.com"] },
  { kind: "leetcode", name: "LeetCode", hosts: ["leetcode.com", "leetcode.cn"] },
  { kind: "instagram", name: "Instagram", hosts: ["instagram.com"] },
  { kind: "linkedin", name: "LinkedIn", hosts: ["linkedin.com"] },
  { kind: "x", name: "X", hosts: ["x.com", "twitter.com"] },
  { kind: "youtube", name: "YouTube", hosts: ["youtube.com", "youtu.be"] },
]

// Pages of this site, by the first part of the path.
const SITE_PAGES = {
  "work-single": ["project", "Project"],
  "works-list": ["project", "Projects"],
  "blog-single": ["article", "Article"],
  "life-blog": ["article", "Life blog"],
  blogs: ["article", "Articles"],
  architecture: ["page", "Architecture"],
  analytics: ["page", "Visitor analytics"],
  talk: ["page", "Talk with me"],
  cv: ["page", "Résumé"],
  "mcp-guide": ["page", "MCP guide"],
}

const bareHost = host => host.replace(/^www\./, "")

function clip(text, max) {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) * 0.62)
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`
}

/** A URL as a person would read it out: host and path, no protocol, query or trailing slash. */
export function readableUrl(href, max = 44) {
  try {
    const url = new URL(href, "https://www.yuqi.site")
    if (!/^https?:$/.test(url.protocol)) return clip(String(href), max)
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "")
    return clip(`${bareHost(url.hostname)}${path}`, max)
  } catch {
    return clip(String(href || ""), max)
  }
}

/** What a link points at: { kind, name, address, external }. `kind` picks the icon. */
export function describeLink(href) {
  const raw = String(href || "").trim()
  if (/^mailto:/i.test(raw)) return { kind: "email", name: "Email", address: raw.slice(7).split("?")[0], external: true }
  if (/^tel:/i.test(raw)) return { kind: "phone", name: "Phone", address: raw.slice(4), external: true }
  let url
  try { url = new URL(raw, "https://www.yuqi.site") } catch { return { kind: "web", name: "Link", address: clip(raw, 44), external: true } }
  if (!/^https?:$/.test(url.protocol)) return { kind: "web", name: "Link", address: clip(raw, 44), external: true }

  const host = bareHost(url.hostname.toLowerCase())
  if (SITE_HOSTS.has(url.hostname.toLowerCase())) {
    const [first, second] = url.pathname.split("/").filter(Boolean)
    const page = SITE_PAGES[first]
    if (!first) return { kind: "page", name: "Home page", address: "yuqi.site", external: false }
    // A page opened by its id says nothing in the address, so the address stays short.
    return { kind: page?.[0] || "page", name: page?.[1] || "Page", address: second ? "yuqi.site" : readableUrl(url.href), external: false }
  }
  const brand = BRANDS.find(item => item.hosts.some(known => host === known || host.endsWith(`.${known}`)))
  return { kind: brand?.kind || "web", name: brand?.name || host, address: readableUrl(url.href), external: true }
}

export const looksLikeUrl = text => /^(https?:\/\/|www\.)\S+$/i.test(String(text || "").trim())

const INLINE = new Set(["strong", "em", "b", "i", "code", "del", "span", "a"])
const textOf = node => node.type === "text" ? node.value : (node.children || []).map(textOf).join("")

function flatten(nodes, out = []) {
  for (const node of nodes) {
    if (node.type === "text") out.push({ text: node.value })
    else if (node.type === "element" && node.tagName === "a") out.push({ link: node })
    else if (node.type === "element" && INLINE.has(node.tagName)) flatten(node.children || [], out)
    else out.push({ block: true })
  }
  return out
}

/**
 * One bullet as a link row, or null when the bullet is ordinary prose.
 * A row is a single link with at most a short label before it or a short note after it:
 * "GitHub: <link>", "<link>", "<link> — where the code lives".
 */
export function linkRow(item) {
  if (item?.type !== "element" || item.tagName !== "li") return null
  let children = (item.children || []).filter(node => !(node.type === "text" && !node.value.trim()))
  if (children.length === 1 && children[0].tagName === "p") children = children[0].children || []
  const parts = flatten(children)
  if (parts.some(part => part.block)) return null
  const links = parts.filter(part => part.link)
  if (links.length !== 1) return null

  const index = parts.indexOf(links[0])
  const join = list => list.map(part => part.text || "").join("")
  const before = join(parts.slice(0, index)).replace(/[\s:：\-–—|·]+$/u, "").trim()
  const after = join(parts.slice(index + 1)).replace(/^[\s:：\-–—|·,，]+/u, "").replace(/[\s.。;；]+$/u, "").trim()
  // A sentence that happens to contain a link stays a sentence.
  if (before.length > 48 || after.length > 72 || (before && after)) return null
  if (/[.。!?！？]\s/u.test(before)) return null

  const href = String(links[0].link.properties?.href || "")
  if (!href) return null
  const meta = describeLink(href)
  const shown = textOf(links[0].link).trim()
  const named = shown && !looksLikeUrl(shown) ? shown : ""
  const title = before || named || meta.name
  const detail = after || (before && named && named !== before ? named : meta.address === title ? "" : meta.address)
  return { href, title, detail, kind: meta.kind, external: meta.external }
}

/** Every bullet of a list as link rows, or null unless all of them are. */
export function linkRows(list) {
  if (list?.type !== "element" || list.tagName !== "ul") return null
  const items = (list.children || []).filter(node => node.type === "element")
  if (!items.length) return null
  const rows = items.map(linkRow)
  return rows.every(Boolean) ? rows : null
}
