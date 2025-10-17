const fibonacci = (n) => {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i += 1) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
};

const handlers = {
  ping: (payload) => `pong:${payload ?? ''}`,
  fibonacci: (payload) => fibonacci(Math.min(Math.max(payload ?? 0, 0), 40)),
  hash: async (payload) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(String(payload));
    if (self.crypto?.subtle?.digest) {
      const digest = await self.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    }
    let hash = 0;
    for (let i = 0; i < data.length; i += 1) {
      hash = (hash << 5) - hash + data[i];
      hash |= 0;
    }
    return hash.toString(16);
  },
};

self.onmessage = async (event) => {
  const { id, task, payload } = event.data;
  const handler = handlers[task];
  if (!handler) {
    self.postMessage({ id, error: `Unknown task ${task}` });
    return;
  }
  try {
    const result = await handler(payload);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? 'Worker error' });
  }
};
