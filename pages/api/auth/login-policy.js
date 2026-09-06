export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Auth settings unavailable');
    const settings = await response.json();
    return res.status(200).json({
      googleEnabled: settings.external?.google === true,
      existingAccountsOnly: settings.disable_signup === true,
    });
  } catch {
    return res.status(503).json({ error: 'login_policy_unavailable' });
  }
}
