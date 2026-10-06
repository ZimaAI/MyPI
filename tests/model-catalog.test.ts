import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  providerPresets,
  approvedModelEndpoints,
  modelLimitError,
} from '../packages/contracts/src/index.ts';
import { parseArgs, loadConfig } from '../apps/cli/src/config.ts';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import { ModelRepository, SecretBox } from '../packages/storage-sqlite/src/security.ts';

test('catalog defaults have official sources, unique approved HTTPS endpoints and valid token budgets', () => {
  assert.equal(providerPresets.length, 16);
  assert.equal(new Set(providerPresets.map((p) => p.id)).size, providerPresets.length);
  const endpoints = providerPresets.flatMap((p) => p.endpoints);
  assert.equal(new Set(endpoints.map((e) => e.id)).size, endpoints.length);
  for (const provider of providerPresets) {
    assert.ok(provider.models.some((m) => m.id === provider.defaultModelId));
    assert.equal(approvedModelEndpoints[provider.defaultEndpointId].providerType, provider.id);
    for (const endpoint of provider.endpoints) {
      const url = new URL(endpoint.baseUrl);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.username + url.password + url.search + url.hash, '');
    }
    assert.equal(new Set(provider.models.map((m) => m.id)).size, provider.models.length);
    for (const model of provider.models) {
      assert.ok(model.sources.every((url) => new URL(url).protocol === 'https:'));
      assert.equal(
        modelLimitError(
          provider.id,
          model.id,
          model.defaultContextWindow,
          model.defaultOutputTokens,
        ),
        undefined,
      );
      assert.ok(model.thinkingLevels.includes(model.thinkingLevel));
    }
  }
  assert.equal(
    approvedModelEndpoints.google.baseUrl,
    'https://generativelanguage.googleapis.com/v1beta',
  );
  assert.equal(approvedModelEndpoints.tencent.baseUrl, 'https://tokenhub.tencentmaas.com/v1');
  assert.equal(approvedModelEndpoints.minimax.baseUrl, 'https://api.minimax.cn/anthropic');
  assert.ok(modelLimitError('openai', 'gpt-6.1-sol', 1050000, 1));
  assert.ok(modelLimitError('groq', 'openai/gpt-oss-120b', 131072, 65537));
  assert.ok(modelLimitError('deepseek', 'deepseek-flash', 1024, 8192));
  assert.ok(modelLimitError('google', 'gemini-3.8-flash', 2000000, 8192));
});

test('CLI uses provider defaults and key env names, supports regions and explicit overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mypi-provider-cli-'));
  try {
    for (const provider of providerPresets) {
      const options = parseArgs(['--state-dir', dir, '--provider', provider.id], dir);
      const { model } = await loadConfig(options, { [provider.apiKeyEnv]: 'fixture-provider-key' });
      assert.equal(model.modelId, provider.defaultModelId);
      assert.equal(model.protocol, provider.protocol);
      assert.equal(model.apiKey, 'fixture-provider-key');
      assert.equal(model.baseUrl, approvedModelEndpoints[provider.defaultEndpointId].baseUrl);
    }
    const options = parseArgs(
      ['--state-dir', dir, '--provider', 'dashscope', '--endpoint', 'dashscope-intl'],
      dir,
    );
    assert.equal(
      (await loadConfig(options, {})).model.baseUrl,
      approvedModelEndpoints['dashscope-intl'].baseUrl,
    );
    assert.equal(
      (await loadConfig({ ...options, baseUrl: 'http://127.0.0.1:1234/v1' }, {})).model.baseUrl,
      'http://127.0.0.1:1234/v1',
    );
    await assert.rejects(loadConfig({ ...options, endpoint: 'openai' }, {}), /does not match/);
    assert.equal(
      (await loadConfig(options, { MYPI_API_KEY: 'override', DASHSCOPE_API_KEY: 'provider' })).model
        .apiKey,
      'override',
    );
    await writeFile(join(dir, 'config.json'), JSON.stringify({ maxOutputTokens: 131073 }));
    await assert.rejects(loadConfig(options, {}), /官方上限/);
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        provider: 'openai',
        apiKey: 'private-openai-key',
        model: 'gpt-6-astra',
        baseUrl: 'https://api.openai.com/v1',
        maxOutputTokens: 100000,
      }),
    );
    const switched = (await loadConfig({ ...options, provider: 'google', endpoint: undefined }, {}))
      .model;
    assert.equal(switched.modelId, 'gemini-3.8-flash');
    assert.equal(switched.apiKey, undefined);
    assert.equal(switched.baseUrl, approvedModelEndpoints.google.baseUrl);
    assert.equal(switched.maxOutputTokens, 8192);
    assert.equal(parseArgs(['models', '--provider', 'deepseek', '--json']).command, 'models');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stored preset transport settings survive key resolution while legacy thinking stays disabled', () => {
  const store = new SqliteStore(':memory:');
  const secrets = new SecretBox(Buffer.alloc(32, 8).toString('base64'));
  const repository = new ModelRepository(store, secrets);
  try {
    for (const provider of providerPresets) {
      const preset = provider.models[0];
      store.put('model', provider.id, {
        id: provider.id,
        displayName: preset.name,
        providerType: provider.id,
        modelId: preset.id,
        approvedEndpointId: provider.defaultEndpointId,
        encryptedKey: secrets.encrypt('fixture-only-key'),
        protocol: provider.protocol,
        reasoning: preset.reasoning,
        thinkingLevel: preset.thinkingLevel,
        maxOutputTokens: preset.defaultOutputTokens,
        contextWindow: preset.defaultContextWindow,
      });
      const model = repository.resolveModel(provider.id, false);
      assert.equal(model.protocol, provider.protocol);
      assert.equal(model.baseUrl, approvedModelEndpoints[provider.defaultEndpointId].baseUrl);
      assert.equal(model.thinkingLevel, preset.thinkingLevel);
      assert.equal(model.apiKey, 'fixture-only-key');
    }
    const legacy = store.get<any>('model', 'openai')!.data;
    delete legacy.protocol;
    delete legacy.reasoning;
    delete legacy.thinkingLevel;
    store.put('model', 'openai', legacy);
    const restored = repository.resolveModel('openai', false);
    assert.equal(restored.protocol, undefined);
    assert.equal(restored.reasoning, false);
    assert.equal(restored.thinkingLevel, 'off');
    assert.ok(!JSON.stringify(repository.list()).includes('fixture-only-key'));
  } finally {
    store.close();
  }
});
