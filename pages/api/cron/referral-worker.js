// Screens queued referral requests, sends the digest email and, on the scheduler's daily GET,
// removes expired résumé files and requests. See src/lib/referral/worker.mjs.
import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';

export default function handler(req, res) { return referralRuntime().work(req, res); }
