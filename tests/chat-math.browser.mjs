import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ChatMarkdown from "../src/components/ChatMarkdown.mjs"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright")
const widget = await readFile(new URL("../src/components/ChatWidget.js", import.meta.url), "utf8")
const css = widget.slice(widget.indexOf("/* ===== MathJax / Markdown tuning"), widget.indexOf("/* Headings */", widget.indexOf("/* ===== MathJax / Markdown tuning")))
const content = String.raw`## Quadratic equation
For \(ax^2+bx+c=0\), the roots are:
\[x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\]

## Matrix and integral
\[A=\begin{bmatrix}1&2\\3&4\end{bmatrix},\quad \int_0^1x^2\,dx=\frac13\]

## Long equation
\[p(x_1,\ldots,x_n)=\prod_{i=1}^{n}p(x_i\mid x_1,\ldots,x_{i-1})=p(x_1)p(x_2\mid x_1)p(x_3\mid x_1,x_2)\cdots p(x_n\mid x_1,\ldots,x_{n-1})\]

Budget: $5 to $10. Code: ` + '`const price = "$5"`' + "."
const html = renderToStaticMarkup(React.createElement(ChatMarkdown, { content }))
const browser = await chromium.launch({ headless: true, channel: "chrome" })
try {
  for (const width of [360, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px Arial;background:#f4f6f6}main{box-sizing:border-box;width:100%;max-width:620px;padding:24px;margin:0 auto;background:white}${css}</style></head><body><main id="__chat_widget_root"><div class="cw-md">${html}</div></main></body></html>`)
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      formulas: document.querySelectorAll("mjx-container").length,
      nonblank: [...document.querySelectorAll("mjx-container svg")].every(svg => svg.getBoundingClientRect().height > 5 && svg.querySelector("path")),
      scrollable: [...document.querySelectorAll('mjx-container[display="true"]')].some(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === "auto"),
    }))
    assert.equal(result.overflow, false)
    assert.equal(result.formulas, 4)
    assert.equal(result.nonblank, true)
    assert.equal(result.scrollable, true)
    await page.screenshot({ path: `/private/tmp/chat-math-${width}.png`, fullPage: true })
    console.log(JSON.stringify({ width, ...result }))
    await page.close()
  }
} finally {
  await browser.close()
}
