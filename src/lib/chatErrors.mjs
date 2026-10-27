const MESSAGES = Object.freeze({
  AI_BUDGET_PAUSED: 'AI requests are paused until the spending budget is enabled. Rephrasing your message will not resolve this.',
  AI_BUDGET_EXHAUSTED: 'The shared AI spending limit has been reached. Requests are paused to prevent extra charges.',
  AI_BUDGET_UNAVAILABLE: 'The AI spending budget could not be verified. No new model request was started.',
  AI_ROUTING_UNAVAILABLE: 'The AI service could not process this request. This is a service issue, not a problem with your question.',
  AI_SERVICE_UNAVAILABLE: 'The AI service is temporarily unavailable. Please try again later.',
  LOCAL_CHAT_UNSUPPORTED: 'This local preview supports Fast text chat. Deep mode, attachments and account actions are not available here yet.',
  RATE_LIMITED: 'Please wait a moment before sending another message.',
  INVALID_REQUEST: 'Please enter a message of at most 4,000 characters.',
  AUTH_REQUIRED: 'Please sign in before continuing this request.',
  REQUEST_FORBIDDEN: 'This request is not allowed from the current page.',
  RESPONSE_TIMEOUT: 'The AI response timed out. Please try again later.',
  RESPONSE_INCOMPLETE: 'The response ended before it was completed. Please try again later.',
});

// Only stable error codes cross into the UI. Provider text may contain URLs,
// credentials or implementation details, so it is never displayed verbatim.
export class ChatRequestError extends Error {
  constructor(code = 'AI_SERVICE_UNAVAILABLE') {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'AI_SERVICE_UNAVAILABLE';
    super(MESSAGES[safeCode]);
    this.name = 'ChatRequestError';
    this.code = safeCode;
  }
}

export function chatRequestError(payload, status) {
  const fallback = ({ 400: 'INVALID_REQUEST', 401: 'AUTH_REQUIRED', 403: 'REQUEST_FORBIDDEN', 429: 'RATE_LIMITED' })[status];
  return new ChatRequestError(payload?.code || fallback);
}

export function chatFailure(error) {
  return error instanceof ChatRequestError ? error
    : new ChatRequestError(error?.name === 'TimeoutError' ? 'RESPONSE_TIMEOUT' : undefined);
}

export function failAssistantMessage(message, error, now = Date.now()) {
  const failure = chatFailure(error);
  const stages = Array.isArray(message.executionStages) ? message.executionStages : [];
  return { ...message, content: failure.message, errorCode: failure.code, streaming: false, thinkingNow: null,
    executionStages: stages.map((entry, index) => index === stages.length - 1
      ? { ...entry, status: 'failed', tsEnd: entry.tsEnd || now } : entry) };
}

export function chatStepsLabel(count, failed) {
  return failed ? 'Request failed' : `Completed ${count} step${count === 1 ? '' : 's'}`;
}
