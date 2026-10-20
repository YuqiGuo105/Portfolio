const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const source = fs.readFileSync(path.join(__dirname, "../src/components/TalkNestContact.js"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: "TalkNestContact.jsx",
}).outputText;
const componentModule = { exports: {} };
vm.runInNewContext(output, {
  exports: componentModule.exports,
  require: name => name.endsWith(".module.css") ? {} : require(name),
});
const html = renderToStaticMarkup(React.createElement(componentModule.exports.default));

test("renders the approved contact card without a development-only gate", () => {
  assert.match(html, /Prefer a conversation\?/);
  assert.match(html, /Meet on TalkNest/);
  assert.match(html, /Open TalkNest/);
  assert.doesNotMatch(source, /process\.env|localhost|127\.0\.0\.1|demo=1/);
});

test("links to the live deployment with Yuqi's directory query and safe new-tab attributes", () => {
  const href = html.match(/href="([^"]+)"/)[1];
  const url = new URL(href);
  assert.equal(url.origin, "https://talknest-refresh.onrender.com");
  assert.equal(url.searchParams.get("connect"), "Yuqi Guo");
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("keeps the original contact form and adds the card before it", () => {
  const form = fs.readFileSync(path.join(__dirname, "../src/components/ContactForm.js"), "utf8");
  assert.match(form, /<TalkNestContact\s*\/>/);
  assert.ok(form.indexOf("<TalkNestContact") < form.indexOf('<form onSubmit={onSubmit}>'));
  assert.match(form, /fetch\("\/api\/contact"/);
  assert.match(form, /<button type="submit" className="btn">Submit<\/button>/);
});
