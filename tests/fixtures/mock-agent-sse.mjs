import { createServer } from "node:http";

const port = Number(process.env.MOCK_AGENT_PORT || 3999);
const autoStart = process.env.MOCK_GUIDE_AUTO_START === "true";
const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/rag/answer/stream") {
    res.writeHead(404).end();
    return;
  }
  req.resume();
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  const send = (stage, payload = {}) => {
    res.write(`data: ${JSON.stringify({ stage, payload })}\n\n`);
  };
  send("routing", { route: "WEB_GUIDE" });
  setTimeout(() => {
    send("tour_steps", {
      schemaVersion: 2,
      language: "zh",
      autoStart,
      startMode: autoStart ? "START_NOW" : "OFFER",
      responseMessage: "我来带你浏览网站。",
      steps: [{
        id: "home-projects",
        targetKey: "home.projects",
        title: "项目作品",
        content: "浏览项目与架构决策。",
      }],
    });
    send("answer_final", { answer: "我来带你浏览网站。", responseType: "WEB_GUIDE" });
    // Keep upstream open: the browser must stop on answer_final, not EOF.
  }, 300);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mock agent listening on 127.0.0.1:${port}\n`);
});
