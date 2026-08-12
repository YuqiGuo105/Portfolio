const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/;

export function isLoopbackHostname(value) {
  const hostname = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "::1"
    || LOOPBACK_IPV4.test(hostname);
}

export function isLoopbackUrl(value, baseUrl) {
  const candidate = String(value || "").trim();
  if (!candidate) return false;
  try {
    return isLoopbackHostname(new URL(candidate, baseUrl).hostname);
  } catch {
    return false;
  }
}

export function isLocalAnalyticsRequest(req) {
  const origin = firstHeader(req?.headers?.origin);
  const referer = firstHeader(req?.headers?.referer);
  const forwardedHost = firstHeader(req?.headers?.["x-forwarded-host"]);
  const host = firstHeader(req?.headers?.host);
  return isLoopbackUrl(origin)
    || isLoopbackUrl(referer)
    || isLoopbackHostname(readHostname(forwardedHost))
    || isLoopbackHostname(readHostname(host));
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : String(value || "").split(",")[0].trim();
}

function readHostname(host) {
  const value = String(host || "").trim();
  if (!value) return "";
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return value.replace(/:\d+$/, "");
  }
}
