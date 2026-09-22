const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_HOSTS = ['yuqi.site', 'www.yuqi.site'];

function configuredHosts(env) {
  const raw = env.RECAPTCHA_ALLOWED_HOSTS || DEFAULT_HOSTS.join(',');
  return new Set(raw.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function cleanReasons(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((reason) => typeof reason === 'string')
    .map((reason) => reason.trim().slice(0, 64))
    .filter(Boolean)
    .slice(0, 8);
}

function verifiedBot(value) {
  if (!Array.isArray(value)) return null;
  const bot = value.find((candidate) => candidate && typeof candidate.botType === 'string');
  return bot?.botType?.slice(0, 64) || null;
}

export function recaptchaConfigured(env = process.env) {
  return Boolean(
    env.RECAPTCHA_PROJECT_ID
    && env.RECAPTCHA_API_KEY
    && env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  );
}

export async function createRecaptchaAssessment({
  token,
  expectedAction,
  userAgent,
  userIpAddress,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(env.RECAPTCHA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
}) {
  if (!recaptchaConfigured(env)) return { status: 'SKIPPED' };
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) {
    return { status: 'MISSING_TOKEN' };
  }
  if (!/^[a-zA-Z0-9_/-]{1,100}$/.test(expectedAction || '')) {
    return { status: 'INVALID_ACTION' };
  }
  if (typeof fetchImpl !== 'function') return { status: 'PROVIDER_UNAVAILABLE' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  const projectId = encodeURIComponent(env.RECAPTCHA_PROJECT_ID);
  const apiKey = encodeURIComponent(env.RECAPTCHA_API_KEY);
  const endpoint = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        event: {
          token,
          siteKey: env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
          expectedAction,
          userAgent: String(userAgent || '').slice(0, 1024),
          userIpAddress: String(userIpAddress || '').slice(0, 64),
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { status: 'PROVIDER_ERROR', httpStatus: response.status };

    const payload = await response.json();
    const tokenProperties = payload?.tokenProperties || {};
    if (tokenProperties.valid !== true) {
      return {
        status: 'INVALID_TOKEN',
        invalidReason: String(tokenProperties.invalidReason || 'UNKNOWN').slice(0, 64),
      };
    }
    if (tokenProperties.action !== expectedAction) return { status: 'ACTION_MISMATCH' };

    const hostname = String(tokenProperties.hostname || '').toLowerCase();
    if (!configuredHosts(env).has(hostname)) return { status: 'HOSTNAME_MISMATCH' };

    const humanScore = Number(payload?.riskAnalysis?.score);
    if (!Number.isFinite(humanScore) || humanScore < 0 || humanScore > 1) {
      return { status: 'INVALID_SCORE' };
    }

    return {
      status: 'VALID',
      humanScore,
      reasons: cleanReasons(payload?.riskAnalysis?.reasons),
      verifiedBotType: verifiedBot(payload?.riskAnalysis?.verifiedBots),
    };
  } catch (error) {
    return { status: error?.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}

export function assessmentProperties(assessment) {
  if (!assessment || assessment.status === 'SKIPPED' || assessment.status === 'MISSING_TOKEN') return {};
  const properties = {
    botAssessmentProvider: 'GOOGLE_RECAPTCHA_ENTERPRISE',
    botAssessmentStatus: assessment.status,
  };
  if (assessment.status !== 'VALID') return properties;

  properties.botAssessmentHumanScore = assessment.humanScore;
  if (assessment.reasons?.length) properties.botAssessmentReasons = assessment.reasons.join(',');
  if (assessment.verifiedBotType) {
    properties.botAssessmentVerifiedBot = true;
    properties.botAssessmentVerifiedBotType = assessment.verifiedBotType;
  }
  return properties;
}
