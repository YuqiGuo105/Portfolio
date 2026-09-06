export function consentError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const restartRequired = error?.status === 404 ||
    ['authorization_not_found', 'authorization_expired', 'invalid_authorization_id'].includes(code) ||
    /authorization (?:request )?(?:not found|expired|has expired|already used|already processed)/.test(message);
  return restartRequired ? {
    restartRequired: true,
    message: 'This connection request has expired or is no longer available. Return to your AI client and start Connect again to get a new authorization link. Signing in again or refreshing this page will not renew this request.',
  } : {
    restartRequired: false,
    message: 'Could not verify this connection request. Please try again. No new access has been confirmed by this page.',
  };
}

export function canDecideConsent({ details, authorizationId, status, error, decision }) {
  return Boolean(details?.authorization_id && details.authorization_id === authorizationId && !status && !error && !decision);
}
