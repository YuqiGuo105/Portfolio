/**
 * GET /api/github-contributions
 *
 * Returns total GitHub contributions across all years using the GraphQL API.
 * Falls back to the Search API (commits only) if GITHUB_PAT is not set.
 * The token stays server-side.
 */

const GITHUB_USERNAME = "YuqiGuo105";
const START_YEAR = 2023;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.GITHUB_PAT;

  // If no PAT, fall back to the public search API (commits only)
  if (!token) {
    return fallbackSearchApi(res);
  }

  const currentYear = new Date().getFullYear();
  let total = 0;
  const byYear = {};

  try {
    for (let year = START_YEAR; year <= currentYear; year++) {
      const from = `${year}-01-01T00:00:00Z`;
      const to = `${year}-12-31T23:59:59Z`;

      const query = `
        query {
          user(login: "${GITHUB_USERNAME}") {
            contributionsCollection(from: "${from}", to: "${to}") {
              contributionCalendar {
                totalContributions
              }
            }
          }
        }
      `;

      const resp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!resp.ok) continue;
      const json = await resp.json();
      const count =
        json?.data?.user?.contributionsCollection?.contributionCalendar
          ?.totalContributions ?? 0;
      byYear[year] = count;
      total += count;
    }

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({ total, byYear });
  } catch (err) {
    return fallbackSearchApi(res);
  }
}

async function fallbackSearchApi(res) {
  try {
    const resp = await fetch(
      `https://api.github.com/search/commits?q=author:${GITHUB_USERNAME}&per_page=1`,
      { headers: { Accept: "application/vnd.github.cloak-preview+json" } }
    );
    if (!resp.ok) return res.status(200).json({ total: 0 });
    const json = await resp.json();
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({ total: json.total_count || 0, source: "search_api" });
  } catch (_) {
    return res.status(200).json({ total: 0 });
  }
}
