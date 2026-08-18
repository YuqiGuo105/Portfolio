/**
 * GET /api/github-contributions
 *
 * Returns total GitHub contributions across all years using the GraphQL API.
 * Falls back to the Search API (commits only) if GITHUB_PAT is not set.
 * The token stays server-side.
 */

const GITHUB_USERNAME = "YuqiGuo105";
const START_YEAR = 2023;
const OPEN_SOURCE_PR_LIMIT = 6;

function isExternalRepository(nameWithOwner) {
  const owner = String(nameWithOwner || "").split("/")[0];
  return owner && owner.toLowerCase() !== GITHUB_USERNAME.toLowerCase();
}

function normalizePullRequest(pullRequest) {
  const repository = pullRequest?.repository?.nameWithOwner;
  if (!repository || !isExternalRepository(repository)) return null;

  return {
    repository,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    mergedAt: pullRequest.mergedAt,
  };
}

async function fetchOpenSourcePullRequests(token) {
  const query = `
    query {
      search(
        query: "is:pr is:merged author:${GITHUB_USERNAME} sort:updated-desc"
        type: ISSUE
        first: 50
      ) {
        nodes {
          ... on PullRequest {
            number
            title
            url
            mergedAt
            repository { nameWithOwner }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) return [];
  const payload = await response.json();
  return (payload?.data?.search?.nodes || [])
    .map(normalizePullRequest)
    .filter(Boolean)
    .sort((left, right) => new Date(right.mergedAt) - new Date(left.mergedAt))
    .slice(0, OPEN_SOURCE_PR_LIMIT);
}

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

    const openSourcePullRequests = await fetchOpenSourcePullRequests(token);

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      total,
      byYear,
      openSourcePullRequestCount: openSourcePullRequests.length,
      openSourcePullRequests,
    });
  } catch (err) {
    return fallbackSearchApi(res);
  }
}

async function fetchPublicOpenSourcePullRequests() {
  const response = await fetch(
    `https://api.github.com/search/issues?q=type:pr+is:merged+author:${GITHUB_USERNAME}&sort=updated&order=desc&per_page=50`,
    { headers: { Accept: "application/vnd.github+json" } }
  );
  if (!response.ok) return [];

  const payload = await response.json();
  return (payload.items || [])
    .map((item) => {
      const repository = String(item.repository_url || "")
        .replace("https://api.github.com/repos/", "");
      if (!isExternalRepository(repository)) return null;
      return {
        repository,
        number: item.number,
        title: item.title,
        url: item.html_url,
        mergedAt: item.pull_request?.merged_at || item.closed_at,
      };
    })
    .filter(Boolean)
    .slice(0, OPEN_SOURCE_PR_LIMIT);
}

async function fallbackSearchApi(res) {
  try {
    const [commitResponse, openSourcePullRequests] = await Promise.all([
      fetch(
        `https://api.github.com/search/commits?q=author:${GITHUB_USERNAME}&per_page=1`,
        { headers: { Accept: "application/vnd.github.cloak-preview+json" } }
      ),
      fetchPublicOpenSourcePullRequests(),
    ]);
    const commitPayload = commitResponse.ok ? await commitResponse.json() : {};
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      total: commitPayload.total_count || 0,
      source: "search_api",
      openSourcePullRequestCount: openSourcePullRequests.length,
      openSourcePullRequests,
    });
  } catch (_) {
    return res.status(200).json({
      total: 0,
      openSourcePullRequestCount: 0,
      openSourcePullRequests: [],
    });
  }
}
