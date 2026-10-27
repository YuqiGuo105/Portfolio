import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantLocalConfig } from '../scripts/assistant-local-config.mjs';

const configured = {
  AGENT_SERVICE_URL: 'https://agent.example.test', AGENT_SERVICE_INTERNAL_TOKEN: 'test-secret',
  QWEN_LIVE_API_KEY: 'test-key', QWEN_LIVE_WORKSPACE_ID: 'test-workspace',
  QWEN_TEXT_API_KEY: 'test-text-key',
  QWEN_LIVE_ENABLED: 'true', QWEN_LIVE_TRIAL_ACK: 'true',
};

test('restores the local Qwen route without enabling the production relay', () => {
  const env = assistantLocalConfig(configured);
  assert.equal(env.NEXT_PUBLIC_VOICE_DEFAULT_PROVIDER, 'qwen');
  assert.equal(env.VOICE_ENABLED, 'false');
  assert.equal(env.VOICE_PREVIEW_PORT, '3118');
  assert.equal(env.QWEN_LIVE_UNLIMITED_LOCAL, 'false');
  assert.equal(configured.NODE_ENV, undefined);
});
test('unlimited calls require an explicit local launch option', () => {
  assert.equal(assistantLocalConfig(configured, { unlimited: true }).QWEN_LIVE_UNLIMITED_LOCAL, 'true');
});
test('missing shared agent authentication fails before serving broken chat and dictation', () => {
  assert.throws(() => assistantLocalConfig({ ...configured, AGENT_SERVICE_INTERNAL_TOKEN: '' }), /AGENT_SERVICE_INTERNAL_TOKEN/);
});
test('deployed environments cannot use the local override', () => {
  for (const marker of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { K_SERVICE: 'voice' }]) {
    assert.throws(() => assistantLocalConfig({ ...configured, ...marker }, { unlimited: true }), /deployed/);
  }
});
test('Qwen approval, workspace and safe endpoint remain required', () => {
  assert.throws(() => assistantLocalConfig({ ...configured, QWEN_LIVE_TRIAL_ACK: 'false' }), /approved/);
  assert.throws(() => assistantLocalConfig({ ...configured, QWEN_LIVE_WORKSPACE_ID: '../invalid' }), /workspace/);
  assert.throws(() => assistantLocalConfig({ ...configured, AGENT_SERVICE_URL: 'http://remote.example.test' }), /HTTPS/);
  assert.equal(assistantLocalConfig({ ...configured, AGENT_SERVICE_URL: 'http://127.0.0.1:8080' }).NODE_ENV, 'development');
});
test('invalid ports fail with no credentials in diagnostic output', () => {
  assert.throws(() => assistantLocalConfig({ ...configured, VOICE_PREVIEW_PORT: 'NaN' }), /Invalid local preview port/);
  try { assistantLocalConfig({ ...configured, QWEN_LIVE_API_KEY: '' }); } catch (error) {
    assert.ok(!error.message.includes(configured.AGENT_SERVICE_INTERNAL_TOKEN));
  }
});
