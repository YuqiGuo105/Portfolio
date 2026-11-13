import { createClient } from 'redis';

const CAS = `if redis.call('GET', KEYS[1]) ~= ARGV[1] and not (redis.call('GET', KEYS[1]) == false and ARGV[1] == '') then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1`;
export function memoryStore(now = Date.now) {
  const data = new Map();
  const raw = key => { const row = data.get(key); if (!row || row.until < now()) { data.delete(key); return null; } return row.value; };
  return {
    async get(key) { const value = raw(key); return value ? JSON.parse(value) : null; },
    async set(key, value, ttl = 3600) { data.set(key, { value: JSON.stringify(value), until: now() + ttl * 1000 }); },
    async update(key, change, ttl = 3600) { const before = raw(key); const next = change(before ? JSON.parse(before) : null); data.set(key, { value: JSON.stringify(next), until: now() + ttl * 1000 }); return next; },
    async close() {},
  };
}

export function redisStore(url, prefix = 'portfolio:discovery:v1:') {
  if (!url || !/^rediss?:\/\//.test(url)) throw new Error('Discovery Redis is not configured');
  if (process.env.NODE_ENV === 'production' && !url.startsWith('rediss://')) throw new Error('Discovery Redis requires TLS');
  const client = createClient({ url, socket: { connectTimeout: 1200, reconnectStrategy: false }, disableOfflineQueue: true });
  client.on('error', () => {});
  let connecting;
  const ready = async () => { if (!client.isReady) { connecting ||= client.connect().finally(() => { connecting = null; }); await connecting; } };
  const command = async run => {
    await ready();
    let timer;
    try { return await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => {
      if (client.isOpen) client.disconnect().catch(() => {});
      reject(new Error('Discovery storage timeout'));
    }, 1500); })]); } finally { clearTimeout(timer); }
  };
  const readRaw = key => command(() => client.get(prefix + key));
  return {
    async get(key) { const value = await readRaw(key); return value ? JSON.parse(value) : null; },
    async set(key, value, ttl = 3600) { await command(() => client.set(prefix + key, JSON.stringify(value), { EX: ttl })); },
    async update(key, change, ttl = 3600) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const before = await readRaw(key), next = change(before ? JSON.parse(before) : null);
        if (await command(() => client.eval(CAS, { keys: [prefix + key], arguments: [before || '', JSON.stringify(next), String(ttl)] }))) return next;
      }
      throw new Error('Discovery storage busy');
    },
    async close() { if (client.isOpen) await client.quit(); },
  };
}
