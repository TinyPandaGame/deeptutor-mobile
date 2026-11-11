import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, TutorClient } from '../src/lib/client.ts';
import { connection } from '../src/lib/connection.ts';
import { SpeechRequest, speechPassage, speechRate, speechRateKey, speechExtension } from '../src/lib/speech.ts';
import { ModelDiscovery, importModelEdits, importModels, existingProviderModels, type DiscoveryState } from '../src/lib/model-discovery.ts';
import { discoveryModels, type Catalog, type ModelOptions, type ProviderSource } from '../src/lib/models.ts';
import { masteryStart } from '../src/lib/mastery-start.ts';

function client(fetcher: typeof fetch) {
  const api = new TutorClient(connection('https://learning.example.com', 'server'), null, fetcher);
  api.user = { user_id: 'alice', username: 'alice', role: 'admin' }; api.token = 'fixture-token'; api.workspaceId = 'math';
  return api;
}
const status = () => Response.json({ enabled: true, authenticated: true, user_id: 'alice' });
const source: ProviderSource = { ref: { connection_id: 'provider-a' }, provider: { id: 'provider-a', name: 'A', provider: 'custom', base_url: 'https://api.example.com/v1', api_key: '***', api_format: 'auto' } };
const catalog = () => ({ connections: [source.provider], services: { llm: { profiles: [{ id: 'p', name: 'A', provider_ref: source.ref, models: [{ id: 'm', name: 'Existing', model: 'existing' }] }], active_profile_id: 'p', active_model_id: 'm' } } } as Catalog);
const pending = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('speech selection preserves Chinese, percentages and degrees; rates are scoped per service/account/conversation', () => {
  const text = '第一段：50%。\n第二段：30°。';
  assert.equal(speechPassage(text, { start: 9, end: text.length }), '第二段：30°。');
  assert.equal(speechPassage('  全文\n '), '全文');
  for (const range of [{ start: -1, end: 2 }, { start: 2, end: 2 }, { start: 0, end: 99 }]) assert.throws(() => speechPassage(text, range));
  assert.equal(speechRate('1.5'), 1.5); assert.equal(speechRate(99), 1);
  assert.notEqual(speechRateKey('service:a:user:1', 'chat'), speechRateKey('service:a:user:2', 'chat'));
  assert.notEqual(speechRateKey('service:a:user:1', 'chat'), speechRateKey('service:b:user:1', 'chat'));
  assert.notEqual(speechRateKey('account', 'one'), speechRateKey('account', 'two'));
  assert.match(speechRateKey('https://a:443/工作区', '中文'), /^[A-Za-z0-9._-]+$/);
});
test('speech uses authenticated same-origin binary API and current workspace, without provider overrides', async () => {
  let sent = 0;
  const api = client(async (url, init) => {
    if (String(url).endsWith('/api/auth/status')) return status();
    sent++;
    assert.equal(String(url), 'https://learning.example.com/api/voice/tts');
    assert.deepEqual(JSON.parse(String(init?.body)), { text: '50% 和 30°' });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token');
    assert.equal(new Headers(init?.headers).get('X-DeepTutor-Workspace'), 'math');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/wav' } });
  });
  const result = await new SpeechRequest(api).generate('50% 和 30°');
  assert.equal(result?.extension, 'wav'); assert.equal(result?.bytes.byteLength, 3); assert.equal(sent, 1);
  api.close(); await assert.rejects(new SpeechRequest(api).generate('a'), /切换/);
});
test('cancelled speech and stale failures never deliver audio to a later account or request', async () => {
  const first = pending<{ bytes: ArrayBuffer; contentType: string }>();
  let signal: AbortSignal | undefined;
  const speech = new SpeechRequest({ assertOpen() {}, downloadWithType: async (_path, init) => { signal = init?.signal as AbortSignal; return first.promise; } });
  const result = speech.generate('a'); speech.cancel(); assert.equal(signal?.aborted, true);
  first.resolve({ bytes: new ArrayBuffer(3), contentType: 'audio/wav' }); assert.equal(await result, null);
  const late = pending<{ bytes: ArrayBuffer; contentType: string }>();
  const failing = new SpeechRequest({ assertOpen() {}, downloadWithType: () => late.promise });
  const cancelled = failing.generate('a'); failing.cancel(); late.reject(new Error('stale')); assert.equal(await cancelled, null);
});
test('speech rejects empty/oversized text, non-audio bodies and provider setup errors', async () => {
  let calls = 0;
  const request = new SpeechRequest({ assertOpen() {}, downloadWithType: async () => { calls++; throw new ApiError('private upstream detail', 400); } });
  await assert.rejects(request.generate(' '), /没有/); await assert.rejects(request.generate('a'.repeat(12001)), /12000/); assert.equal(calls, 0);
  await assert.rejects(request.generate('a'), /配置语音/); assert.equal(calls, 1);
  assert.equal(speechExtension('Audio/Wav; charset=binary'), 'wav'); assert.throws(() => speechExtension('application/json'), /音频/);
});
test('discovery filters service capabilities, trims IDs, keeps unclassified models and deduplicates', () => {
  const models = [{ id: ' chat ', services: ['llm'] }, { id: 'chat', services: ['llm'] }, { id: 'voice', services: ['tts'] }, { id: 'unknown' }];
  assert.deepEqual(discoveryModels({ status: 'connected', models }, 'task'), ['chat', 'unknown']);
  assert.deepEqual(discoveryModels({ status: 'connected', models }, 'tts'), ['voice', 'unknown']);
});
test('credential changes abort previous discovery and discard late results and errors', async () => {
  const first = pending<unknown>(), next = pending<unknown>(); const states: DiscoveryState[] = []; let call = 0; let oldSignal: AbortSignal | undefined;
  const runner = new ModelDiscovery({ request: async <T,>(_path: string, init?: RequestInit) => { if (call++ === 0) { oldSignal = init?.signal as AbortSignal; return first.promise as Promise<T>; } return next.promise as Promise<T>; } }, v => states.push(v));
  const a = runner.run('/discover', { api_key: 'fixture-a' });
  const b = runner.run('/discover', { api_key: 'fixture-b' }); assert.equal(oldSignal?.aborted, true);
  next.resolve({ status: 'connected', models: [{ id: 'new' }] }); await b;
  first.reject(new Error('old key rejected')); await a;
  assert.deepEqual(states.at(-1)?.models, ['new']); assert.equal(states.at(-1)?.error, '');
  runner.reset(); assert.deepEqual(states.at(-1)?.models, []);
});
test('bulk model import skips duplicates within a provider/service and never copies secrets', () => {
  const data = catalog(); assert.deepEqual(existingProviderModels(data, source, 'llm'), ['existing']);
  const edits = importModelEdits(data, source, 'llm', ['existing', ' new ', 'new', '']); assert.equal(edits.length, 1);
  assert.equal(edits[0].model.model, 'new'); assert.equal(JSON.stringify(edits).includes('api_key'), false);
  assert.equal(importModelEdits(data, source, 'tts', ['existing']).length, 1);
  assert.throws(() => importModelEdits(data, { ...source, provider: { ...source.provider, read_only: true } }, 'llm', ['new']), /管理/);
});
test('bulk partial failure retries only absent models after reading the live registry again', async () => {
  const data = catalog(); let loseReply = true; const saved: string[] = [];
  const api = client(async (url, init) => {
    if (String(url).endsWith('/api/auth/status')) return status();
    if (String(url).endsWith('/api/settings')) return Response.json({ catalog: data });
    const edit = JSON.parse(String(init?.body)); saved.push(edit.model.model);
    data.services.llm.profiles.push({ id: edit.profile_id, name: 'A', models: [edit.model], provider_ref: source.ref });
    if (loseReply) { loseReply = false; throw Error('connection lost after commit'); }
    return Response.json({ catalog: data });
  });
  await assert.rejects(importModels(api, source, 'llm', ['one', 'two']), /自动跳过/);
  assert.deepEqual(saved, ['one']);
  assert.equal(await importModels(api, source, 'llm', ['one', 'two']), 1);
  assert.deepEqual(saved, ['one', 'two']);
});
test('bulk import rejects provider removal or endpoint change before mutation', async () => {
  const data = catalog(); data.connections = [];
  const api = client(async url => String(url).endsWith('/api/auth/status') ? status() : Response.json({ catalog: data }));
  await assert.rejects(importModels(api, source, 'llm', ['a']), /配置已改变/);
  data.connections = [{ ...source.provider, base_url: 'https://changed.example.com' }];
  await assert.rejects(importModels(api, source, 'llm', ['a']), /配置已改变/);
});
test('mastery resolves the chosen model before draft creation; removed choices fail instead of falling back', async () => {
  const options: ModelOptions = { active: { profile_id: 'p', model_id: 'a' }, options: ['a', 'b'].map(model_id => ({ profile_id: 'p', model_id, model: model_id, model_name: model_id, profile_name: 'P', provider: 'custom', is_active_default: model_id === 'a' })) };
  const api = client(async url => String(url).endsWith('/api/auth/status') ? status() : Response.json(options));
  const choice = { profile_id: 'p', model_id: 'b' };
  assert.deepEqual(await masteryStart(api, 'goal', 'outline', choice), { capability: 'mastery_path', mastery_path_id: 'goal', mastery_session_mode: 'outline', llm_selection: choice });
  assert.deepEqual((await masteryStart(api, 'goal', 'review', null)).llm_selection, options.active);
  await assert.rejects(masteryStart(api, 'goal', 'study', { profile_id: 'p', model_id: 'removed' }), /不可用/);
});
