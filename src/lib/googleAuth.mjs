export const EXISTING_ACCOUNT_MESSAGE = 'Sign-in is limited to existing accounts. Please contact the site owner for access.';

export function safeLoginRedirect(target, fallback = '/') {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')
      || /[\\\u0000-\u0020]/.test(target)) return fallback;
  try {
    const url = new URL(target, 'https://local.invalid');
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://local.invalid' || path.startsWith('//') || /[\\\u0000-\u0020]/.test(path)
        || /^(?:\/auth|\/admin)\/callback\/?$/.test(path)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function googleLoginOptions(origin, redirect, admin = false) {
  return {
    provider: 'google',
    options: {
      redirectTo: `${origin}${admin ? '/admin' : '/auth'}/callback?redirect=${encodeURIComponent(safeLoginRedirect(redirect, admin ? '/admin' : '/'))}`,
      queryParams: { prompt: 'select_account' },
    },
  };
}

export function googleAuthError(code) {
  if (['signup_disabled', 'user_already_exists', 'email_exists', 'access_denied'].includes(code)) return EXISTING_ACCOUNT_MESSAGE;
  return 'Google sign-in could not be completed. Please try again.';
}

export async function startGoogleLogin(client, { origin, redirect, admin = false, fetcher = fetch }) {
  const response = await fetcher('/api/auth/login-policy', { cache: 'no-store' });
  const policy = response.ok ? await response.json() : null;
  // Defense in depth only: Supabase Auth must enforce disabled signups itself.
  if (policy?.googleEnabled !== true || policy?.existingAccountsOnly !== true) {
    throw new Error('Google sign-in is temporarily unavailable. Please use your existing email and password.');
  }
  const { error } = await client.auth.signInWithOAuth(googleLoginOptions(origin, redirect, admin));
  if (error) throw new Error(googleAuthError(error.code));
}

const exchanges = new WeakMap();
export async function completeGoogleLogin(client, code) {
  if (typeof code !== 'string' || !code) throw new Error('Google sign-in returned without an authorization code.');
  // React may remount an effect; a one-time PKCE code must only be redeemed once.
  let entry = exchanges.get(client);
  if (entry?.code !== code) {
    entry = { code, promise: client.auth.exchangeCodeForSession(code) };
    exchanges.set(client, entry);
  }
  const { data, error } = await entry.promise;
  if (error || !data?.session) throw new Error(googleAuthError(error?.code));
  const verified = await client.auth.getUser();
  if (verified.error || !verified.data?.user?.email || verified.data.user.is_anonymous
      || !verified.data.user.email_confirmed_at) {
    await client.auth.signOut({ scope: 'local' });
    throw new Error(EXISTING_ACCOUNT_MESSAGE);
  }
  return verified.data.user;
}
