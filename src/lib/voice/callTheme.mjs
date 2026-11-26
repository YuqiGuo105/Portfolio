// The ground Mr. Pot stands on during a call, in each theme. The 3D scene paints it, and the call
// window continues the same colour below the stage (--vc-floor in LiveVoiceCall.module.css), so
// the two must stay equal: tests/voice-call-theme.test.mjs compares them.
export const CALL_GROUND = {
  light: { floor: '#f4efe7', shadow: '#5d5348', shade: 0.13 },
  dark: { floor: '#1c2025', shadow: '#000000', shade: 0.36 },
};

// The site switches themes with a class on <body> (src/layout/Header.js); the chat window also
// honours a `dark` class on the page, so the call does too.
export const isDarkPage = (doc = globalThis.document) =>
  Boolean(doc?.body?.classList.contains('dark-skin') || doc?.querySelector?.('html.dark, body.dark'));
