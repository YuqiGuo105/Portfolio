import React, { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeMathjax from "rehype-mathjax/svg"
import rehypeHighlight from "rehype-highlight"
import remarkChatMath from "../lib/chatMath.mjs"

const mathOptions = {
  svg: { fontCache: "none" },
  tex: { packages: ["base", "ams", "newcommand", "noundefined", "mhchem"], maxBuffer: 10000, maxMacros: 1000 },
}

export default memo(function ChatMarkdown({ content, streaming = false, components }) {
  return React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath, [remarkChatMath, { streaming }]],
    rehypePlugins: [[rehypeMathjax, mathOptions], [rehypeHighlight, { detect: false, ignoreMissing: true }]],
    components,
  }, String(content || ""))
})
