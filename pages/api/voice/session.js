import { createSessionHandler } from '../../../src/lib/voice/sessionServer.mjs';
import { createVoiceProxy } from '../../../src/lib/voice/productionProxy.mjs';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
const local = createSessionHandler();
const production = createVoiceProxy();
export default function handler(req, res) {
  return process.env.VOICE_ENABLED === 'true' || process.env.NODE_ENV === 'production'
    ? production(req, res) : local(req, res);
}
