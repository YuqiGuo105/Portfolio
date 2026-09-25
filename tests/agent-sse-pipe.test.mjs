import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { pipeAgentSse } from "../src/lib/agentSsePipe.mjs";

function responseSink() {
  const res = new EventEmitter();
  const chunks = [];
  res.status = () => res;
  res.setHeader = () => res;
  res.write = value => { chunks.push(value); return true; };
  res.end = () => { res.writableEnded = true; res.emit("close"); };
  res.writableEnded = false;
  return { res, chunks };
}

test("request-body close does not cancel an active agent SSE response", async () => {
  const req = new EventEmitter();
  const { res, chunks } = responseSink();
  let send;
  const upstream = new Response(new ReadableStream({ start(controller) { send = controller; } }));
  const piping = pipeAgentSse(req, res, upstream);
  req.emit("close");
  send.enqueue(new TextEncoder().encode('data: {"stage":"answer_final"}\n\n'));
  send.enqueue(new TextEncoder().encode('data: {"stage":"done"}\n\n'));
  send.close();
  await piping;
  assert.match(chunks.join(""), /answer_final/);
  assert.match(chunks.join(""), /done/);
  assert.equal(res.writableEnded, true);
});
