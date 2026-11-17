import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';

// Form answers only. The résumé goes from the browser straight to storage, never through here.
export const config = { api: { bodyParser: { sizeLimit: '48kb' } } };

export default function handler(req, res) { return referralRuntime().submit(req, res); }
