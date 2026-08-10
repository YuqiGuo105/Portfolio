import fs from "node:fs";
import path from "node:path";

const DIAGRAM_PATH = path.join(
  process.cwd(),
  "docs",
  "architecture",
  "platform-system-flow.svg"
);

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  try {
    const diagram = fs.readFileSync(DIAGRAM_PATH, "utf8");
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).send(diagram);
  } catch (error) {
    console.error("Platform architecture diagram unavailable", { message: error.message });
    return res.status(404).end();
  }
}
