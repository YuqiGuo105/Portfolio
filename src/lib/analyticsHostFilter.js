const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/;

export function isDevelopmentAnalyticsRuntime(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "development" || nodeEnv === "test";
}

export function isLocalAnalyticsHostname(value) {
  const hostname = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isLoopbackHostname(hostname) || hostname === "0.0.0.0"
      || hostname.endsWith(".local") || hostname.endsWith(".test")) return true;
  const octets = hostname.split(".").map(Number);
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
    && octets.every(n => n >= 0 && n <= 255)
    && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
}

export function isBrowserAnalyticsDisabled(hostname) {
  return isDevelopmentAnalyticsRuntime() || isLocalAnalyticsHostname(hostname);
}

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
  if (isDevelopmentAnalyticsRuntime()) return true;
  const origin = firstHeader(req?.headers?.origin);
  const referer = firstHeader(req?.headers?.referer);
  const forwardedHost = firstHeader(req?.headers?.["x-forwarded-host"]);
  const host = firstHeader(req?.headers?.host);
  return isLocalAnalyticsUrl(origin)
    || isLocalAnalyticsUrl(referer)
    || isLocalAnalyticsHostname(readHostname(forwardedHost))
    || isLocalAnalyticsHostname(readHostname(host));
}

export function isLocalAnalyticsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return isLocalAnalyticsHostname(new URL(value, "https://www.yuqi.site").hostname);
  } catch {
    return false;
  }
}

export function isLocalAnalyticsEvent(body = {}) {
  return [body?.page, body?.pageUrl].some(isLocalAnalyticsUrl);
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
