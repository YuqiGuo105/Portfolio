// Public facts behind a referral request's evidence, fetched by the server.
//
// An applicant can write any rating, star count or "merged" into a form. This module takes the
// GitHub and LeetCode links found in the form and the résumé and asks those two services' public
// APIs what is actually there: is the pull request merged and by whom, is the repository a fork,
// what is the contest rating and how many contests stand behind it.
//
// It never opens a link the applicant supplied. A link is only parsed for an owner, repository,
// pull-request number or username, each checked against a strict pattern, and the request goes to
// one of three fixed hosts. Everything is bounded: a handful of lookups per request, five seconds
// each. A lookup that fails says "unavailable" and never counts against the applicant.
//
// The facts describe an account, not a person: nothing here proves the account is the applicant's.
import { inflateSync } from 'node:zlib';

const MAX = { pulls: 3, repos: 3, links: 40 };
const TIMEOUT_MS = 5000;
const LINK = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:github\.com|leetcode\.(?:com|cn)|linkedin\.com\/in)\/[^\s<>()[\]{}"'\\|^`]{1,200}/gi;
const GH_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GH_REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const LC_NAME = /^[A-Za-z0-9_-]{1,40}$/;
// First path segments that are pages of the site, not accounts.
const GH_PAGES = new Set(['about', 'apps', 'codespaces', 'collections', 'contact', 'copilot', 'customer-stories', 'enterprise', 'events', 'explore',
  'features', 'issues', 'join', 'login', 'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls', 'readme', 'resources',
  'search', 'security', 'settings', 'site', 'solutions', 'sponsors', 'team', 'topics', 'trending']);
const LC_PAGES = new Set(['accounts', 'assessment', 'explore', 'problems', 'problemset', 'contest', 'discuss', 'interview', 'store', 'studyplan',
  'subscribe', 'tag', 'company', 'problem-list', 'progress', 'submissions', 'profile', 'u', 'circle', 'leetbook', 'graphql']);

const line = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const count = value => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null);
const day = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

function scan(text, found) {
  for (const match of String(text || '').matchAll(LINK)) {
    if (found.size >= MAX.links) return;
    found.add(`https://${match[0].replace(/^https?:\/\//i, '').replace(/[.,;:!?'"]+$/, '')}`);
  }
}

// Links in a résumé PDF: the visible text when it is stored plainly, and the link annotations,
// which usually sit in compressed streams. Bounded, so a crafted file cannot expand without limit.
export function resumeLinks(bytes, { maxStreams = 80, maxInflated = 4 * 1024 * 1024 } = {}) {
  const found = new Set();
  if (!Buffer.isBuffer(bytes)) return [];
  const raw = bytes.toString('latin1');
  scan(raw, found);
  let at = 0, streams = 0, inflated = 0;
  while (streams < maxStreams && inflated < maxInflated) {
    const start = raw.indexOf('stream', at);
    if (start < 0) break;
    let from = start + 6;
    if (raw[from] === '\r') from += 1;
    if (raw[from] === '\n') from += 1;
    const end = raw.indexOf('endstream', from);
    if (end < 0) break;
    at = end + 9;
    if (!/\/FlateDecode/.test(raw.slice(Math.max(0, start - 400), start))) continue;
    streams += 1;
    try {
      const out = inflateSync(bytes.subarray(from, end), { maxOutputLength: maxInflated - inflated });
      inflated += out.length;
      scan(out.toString('latin1'), found);
    } catch { /* Not a plain deflate stream, or too large: skipped. */ }
  }
  return [...found];
}

// { kind: 'pull' | 'repo' | 'user' | 'leetcode', … } or null for anything else.
export function classifyLink(link) {
  let url;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'github.com') {
    const [owner, repository, kind, number] = parts;
    if (!owner || !GH_NAME.test(owner) || GH_PAGES.has(owner.toLowerCase())) return null;
    if (!repository) return { kind: 'user', login: owner };
    const repo = repository.replace(/\.git$/i, '');
    if (!GH_REPO.test(repo)) return null;
    if (kind === 'pull' && /^[1-9]\d{0,6}$/.test(number || '')) return { kind: 'pull', owner, repo, number: Number(number) };
    return { kind: 'repo', owner, repo };
  }
  if (/(^|\.)linkedin\.com$/.test(host)) {
    return parts[0] === 'in' && /^[\p{L}\p{N}%_-]{2,100}$/u.test(parts[1] || '') ? { kind: 'linkedin', url: `https://www.linkedin.com/in/${parts[1]}` } : null;
  }
  if (host === 'leetcode.com' || host === 'leetcode.cn') {
    const username = parts[0] === 'u' ? parts[1] : parts.length === 1 ? parts[0] : null;
    if (!username || !LC_NAME.test(username) || LC_PAGES.has(username.toLowerCase())) return null;
    return { kind: 'leetcode', site: host === 'leetcode.cn' ? 'cn' : 'com', username };
  }
  return null;
}

// What will be looked up for one request: a few pull requests, a few repositories, one account each.
export function evidenceTargets(request, resumeBytes) {
  const found = new Set();
  for (const text of [request?.profileUrl, request?.intro, request?.whyRole, request?.currentTitle, request?.relationshipNote]) scan(text, found);
  for (const link of resumeLinks(resumeBytes)) { if (found.size < MAX.links) found.add(link); }
  const targets = { pulls: [], repos: [], logins: [], leetcode: null, linkedin: '' };
  const seen = new Set();
  for (const link of found) {
    const item = classifyLink(link);
    if (!item) continue;
    const key = JSON.stringify(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.kind === 'pull' && targets.pulls.length < MAX.pulls) targets.pulls.push(item);
    else if (item.kind === 'repo' && targets.repos.length < MAX.repos) targets.repos.push(item);
    else if (item.kind === 'user') targets.logins.push(item.login);
    else if (item.kind === 'leetcode' && !targets.leetcode) targets.leetcode = item;
    else if (item.kind === 'linkedin' && !targets.linkedin) targets.linkedin = item.url;
  }
  return targets;
}

const LC_QUERY = {
  com: 'query($name:String!){matchedUser(username:$name){username} userContestRanking(username:$name){attendedContestsCount rating globalRanking totalParticipants topPercentage badge{name}} '
    + 'userContestRankingHistory(username:$name){attended rating ranking contest{title startTime}}}',
  cn: 'query($name:String!){userContestRanking(userSlug:$name){attendedContestsCount rating globalRanking globalTotalParticipants topPercentage} '
    + 'userContestRankingHistory(userSlug:$name){attended rating ranking contest{title startTime}}}',
};
const LC_ENDPOINT = { com: 'https://leetcode.com/graphql', cn: 'https://leetcode.cn/graphql/noj-go/' };

export function createPublicEvidence({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const token = () => env.REFERRAL_GITHUB_TOKEN || env.GITHUB_TOKEN || '';
  // { data } | { missing: true } | { unavailable: true }
  async function github(path) {
    try {
      const response = await fetchImpl(`https://api.github.com${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'yuqi-site-referral-check',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}) } });
      if (response.status === 404 || response.status === 410) return { missing: true };
      if (!response.ok) return { unavailable: true };
      return { data: await response.json() };
    } catch { return { unavailable: true }; }
  }
  const state = answer => (answer.data ? 'ok' : answer.missing ? 'not_found' : 'unavailable');

  async function pull({ owner, repo, number }) {
    const answer = await github(`/repos/${owner}/${repo}/pulls/${number}`);
    const base = { ref: `${owner}/${repo}#${number}`, status: state(answer) };
    const data = answer.data;
    if (!data) return base;
    return { ...base, title: line(data.title, 120), author: line(data.user?.login, 40), merged: data.merged === true, state: line(data.state, 12),
      mergedAt: day(data.merged_at), additions: count(data.additions), deletions: count(data.deletions), changedFiles: count(data.changed_files),
      repoStars: count(data.base?.repo?.stargazers_count) };
  }
  async function repo({ owner, repo: name }) {
    const answer = await github(`/repos/${owner}/${name}`);
    const base = { ref: `${owner}/${name}`, status: state(answer) };
    const data = answer.data;
    if (!data) return base;
    return { ...base, owner: line(data.owner?.login, 40), fork: data.fork === true, archived: data.archived === true, stars: count(data.stargazers_count),
      forks: count(data.forks_count), language: line(data.language, 30), createdAt: day(data.created_at), pushedAt: day(data.pushed_at) };
  }
  async function account(login) {
    const [user, merged, repos] = await Promise.all([
      github(`/users/${login}`),
      // Merged pull requests in repositories that are not the author's own.
      github(`/search/issues?q=${encodeURIComponent(`type:pr is:merged author:${login} -user:${login}`)}&per_page=1`),
      github(`/users/${login}/repos?type=owner&sort=pushed&per_page=30`),
    ]);
    const base = { login, status: state(user) };
    if (!user.data) return base;
    const own = Array.isArray(repos.data) ? repos.data.filter(item => item && item.fork !== true)
      .sort((a, b) => (count(b.stargazers_count) || 0) - (count(a.stargazers_count) || 0)).slice(0, 3)
      .map(item => ({ name: line(item.name, 60), stars: count(item.stargazers_count), language: line(item.language, 30) })) : [];
    return { ...base, login: line(user.data.login, 40) || login, name: line(user.data.name, 80), createdAt: day(user.data.created_at),
      publicRepos: count(user.data.public_repos), followers: count(user.data.followers),
      mergedElsewhere: merged.data ? count(merged.data.total_count) : null, topOwnRepos: own };
  }
  async function leetcode({ site, username }) {
    const base = { site, username };
    try {
      const response = await fetchImpl(LC_ENDPOINT[site], { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', Referer: `https://leetcode.${site}/`, 'User-Agent': 'yuqi-site-referral-check' },
        body: JSON.stringify({ query: LC_QUERY[site], variables: { name: username } }) });
      if (!response.ok) return { ...base, status: 'unavailable' };
      const body = await response.json();
      if (!body?.data || (Array.isArray(body.errors) && body.errors.length && !body.data.userContestRanking)) return { ...base, status: 'unavailable' };
      if (site === 'com' && !body.data.matchedUser) return { ...base, status: 'not_found' };
      const ranking = body.data.userContestRanking;
      const attended = (Array.isArray(body.data.userContestRankingHistory) ? body.data.userContestRankingHistory : []).filter(item => item?.attended === true);
      const recent = attended.slice(-5).reverse().map(item => ({ contest: line(item.contest?.title, 60),
        date: Number.isFinite(Number(item.contest?.startTime)) ? new Date(Number(item.contest.startTime) * 1000).toISOString().slice(0, 10) : null,
        ranking: count(item.ranking), rating: count(item.rating) }));
      const percent = Number(ranking?.topPercentage);
      return { ...base, status: 'ok', attended: count(ranking?.attendedContestsCount) ?? attended.length, rating: ranking ? count(ranking.rating) : null,
        globalRanking: count(ranking?.globalRanking), totalParticipants: count(ranking?.totalParticipants ?? ranking?.globalTotalParticipants),
        topPercentage: Number.isFinite(percent) && percent > 0 && percent <= 100 ? Math.round(percent * 100) / 100 : null,
        badge: line(ranking?.badge?.name, 30), recent };
    } catch { return { ...base, status: 'unavailable' }; }
  }

  return {
    // Never throws. Returns null when the request names nothing that can be looked up.
    async gather(request, resume) {
      const targets = evidenceTargets(request, resume?.bytes);
      // LinkedIn is never fetched: the profile link is only noted, for the owner to open.
      if (!targets.pulls.length && !targets.repos.length && !targets.logins.length && !targets.leetcode) return targets.linkedin ? { linkedin: targets.linkedin } : null;
      const [pulls, repos, contest] = await Promise.all([
        Promise.all(targets.pulls.map(pull)), Promise.all(targets.repos.map(repo)), targets.leetcode ? leetcode(targets.leetcode) : null,
      ]);
      // One account: the profile the applicant linked, else the author of the cited pull requests, else the repository owner.
      const authors = [...new Set(pulls.map(item => item.author).filter(Boolean))];
      const login = targets.logins[0] || (authors.length === 1 ? authors[0] : '') || repos.find(item => item.status === 'ok' && !item.fork)?.owner || '';
      const user = login && GH_NAME.test(login) ? await account(login) : null;
      const asked = [...pulls, ...repos, ...(user ? [user] : [])];
      const result = { checkedAt: new Date(now()).toISOString() };
      if (asked.length) result.github = { status: asked.every(item => item.status === 'unavailable') ? 'unavailable' : 'checked', account: user, pulls, repos };
      if (contest) result.leetcode = contest;
      if (targets.linkedin) result.linkedin = targets.linkedin;
      return result;
    },
  };
}

// What each evidence path's references turned out to be:
//   'verified'      a cited pull request is merged, a cited repository is an original one, or the
//                   account has merged work in other people's repositories; a contest history exists
//   'contradicted'  the lookups worked and none of the cited references holds
//   'unavailable'   the service could not be asked; the applicant is not penalised
// A path with nothing to look up is absent, and is judged on its submitted references as before.
export function pathChecks(evidence) {
  const checks = {};
  const github = evidence?.github;
  if (github) {
    const cited = [...github.pulls, ...github.repos];
    const holds = github.pulls.some(item => item.status === 'ok' && item.merged) || github.repos.some(item => item.status === 'ok' && !item.fork)
      || (github.account?.mergedElsewhere || 0) > 0;
    if (holds) checks.openSource = 'verified';
    else if (github.status === 'unavailable' || cited.some(item => item.status === 'unavailable')) checks.openSource = 'unavailable';
    else if (cited.length) checks.openSource = 'contradicted';
  }
  const contest = evidence?.leetcode;
  if (contest) {
    checks.contests = contest.status === 'unavailable' ? 'unavailable'
      : contest.status === 'ok' && contest.attended > 0 && contest.rating > 0 ? 'verified' : 'contradicted';
  }
  return checks;
}

// The facts as the screening model receives them. Titles and names are other people's text and stay untrusted.
export function evidenceForModel(evidence) {
  if (!evidence?.github && !evidence?.leetcode) return null;
  const { github, leetcode } = evidence;
  return {
    note: 'Fetched by the server from public APIs. Facts about these accounts; not proof that an account belongs to the applicant.',
    ...(github ? { github: { lookups: github.status, account: github.account, pullRequests: github.pulls, repositories: github.repos } } : {}),
    ...(leetcode ? { leetcode } : {}),
  };
}

// Short sentences for the review page and the applicant's status page. Built from the fetched
// facts only: none of the applicant's or the model's wording is repeated here.
export function evidenceFacts(evidence) {
  const facts = { openSource: [], contests: [] };
  const github = evidence?.github;
  if (github) {
    for (const item of github.pulls) {
      facts.openSource.push(item.status === 'unavailable' ? `Pull request ${item.ref} could not be checked.`
        : item.status === 'not_found' ? `Pull request ${item.ref} was not found.`
          : `Pull request ${item.ref} by ${item.author || 'an unknown author'} is ${item.merged ? `merged${item.mergedAt ? ` (${item.mergedAt})` : ''}` : `not merged (${item.state || 'open'})`}`
            + `${item.additions !== null && item.deletions !== null ? `; +${item.additions} −${item.deletions} lines` : ''}${item.repoStars !== null ? `; the repository has ${item.repoStars} stars` : ''}.`);
    }
    for (const item of github.repos) {
      facts.openSource.push(item.status === 'unavailable' ? `Repository ${item.ref} could not be checked.`
        : item.status === 'not_found' ? `Repository ${item.ref} was not found, or is private.`
          : `Repository ${item.ref} is ${item.fork ? 'a fork' : 'an original repository'}${item.stars !== null ? ` with ${item.stars} stars` : ''}`
            + `${item.language ? `, mostly ${item.language}` : ''}${item.pushedAt ? `, last pushed ${item.pushedAt}` : ''}.`);
    }
    const account = github.account;
    if (account?.status === 'ok') {
      facts.openSource.push(`GitHub account ${account.login}: ${account.publicRepos ?? 0} public repositories`
        + `${account.mergedElsewhere !== null ? `, ${account.mergedElsewhere} merged pull requests in other people's repositories` : ''}.`);
    } else if (account?.status === 'not_found') facts.openSource.push(`GitHub account ${account.login} was not found.`);
  }
  const contest = evidence?.leetcode;
  if (contest) {
    const host = `leetcode.${contest.site}`;
    facts.contests.push(contest.status === 'unavailable' ? `The contest history of ${contest.username} on ${host} could not be checked.`
      : contest.status === 'not_found' ? `No account named ${contest.username} was found on ${host}.`
        : !contest.attended || !contest.rating ? `${contest.username} on ${host} has no rated contest history.`
          : `${contest.username} on ${host}: contest rating ${contest.rating} over ${contest.attended} contests`
            + `${contest.topPercentage !== null ? `, top ${contest.topPercentage}%` : ''}${contest.globalRanking ? `, global rank ${contest.globalRanking}` : ''}.`);
  }
  return facts;
}
