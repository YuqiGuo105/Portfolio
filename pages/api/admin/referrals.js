import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default function handler(req, res) { return referralRuntime().admin(req, res); }
