import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default function handler(req, res) { return referralRuntime().complete(req, res); }
