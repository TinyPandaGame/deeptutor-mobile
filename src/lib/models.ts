import { ApiError, type TutorClient } from './client.ts';

export type ModelSelection = { profile_id: string; model_id: string };
export type ModelOption = ModelSelection & { model: string; model_name: string; profile_name: string; provider: string; is_active_default: boolean; supports_vision?: boolean };
export type ModelOptions = { active: ModelSelection | null; options: ModelOption[] };
export const services = { llm: '对话模型', task: '后台任务', embedding: '知识库向量', search: '联网搜索', tts: '语音朗读', stt: '语音识别', imagegen: '图片生成', videogen: '视频生成' };
export type Service = keyof typeof services;
export type Ref = { connection_id?: string; service?: string; profile_id?: string; binding?: string; default_base_url?: string };
export type Model = { id: string; name: string; model: string; provider_ref?: Ref; [key: string]: unknown };
export type Provider = { id: string; name: string; provider?: string; binding?: string; base_url?: string; api_key?: string | string[]; api_format?: string; managed_by?: string; read_only?: boolean; owner_bound?: boolean; connection_id?: string; provider_ref?: Ref; models?: Model[]; [key: string]: unknown };
export type CatalogService = { profiles: Provider[]; active_profile_id?: string | null; active_model_id?: string | null; mode?: string; selection?: ModelSelection; overrides?: Record<string, { mode: string; selection?: ModelSelection }> };
export type Catalog = { services: Record<Service, CatalogService>; connections?: Provider[]; [key: string]: unknown };
export type ProviderChoice = { value: string; label: string; base_url?: string; auth_mode?: string; status?: string; default_api_format?: string; api_formats?: string[] };
export type ModelSettings = { catalog?: Catalog; providers?: Partial<Record<Service, ProviderChoice[]>>; task_kinds?: { id: string; group: string }[] };
export type ProviderSource = { ref: Ref; provider: Provider };
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function selection(v: unknown): ModelSelection | null {
  return obj(v) && typeof v.profile_id === 'string' && !!v.profile_id && typeof v.model_id === 'string' && !!v.model_id
    ? { profile_id: v.profile_id, model_id: v.model_id } : null;
}
export const selectionKey = (v: ModelSelection | null | undefined) => v ? JSON.stringify([v.profile_id, v.model_id]) : '';
export function modelOptions(value: unknown): ModelOptions {
  if (!obj(value) || !Array.isArray(value.options) || value.options.some(v => !selection(v) || !obj(v) || typeof v.model !== 'string'))
    throw Error('模型列表格式不兼容，请重新加载。');
  return { active: selection(value.active), options: value.options.map(v => ({ ...selection(v)!, model: v.model,
    model_name: String(v.model_name || v.model), profile_name: String(v.profile_name || ''), provider: String(v.provider || ''),
    is_active_default: v.is_active_default === true, supports_vision: typeof v.supports_vision === 'boolean' ? v.supports_vision : undefined })) };
}
export async function loadModelOptions(api: TutorClient) {
  try { return modelOptions(await api.request('/api/mobile/models/options')); }
  catch (e) { if (!(e instanceof ApiError) || e.status !== 404) throw e; }
  return modelOptions(await api.request('/api/settings/llm-options'));
}
export function resolveTurnModel(options: ModelOptions, value: ModelSelection | null): ModelSelection {
  const chosen = value || options.active || selection(options.options[0]);
  if (!chosen) throw Error('没有可用模型，请先添加 API Key 并选择模型。');
  assertModelAvailable(options, chosen);
  // A null selection makes upstream reuse the previous session model. Resolve
  // defaults to concrete IDs on every NEW turn so switching back really works.
  return { profile_id: chosen.profile_id, model_id: chosen.model_id };
}
export function discoveryModels(result: { status?: string; models?: { id: string; services?: string[] }[] }, service: Service = 'llm') {
  if (result.status !== 'connected') throw Error(({ auth_error: 'API Key 无效或没有访问权限。', timeout: '服务商连接超时，请重试。', unavailable: '服务商不支持自动获取模型，请手动填写模型 ID。', rate_limited: '请求过于频繁，请稍后重试。' } as Record<string, string>)[result.status || ''] || '连接检测未通过，请检查 API 地址和密钥。');
  const kind = service === 'task' ? 'llm' : service;
  return [...new Set((result.models || []).filter(m => typeof m.id === 'string' && m.id.trim()
    && (!m.services?.length || m.services.includes(kind))).map(m => m.id.trim()))];
}
export function selectedModel(options: ModelOptions | null, value: ModelSelection | null) {
  return options?.options.find(m => selectionKey(m) === selectionKey(value || options.active));
}
export function assertModelAvailable(options: ModelOptions, value: ModelSelection | null) {
  if (value && !selectedModel(options, value)) throw Error('所选模型已不可用或未授权，请重新选择模型。');
}
export const managedProvider = (p: Provider) => !!(p.managed_by || p.read_only || p.owner_bound);
export function providerSources(catalog: Catalog): ProviderSource[] {
  const result: ProviderSource[] = (catalog.connections || []).map(p => ({ ref: { connection_id: p.id }, provider: p }));
  for (const [service, bucket] of Object.entries(catalog.services)) {
    for (const profile of bucket.profiles || []) {
      if (!profile.connection_id && !profile.provider_ref) result.push({ ref: { service, profile_id: profile.id }, provider: profile });
    }
  }
  return result;
}
export function sourceFor(catalog: Catalog, service: Service, profile: Provider, model?: Model): ProviderSource | undefined {
  const ref = model?.provider_ref || profile.provider_ref || (profile.connection_id ? { connection_id: profile.connection_id } : { service, profile_id: profile.id });
  return providerSources(catalog).find(s => ref.connection_id ? s.ref.connection_id === ref.connection_id : s.ref.service === ref.service && s.ref.profile_id === ref.profile_id);
}
export function providerEdit(source: ProviderSource, fields: { name: string; provider?: string; base_url: string; api_format?: string; api_key?: string }) {
  if (managedProvider(source.provider)) throw Error('此服务商由账号授权管理，不能在 API Key 表单中修改。');
  if (!fields.name.trim()) throw Error('请填写服务商名称。');
  const url = fields.base_url.trim();
  if (url) {
    let parsed: URL; try { parsed = new URL(url); } catch { throw Error('请填写完整的 API 地址。'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
      throw Error('API 地址不能包含账号、密钥、查询参数或片段。');
  }
  const patch: Record<string, unknown> = { name: fields.name.trim(), base_url: url };
  if (fields.provider) patch.provider = fields.provider;
  if (fields.api_format) patch.api_format = fields.api_format;
  // Empty means unchanged. Never round-trip a displayed mask as a new secret.
  const key = fields.api_key?.trim();
  if (key) {
    if (/^[*•]+$/.test(key)) throw Error('请输入实际 API Key，不能提交掩码。');
    patch.api_key = key.includes('\n') ? key.split(/\r?\n/).map(x => x.trim()).filter(Boolean) : key;
  }
  return { kind: 'provider', ref: source.ref, fields: patch };
}
export function modelEdit(service: Service, profile: Provider, current: Model | undefined, values: Record<string, string>, ref: Ref) {
  if (managedProvider(profile)) throw Error('授权账号的模型由服务端管理。');
  if (!values.model?.trim()) throw Error('请填写模型 ID。');
  const model: Model = { ...current, id: current?.id || `model-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: values.name?.trim() || values.model.trim(), model: values.model.trim(), provider_ref: ref };
  // Keep unknown existing fields; only the explicitly editable fields change.
  for (const key of ['context_window', 'dimension', 'voice', 'language', 'reasoning_effort', 'size', 'quality'])
    if (key in values) model[key] = values[key].trim();
  for (const key of ['api_key', 'base_url', 'extra_headers', 'api_version']) delete model[key];
  return { kind: 'model', service, profile_id: profile.id, model_id: model.id, model };
}
export async function applyModelEdit(api: TutorClient, edit: unknown) {
  // Never replay a secret-bearing mutation or turn server/provider errors into UI text.
  const result = await api.json<{ catalog: Catalog }>('/api/settings/apply/registry', edit);
  if (!result.catalog?.services) throw Error('保存结果不兼容，请重新加载确认。');
  return result.catalog;
}
