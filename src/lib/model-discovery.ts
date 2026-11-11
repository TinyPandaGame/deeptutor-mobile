import type { TutorClient } from './client.ts';
import { applyModelEdit, discoveryModels, managedProvider, modelEdit, providerSources, sourceFor,
  type Catalog, type ModelSettings, type ProviderSource, type Service } from './models.ts';

export type DiscoveryState = { loading: boolean; models: string[]; error: string; connected: boolean };
export const EMPTY_DISCOVERY: DiscoveryState = { loading: false, models: [], error: '', connected: false };
/** Invalidate the old result immediately when credentials or the chosen service change. */
export class ModelDiscovery {
  private generation = 0;
  private controller?: AbortController;
  private api: Pick<TutorClient, 'request'>;
  private update: (value: DiscoveryState) => void;
  constructor(api: Pick<TutorClient, 'request'>, update: (value: DiscoveryState) => void) { this.api = api; this.update = update; }
  reset() { ++this.generation; this.controller?.abort(); this.update({ ...EMPTY_DISCOVERY }); }
  async run(path: string, payload: unknown, service: Service = 'llm') {
    this.reset();
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    this.update({ ...EMPTY_DISCOVERY, loading: true });
    try {
      const result = await this.api.request<Parameters<typeof discoveryModels>[0]>(path, {
        method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      });
      if (generation !== this.generation) return;
      this.update({ loading: false, connected: true, error: '', models: discoveryModels(result, service) });
    } catch (e) {
      if (generation === this.generation) this.update({ ...EMPTY_DISCOVERY, error: (e as Error).message });
    }
  }
}

export const providerRefKey = (source: ProviderSource) => JSON.stringify(source.ref.connection_id
  ? ['connection', source.ref.connection_id] : ['profile', source.ref.service, source.ref.profile_id]);
export function existingProviderModels(catalog: Catalog, source: ProviderSource, service: Service) {
  return (catalog.services[service]?.profiles || []).flatMap(p => (p.models || [])
    .filter(m => { const found = sourceFor(catalog, service, p, m); return found && providerRefKey(found) === providerRefKey(source); })
    .map(m => m.model));
}
export function importModelEdits(catalog: Catalog, source: ProviderSource, service: Service, ids: string[]) {
  if (managedProvider(source.provider)) throw Error('授权账号的模型由服务端管理。');
  if (service === 'search') throw Error('搜索服务不使用批量模型导入。');
  const existing = new Set(existingProviderModels(catalog, source, service));
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))].filter(id => !existing.has(id)).map(id => {
    const profile = { id: `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: source.provider.name };
    return modelEdit(service, profile, undefined, { name: id, model: id }, {
      ...source.ref, binding: source.provider.binding || source.provider.provider, default_base_url: source.provider.base_url || '',
    });
  });
}
export async function importModels(api: TutorClient, source: ProviderSource, service: Service, ids: string[]) {
  // Always read the live catalog before retrying a partial import, including lost responses.
  const current = await api.request<ModelSettings>('/api/settings');
  if (!current.catalog) throw Error('无法读取当前模型配置，请重新加载。');
  const live = providerSources(current.catalog).find(p => providerRefKey(p) === providerRefKey(source));
  if (!live || live.provider.base_url !== source.provider.base_url || live.provider.api_format !== source.provider.api_format
    || (live.provider.binding || live.provider.provider) !== (source.provider.binding || source.provider.provider))
    throw Error('服务商配置已改变，请重新打开并获取模型列表。');
  const edits = importModelEdits(current.catalog, live, service, ids);
  let saved = 0;
  for (const edit of edits) {
    try { await applyModelEdit(api, edit); saved++; }
    catch { throw Error(`已添加 ${saved} 个模型，其余未确认。请重新获取列表后重试，已保存模型会自动跳过。`); }
  }
  return saved;
}
