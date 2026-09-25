export async function pipeAgentSse(req, res, upstream) {
  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => "");
    res.status(upstream.status || 502);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify({ error: "agent_error", status: upstream.status, body: errBody }));
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "private, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const onResponseClose = () => {
    if (!res.writableEnded) void reader.cancel().catch(() => {});
  };
  // IncomingMessage closes when the POST body is consumed, even while the
  // browser is still waiting for the SSE response. Only response close means
  // the downstream stream has gone away.
  res.on("close", onResponseClose);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.length) res.write(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) res.write(tail);
  } catch (err) {
    if (!res.writableEnded) {
      try { res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`); } catch {}
    }
  } finally {
    res.off("close", onResponseClose);
    if (!res.writableEnded) res.end();
  }
}
