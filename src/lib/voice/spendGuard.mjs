import { randomUUID } from 'node:crypto';

export class SpendDenied extends Error {
  constructor(reason = 'unavailable') {
    super('AI usage is temporarily unavailable.');
    this.name = 'SpendDenied';
    this.reason = reason;
  }
}

// Server-only. No disable switch: development and production share this ledger.
export function createSpendGuard({ env = process.env, fetchImpl = fetch } = {}) {
  const url = env.AI_SPEND_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.AI_SPEND_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  async function rpc(body) {
    try {
      const endpoint = new URL('/rest/v1/rpc/ai_spend_guard', url);
      if (endpoint.protocol !== 'https:' || !key || endpoint.username || endpoint.password) throw new Error();
      const response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3500),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (typeof value?.allowed !== 'boolean') throw new Error();
      if (!value.allowed) throw new SpendDenied(value.reason);
      return value;
    } catch (error) {
      throw error instanceof SpendDenied ? error : new SpendDenied();
    }
  }
  return {
    status: () => rpc({ p_action: 'status' }),
    async reserve(provider, operation, micros) {
      if (!['google', 'qwen'].includes(provider) || !Number.isSafeInteger(micros) || micros < 1 || micros > 8e6) throw new SpendDenied('invalid_estimate');
      const id = randomUUID();
      await rpc({ p_action: 'reserve', p_id: id, p_provider: provider, p_operation: operation, p_micros: micros });
      let settled;
      return {
        id, micros,
        settle(actualMicros = null) {
          if (actualMicros !== null && (!Number.isSafeInteger(actualMicros) || actualMicros < 0)) return Promise.reject(new SpendDenied('invalid_usage'));
          // An ambiguous reservation is never retried into a second provider call.
          // Idempotent settlement may be retried, with its original value only.
          settled ??= { value: actualMicros };
          return rpc({ p_action: 'settle', p_id: id, p_micros: settled.value });
        },
      };
    },
  };
}
