// Normalize model-style LaTeX delimiters before CommonMark consumes the escapes.
// The Markdown parser supplies protected ranges, including unfinished code fences.
export default function remarkChatMath({ streaming = false } = {}) {
  const parser = this.parser
  this.parser = (source, file) => {
    const protectedRanges = []
    function protect(node) {
      if (["code", "inlineCode", "math", "inlineMath", "html", "link", "image", "definition"].includes(node.type)) {
        protectedRanges.push([node.position.start.offset, node.position.end.offset])
      } else {
        node.children?.forEach(protect)
      }
    }
    protect(parser(source, file))
    let normalized = ""
    let cursor = 0
    for (const [start, end] of protectedRanges) {
      normalized += normalizeDelimiters(source.slice(cursor, start), streaming)
      normalized += source.slice(start, end)
      cursor = end
    }
    normalized += normalizeDelimiters(source.slice(cursor), streaming)
    const tree = parser(normalized, file)
    function finish(node) {
      if (node.type === "math" && streaming) {
        const raw = normalized.slice(node.position.start.offset, node.position.end.offset)
        const opening = raw.match(/^\s*(\${2,})/)
        const lines = raw.trimEnd().split("\n")
        const closing = lines.at(-1).trim()
        if (lines.length < 2 || !/^\${2,}$/.test(closing) || closing.length < (opening?.[1].length || 2)) {
          node.type = "paragraph"
          node.children = [{ type: "text", value: "Rendering equation..." }]
          delete node.data
          delete node.value
        }
      }
      if (node.type === "inlineMath") {
        const raw = normalized.slice(node.position.start.offset, node.position.end.offset)
        if (raw.startsWith("$$")) node.data.hProperties.className = ["language-math", "math-display"]
      }
      // A price range such as "$5 to $10" is prose, not inline LaTeX.
      if (node.type === "inlineMath" && /^\d[\d.,]*\s+(?:to|and|or|through|[-\u2013])\s*$/.test(node.value)) {
        node.type = "text"
        node.value = normalized.slice(node.position.start.offset, node.position.end.offset)
        delete node.data
      }
      node.children?.forEach(finish)
    }
    finish(tree)
    return tree
  }
}

function normalizeDelimiters(source, streaming) {
  let result = ""
  for (let i = 0; i < source.length;) {
    if (source[i] !== "\\") {
      result += source[i++]
      continue
    }
    if (source[i + 1] === "\\") {
      result += source.slice(i, i + 2)
      i += 2
      continue
    }
    const display = source[i + 1] === "["
    if (!display && source[i + 1] !== "(") {
      result += source[i++]
      continue
    }
    const closing = display ? "\\]" : "\\)"
    let end = source.indexOf(closing, i + 2)
    while (end >= 0 && source[end - 1] === "\\") end = source.indexOf(closing, end + 2)
    if (end < 0) {
      result += streaming ? "Rendering equation..." : source.slice(i)
      break
    }
    const latex = source.slice(i + 2, end).trim()
    result += display ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`
    i = end + 2
  }
  return result
}
