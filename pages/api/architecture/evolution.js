import data from "../../../docs/architecture/platform-evolution.json";
import { publicArchitectureEvolution } from "../../../src/lib/publicArchitectureEvolution.mjs";

const history = publicArchitectureEvolution(data);
export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json(history);
}
