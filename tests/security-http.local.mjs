import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

const socket = net.createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let exited = false;
server.once("exit", () => { exited = true; });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local server startup timed out")), 20000);
    server.stdout.on("data", chunk => {
      if (String(chunk).includes("started server")) { clearTimeout(timer); resolve(); }
    });
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Local server exited")); });
    server.once("error", error => { clearTimeout(timer); reject(error); });
  });
  const base = `http://127.0.0.1:${port}`;
  for (const endpoint of ["/api/admin/chat-conversations", "/api/admin/visitors", "/api/admin/stories"]) {
    const res = await fetch(`${base}${endpoint}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(res.status, 401, endpoint);
    assert.match(res.headers.get("cache-control"), /private.*no-store/, endpoint);
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-powered-by"), null);
    await res.body.cancel();
    console.log(`PASS ${endpoint}: 401, private/no-store, CSP, no framework header`);
  }
  const home = await fetch(base);
  assert.equal(home.status, 200);
  await home.body.cancel();
  console.log("PASS homepage remains available");
} finally {
  if (!exited) {
    const done = once(server, "exit");
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await done;
    clearTimeout(timer);
  }
}
