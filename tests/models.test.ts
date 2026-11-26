import assert from 'node:assert/strict';
import test from 'node:test';
import { TutorClient } from '../src/lib/client.ts';
import { connection } from '../src/lib/connection.ts';
import { modelOptions, resolveTurnModel, loadModelOptions, providerEdit, discoveryModels, selection, sourceFor, supportsTurnReasoning, type Catalog, type ModelOptions } from '../src/lib/models.ts';

const data: ModelOptions = { active: { profile_id: 'profile-b', model_id: 'id-b' }, options: [
  { profile_id: 'profile-a', model_id: 'id-a', model: 'model-version-a', model_name: 'A', profile_name: 'Provider', provider: 'custom', is_active_default: false },
  { profile_id: 'profile-b', model_id: 'id-b', model: 'model-version-b', model_name: 'B', profile_name: 'Provider', provider: 'custom', is_active_default: true },
] };
test('new turn uses real IDs; default explicitly overrides the old session choice', () => {
  assert.deepEqual(resolveTurnModel(data, data.options[0]), { profile_id: 'profile-a', model_id: 'id-a' });
  assert.deepEqual(resolveTurnModel(data, null), data.active);
  assert.throws(() => resolveTurnModel(data, { profile_id: 'removed', model_id: 'id-a' }), /不可用/);
  assert.throws(() => resolveTurnModel({ active: null, options: [] }, null), /没有可用模型/);
});
test('model listing strips secrets and rejects malformed option rows', () => {
  assert.equal(JSON.stringify(modelOptions({ ...data, api_key: 'fixture-key' })).includes('fixture-key'), false);
  assert.throws(() => modelOptions({ options: [null] }), /不兼容/);
});
test('restored reasoning effort is sent only if the selected model still supports it', () => {
  const choice = selection({ ...data.active, reasoning_effort: '  HIGH ' });
  const current = modelOptions({
    ...data,
    options: [data.options[0], {
      ...data.options[1], supported_reasoning_efforts: ['low', 'HIGH', 'high', 'adaptive'],
    }],
  });
  assert.deepEqual(current.options[1].supported_reasoning_efforts, ['low', 'high']);
  assert.deepEqual(resolveTurnModel(current, choice, true), { ...data.active, reasoning_effort: 'high' });
  assert.deepEqual(resolveTurnModel(current, { ...choice!, reasoning_effort: 'xhigh' }, true), data.active);
  assert.deepEqual(resolveTurnModel(current, null, true), data.active);
  assert.deepEqual(resolveTurnModel(current, choice), data.active);
  assert.deepEqual(resolveTurnModel(modelOptions({
    ...data, options: [data.options[0], { ...data.options[1], declared_reasoning: false }],
  }), choice, true), data.active);
});
test('turn reasoning requires a supported server version, scoped to the connection that reported it', async () => {
  async function probe(version?: string) {
    let calls = 0;
    const api = new TutorClient(connection('http://10.0.2.2:8786', 'computer'), null, async url => {
      assert.equal(new URL(String(url)).pathname, '/api/system/update');
      calls++;
      return new Response(JSON.stringify({ current_version: version }), { status: version ? 200 : 404 });
    });
    const first = supportsTurnReasoning(api);
    const second = supportsTurnReasoning(api);
    assert.strictEqual(first, second);
    const result = await first;
    assert.equal(calls, 1);
    return result;
  }
  assert.equal(await probe('1.7.4'), true);
  assert.equal(await probe('1.7.2'), false);
  assert.equal(await probe(), false);
});
test('personal model endpoint falls back only on 404, never hides auth/server failures', async () => {
  for (const status of [404, 403, 503]) {
    const paths: string[] = [];
    const api = new TutorClient(connection('http://10.0.2.2:8786', 'computer'), null, async url => {
      paths.push(String(url));
      return new Response(JSON.stringify(paths.length > 1 ? data : {}), { status: paths.length > 1 ? 200 : status });
    });
    if (status === 404) { assert.deepEqual(await loadModelOptions(api), modelOptions(data)); assert.equal(paths.length, 2); }
    else { await assert.rejects(loadModelOptions(api)); assert.equal(paths.length, 1); }
  }
});
test('replacing a key sends a narrow mutation; blank preserves existing secret', () => {
  const source = { ref: { connection_id: 'own-provider' }, provider: { id: 'own-provider', name: 'Provider', api_key: '***' } };
  const edit = providerEdit(source, { name: 'Provider', base_url: 'https://api.example.com/v1', api_key: '' });
  assert.equal('api_key' in edit.fields, false);
  assert.equal(providerEdit(source, { name: 'Provider', base_url: '', api_key: 'fixture-key' }).fields.api_key, 'fixture-key');
  assert.throws(() => providerEdit(source, { name: 'Provider', base_url: '', api_key: '***' }), /掩码/);
});
test('authentication failure from provider discovery never reports successful connection', () => {
  assert.throws(() => discoveryModels({ status: 'auth_error', models: [] }), /无效/);
  assert.throws(() => discoveryModels({ status: 'unavailable' }), /手动/);
  assert.deepEqual(discoveryModels({ status: 'connected', models: [{ id: 'model-a' }] }), ['model-a']);
});
test('model-specific provider overrides determine which key is edited', () => {
  const catalog = { services: {}, connections: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } as Catalog;
  const profile = { id: 'p', name: 'P', provider_ref: { connection_id: 'a' } };
  const model = { id: 'm', name: 'M', model: 'model-m', provider_ref: { connection_id: 'b' } };
  assert.equal(sourceFor(catalog, 'llm', profile, model)?.provider.id, 'b');
  assert.equal(sourceFor(catalog, 'llm', profile)?.provider.id, 'a');
});
