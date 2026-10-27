export function localQwenEnabled(req, env = process.env) {
  if (env.LOCAL_QWEN_ASSISTANT !== 'true' || env.NODE_ENV !== 'development' || env.VERCEL || env.K_SERVICE) return false;
  const address = req.socket?.remoteAddress;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  try { return !req.headers.origin || new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}

export const DICTATION_MESSAGES = Object.freeze({
  invalid_audio: 'The recording could not be read. Please record again.',
  no_speech: 'No speech detected. Please try again.',
  dictation_timeout: 'Transcription timed out. Please try a shorter recording.',
  monthly_limit: 'The shared AI budget has been reached. Please type your message.',
  disabled: 'Voice input is waiting for the AI budget to be enabled.',
  dictation_not_configured: 'Voice input is not configured on this server.',
  dictation_unavailable: 'The transcription service is unavailable. Please try again later.',
  unavailable: 'The AI budget could not be verified. Please try again later.',
});
