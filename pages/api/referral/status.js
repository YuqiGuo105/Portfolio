import { referralRuntime } from '../../../src/lib/referral/runtime.mjs';

// Where a request stands, for the person holding its status link. Never the score or the note.
export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default function handler(req, res) { return referralRuntime().status(req, res); }
