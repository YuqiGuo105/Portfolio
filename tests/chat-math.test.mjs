import test from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ChatMarkdown from "../src/components/ChatMarkdown.mjs"

const render = (content, streaming = false) => renderToStaticMarkup(React.createElement(ChatMarkdown, { content, streaming }))
const equations = html => (html.match(/<mjx-container/g) || []).length

test("inline LaTeX supports dollar and model-style delimiters", () => {
  const html = render(String.raw`Given $a^2+b^2=c^2$, solve \(x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\).`)
  assert.equal(equations(html), 2)
  assert.ok(html.includes("<svg"))
  assert.ok(!html.includes("data-mjx-error"))
})

test("display delimiters, fractions, integrals, matrices, aligned equations and chemistry", () => {
  for (const latex of [String.raw`\frac{1}{2}`, String.raw`\int_0^1 x^2\,dx=\frac13`, String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`, String.raw`\begin{aligned}x+y&=3\\x-y&=1\end{aligned}`, String.raw`\ce{H2O}`]) {
    for (const source of [`$$\n${latex}\n$$`, `$$${latex}$$`, `\\[${latex}\\]`]) {
      const html = render(source, true)
      assert.equal(equations(html), 1, source)
      assert.ok(html.includes('display="true"'), source)
      assert.ok(!html.includes("data-mjx-error"), source)
    }
  }
})

test("code spans and fenced/indented code are never normalized as equations", () => {
  for (const content of ["`\\(x^2\\)`", "`` `$x$` \\[y\\] ``", "```js\nconst x = '$a$'; // \\[b\\]\n```", "~~~txt\n\\[x\\]\n~~~", "```txt\n\\[unfinished", "    \\[x\\]"]) {
    assert.equal(equations(render(content, true)), 0, content)
  }
})

test("currency and escaped dollars remain readable", () => {
  for (const source of ["Costs $5 to $10", "Costs $5 and $10", String.raw`Costs \$5 and \$10`, "Costs $5"]) {
    const html = render(source, true)
    assert.equal(equations(html), 0, source)
    assert.ok(!html.includes("Rendering equation"))
  }
})

test("unfinished streaming equations resolve without losing the subsequent answer", () => {
  for (const source of ["$$\nx^2", String.raw`\[\frac{1}{`, String.raw`Value \(x^`]) {
    assert.ok(render(source, true).includes("Rendering equation..."))
  }
  const answer = "$$\nx^2 + y^2 = 1\n$$\n\nA unit circle."
  for (let end = 1; end <= answer.length; end++) assert.doesNotThrow(() => render(answer.slice(0, end), true))
  const html = render(answer, false)
  assert.equal(equations(html), 1)
  assert.ok(html.includes("A unit circle."))
  assert.ok(!html.includes("Rendering equation..."))
})

test("malformed math is contained and raw HTML cannot execute", () => {
  const html = render(String.raw`\[\frac{1}{\]\n\n<script>alert(1)</script>`)
  assert.ok(!html.includes("<script>"))
  assert.doesNotThrow(() => render(String.raw`$\unknowncommand{x}$`))
  const link = render(String.raw`$\href{javascript:alert(1)}{click}$`)
  assert.ok(!link.includes('href="javascript:'))
})
