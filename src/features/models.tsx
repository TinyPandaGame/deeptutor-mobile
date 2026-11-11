import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { useResource } from '../lib/resources';
import { Button, C, Field, Heading, Page, Row, Section, s } from '../ui';
import { Chips, Editor, FormModal, ResourceState, SmallAction, useAction } from './common';
import { PersonalModels } from './personal-models';
import { ModelImport } from './model-import';
import { DiscoveryStatus, useModelDiscovery } from './model-discovery';
import { applyModelEdit, discoveryModels, managedProvider, modelEdit, providerEdit, providerSources, services, sourceFor,
  type Catalog, type Model, type ModelOptions, type ModelSettings, type Provider, type ProviderChoice, type ProviderSource, type Service } from '../lib/models';

function ProviderEditor({ source, choices, service, onClose, onSaved }: {
  source: ProviderSource; choices: ProviderChoice[]; service: Service; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { api } = useAuth();
  const p = source.provider;
  const [name, setName] = useState(p.name);
  const [binding, setBinding] = useState(p.provider || p.binding || choices[0]?.value || 'custom');
  const [base, setBase] = useState(String(p.base_url || ''));
  const [format, setFormat] = useState(String(p.api_format || 'auto'));
  const [key, setKey] = useState('');
  const action = useAction();
  const existing = !!p.id;
  const mayReuseKey = !!p.api_key && base.trim() === String(p.base_url || '').trim();
  const discovery = useModelDiscovery('/api/settings/test-provider', {
    service, binding, base_url: base.trim(), api_format: format, api_key: key.trim() || (mayReuseKey ? '***' : ''),
    ...(source.ref.connection_id ? { connection_id: source.ref.connection_id } : { profile_id: source.ref.profile_id }),
  }, service, !!base.trim() && (!!key.trim() || mayReuseKey) && !action.busy);
  const fields = () => ({ name, base_url: base, api_format: format, api_key: key, ...(!existing ? { provider: binding } : {}) });
  return <FormModal onClose={onClose}><Page>
    <Heading title={existing ? '服务商与 API Key' : '添加服务商'} right={<Button title="取消" secondary disabled={action.busy} onPress={onClose} />} />
    <View style={{ gap: 16 }}>
      <Field label="显示名称" value={name} onChangeText={setName} editable={!action.busy} />
      {!existing ? <><Text style={s.label}>服务商</Text><Chips value={binding} items={choices.map(v => ({ value: v.value, label: v.label.replace('Custom (OpenAI API)', '自定义 OpenAI 接口').replace('Custom (Anthropic API)', '自定义 Anthropic 接口') }))}
        onChange={v => { const chosen = choices.find(x => x.value === v); setKey(''); setBinding(v); setBase(chosen?.base_url || ''); setFormat(chosen?.default_api_format || 'auto'); if (!name) setName(chosen?.label || v); }} /></> : null}
      <Field label="API 地址" value={base} autoCapitalize="none" autoCorrect={false} onChangeText={v => { setBase(v); setKey(''); }} editable={!action.busy} placeholder="https://…" />
      <Text style={s.label}>接口格式</Text>
      <Chips value={format} onChange={setFormat} items={[{ value: 'auto', label: '自动' }, { value: 'openai_chat', label: 'OpenAI 对话' }, { value: 'openai_responses', label: 'OpenAI Responses' }, { value: 'anthropic', label: 'Anthropic' }]} />
      <Field label={p.api_key ? '替换 API Key（已配置）' : 'API Key'} value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={!action.busy} placeholder={p.api_key ? '留空保留原密钥' : '输入服务商提供的密钥'} />
      <Text style={s.muted}>密钥只提交给当前连接的 DeepTutor 服务，不保存到手机配置。留空不会清除原密钥。共享服务商的密钥变更会影响使用它的其他模型和账号。</Text>
      {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
      <DiscoveryStatus value={discovery} />
      <Button title="保存并生效" busy={action.busy} onPress={() => void action.run(async () => {
        if (!api) return;
        if (p.api_key && !mayReuseKey && !key.trim()) throw Error('更换 API 地址后，请重新填写这个地址对应的密钥。');
        await applyModelEdit(api, providerEdit(source, fields())); setKey(''); await onSaved(); onClose();
      })} />
    </View>
  </Page></FormModal>;
}

function ModelEditor({ service, catalog, profile, model, onClose, onSaved }: {
  service: Service; catalog: Catalog; profile?: Provider; model?: Model; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { api } = useAuth();
  const sources = providerSources(catalog).filter(p => !managedProvider(p.provider));
  const [found, setFound] = useState<{ source: string; models: string[] } | null>(null);
  const discovery = useAction();
  const existing = profile && sourceFor(catalog, service, profile, model);
  const choices = sources.map((v, i) => ({ value: String(i), label: v.provider.name || v.provider.provider || v.provider.id }));
  const sourceIndex = Math.max(0, sources.findIndex(v => JSON.stringify(v.ref) === JSON.stringify(existing?.ref)));
  return <Editor title={model ? '编辑模型' : '添加模型'} onClose={onClose}
    beforeFields={(values, update) => service === 'llm' || service === 'task' ? <View style={{ gap: 10 }}>
      <Button title="从所选服务商获取模型" secondary busy={discovery.busy} onPress={() => void discovery.run(async () => {
        if (!api) return;
        const source = sources[Number(values.source)]; if (!source) throw Error('请先选择服务商。');
        const p = source.provider;
        const result = await api.json<{ status: string; models: { id: string }[] }>('/api/settings/test-provider', {
          service, ...source.ref, binding: p.binding || p.provider, base_url: p.base_url,
          api_format: p.api_format || 'auto', api_key: p.api_key ? '***' : '',
        });
        setFound({ source: values.source, models: discoveryModels(result, service) });
      })} />
      {!!discovery.error && <Text style={{ color: C.danger }}>{discovery.error}</Text>}
      {found && found.source === values.source && found.models.map(id => <Row key={id} title={id} icon={values.model === id ? 'checkmark-circle' : 'ellipse-outline'} onPress={() => update({ model: id, name: id })} />)}
    </View> : null}
    fields={[
      { key: 'source', label: '服务商', value: String(sourceIndex), required: true, options: choices },
      { key: 'name', label: '显示名称', value: model?.name || '' },
      { key: 'model', label: '模型 ID', value: model?.model || '', required: true },
      ...(service === 'llm' || service === 'task' ? [{ key: 'context_window', label: '上下文长度（选填）', value: String(model?.context_window || ''), number: true }] : []),
      ...(service === 'embedding' ? [{ key: 'dimension', label: '向量维度（选填）', value: String(model?.dimension || ''), number: true }] : []),
      ...(service === 'tts' ? [{ key: 'voice', label: '声音 ID（选填）', value: String(model?.voice || '') }] : []),
      ...(service === 'stt' ? [{ key: 'language', label: '识别语言（选填）', value: String(model?.language || '') }] : []),
    ]} onSave={async v => {
      if (!api) return;
      const source = sources[Number(v.source)];
      if (!source) throw Error('请先添加可用的服务商。');
      const target = profile || { id: `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: source.provider.name };
      const ref = { ...source.ref, binding: source.provider.binding || source.provider.provider, default_base_url: String(source.provider.base_url || '') };
      await applyModelEdit(api, modelEdit(service, target, model, v, ref)); await onSaved(); onClose();
    }} />;
}

export function Models() {
  const { api, user } = useAuth();
  const isAdmin = api?.mode === 'anonymous' || user?.role === 'admin';
  const settings = useResource<ModelSettings>(isAdmin ? '/api/settings' : null);
  const available = useResource<ModelOptions>('/api/settings/llm-options');
  const [service, setService] = useState<Service>('llm');
  const [editingProvider, setEditingProvider] = useState<ProviderSource | null>(null);
  const [editingModel, setEditingModel] = useState<{ profile?: Provider; model?: Model } | null>(null);
  const [importing, setImporting] = useState(false);
  const [taskChoice, setTaskChoice] = useState<string | null>(null);
  const action = useAction();
  const catalog = settings.data?.catalog;
  const bucket = catalog?.services[service];
  const reload = async () => { await Promise.all([settings.reload(), available.reload()]); };
  const change = (edit: unknown, done?: () => void) => action.run(async () => { if (api) { await applyModelEdit(api, edit); await reload(); done?.(); } });
  const providers = catalog ? providerSources(catalog) : [];
  const providerChoices = (settings.data?.providers?.[service] || settings.data?.providers?.llm || [])
    .filter(p => p.status !== 'legacy' && p.status !== 'deprecated' && !String(p.auth_mode).includes('oauth') && !/codex|copilot|codebuddy/.test(p.value));
  const confirmDelete = (title: string, edit: unknown) => Alert.alert(title, '会修改当前服务器的配置。正在使用的模型或服务商可能无法删除。', [
    { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void change(edit) },
  ]);
  return <Page>
    <Heading title="模型与密钥" sub="管理当前服务的模型和 API Key" back />
    {!isAdmin ? <PersonalModels /> : <>
      <ResourceState resource={settings} />
      {catalog ? <>
        <Chips value={service} onChange={v => setService(v as Service)} items={Object.entries(services).map(([value, label]) => ({ value, label }))} />
        {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
        {service === 'task' ? <View style={[s.card, { gap: 12 }]}>
          <Text style={s.rowTitle}>后台任务的默认选择</Text>
          <Text style={s.text}>{bucket?.mode === 'reference' ? '使用指定对话模型' : bucket?.mode === 'profiles' ? '使用独立任务模型' : '跟随当前对话模型'}</Text>
          <SmallAction title="跟随对话模型" onPress={() => void change({ kind: 'task_choice', task: { mode: 'inherit' } })} />
          <SmallAction title="指定任务模型" onPress={() => setTaskChoice('')} />
          {(settings.data?.task_kinds || []).map(t => <Row key={t.id} title={({ session_title: '对话标题', chat_starters: '提问建议', chat_ask_hint: '对话提示', mastery_goal_name: '学习目标名称', mastery_ask_hint: '学习提示', reading_ask_hint: '阅读提示', reading_vocabulary: '阅读生词', reading_translation: '阅读翻译', reading_guidance: '阅读指导', reading_quiz: '阅读测验' } as Record<string, string>)[t.id] || '其他后台任务'} detail={bucket?.overrides?.[t.id] ? '已单独指定' : '跟随任务默认设置'} icon="options-outline" onPress={() => setTaskChoice(t.id)} />)}
        </View> : null}
        <Section title="已配置的模型" />
        {!bucket?.profiles.some(p => p.models?.length || service === 'search') ? <Text style={s.muted}>还没有配置模型。先添加服务商，再填写模型 ID。</Text> : null}
        {(bucket?.profiles || []).flatMap(p => (service === 'search' ? [{ id: '', name: p.name, model: p.binding || '' } as Model] : p.models || []).map(m => {
          const source = sourceFor(catalog, service, p, m);
          const managed = managedProvider(p) || (!!source && managedProvider(source.provider));
          const active = bucket?.active_profile_id === p.id && (service === 'search' || bucket?.active_model_id === m.id);
          return <View key={`${p.id}:${m.id}`} style={[s.card, { gap: 10, marginBottom: 12 }]}>
            <Text style={s.rowTitle}>{m.model || m.name}{active ? ' · 默认' : ''}</Text>
            <Text style={s.muted}>{p.name}{managed ? ' · 账号授权管理' : ''}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
              {!active && <SmallAction title="设为默认" onPress={() => void change({ kind: 'default', service, profile_id: p.id, ...(m.id ? { model_id: m.id } : {}) })} />}
              {!managed && service !== 'search' && <SmallAction title="编辑模型" onPress={() => setEditingModel({ profile: p, model: m })} />}
              {source && !managed && <SmallAction title="更换 API Key" onPress={() => setEditingProvider(source)} />}
              {!managed && <SmallAction title="删除模型" onPress={() => confirmDelete('删除这个模型？', { kind: 'model', service, profile_id: p.id, model_id: m.id, delete: true })} />}
            </View>
          </View>;
        }))}
        {service !== 'search' && <Button title="添加模型" secondary disabled={!providers.some(p => !managedProvider(p.provider))} onPress={() => setEditingModel({})} />}
        {service !== 'search' && <Button title="批量添加模型" icon="list-outline" secondary disabled={!providers.some(p => !managedProvider(p.provider))} onPress={() => setImporting(true)} />}
        <Section title="服务商与密钥" />
        {providers.map(source => <View key={JSON.stringify(source.ref)} style={[s.card, { marginBottom: 12, gap: 10 }]}>
          <Text style={s.rowTitle}>{source.provider.name || source.provider.provider || source.provider.binding}</Text>
          <Text style={s.muted}>{managedProvider(source.provider) ? '使用服务端账号授权，无需填写 API Key' : source.provider.api_key ? 'API Key 已配置' : '未配置 API Key'}</Text>
          {!managedProvider(source.provider) && <View style={{ flexDirection: 'row', gap: 20 }}>
            <SmallAction title="编辑服务商 / API Key" onPress={() => setEditingProvider(source)} />
            <SmallAction title="删除服务商" onPress={() => confirmDelete('删除这个服务商？', { kind: 'provider', ref: source.ref, delete: true })} />
          </View>}
        </View>)}
        <Button title="添加服务商" onPress={() => setEditingProvider({ ref: { connection_id: `connection-${Date.now()}-${Math.random().toString(36).slice(2)}` }, provider: { id: '', name: '', base_url: providerChoices[0]?.base_url || '', provider: providerChoices[0]?.value || 'custom' } })} />
      </> : null}
    </>}
    {editingProvider && <ProviderEditor source={editingProvider} service={service} choices={providerChoices} onClose={() => setEditingProvider(null)} onSaved={reload} />}
    {editingModel && catalog && <ModelEditor {...editingModel} catalog={catalog} service={service} onClose={() => setEditingModel(null)} onSaved={reload} />}
    {importing && catalog && <ModelImport catalog={catalog} service={service} onSaved={reload} onClose={() => setImporting(false)} />}
    {taskChoice !== null && <FormModal onClose={() => setTaskChoice(null)}><Page><Heading title="选择任务模型" right={<Button title="取消" secondary onPress={() => setTaskChoice(null)} />} />
      <Row title={taskChoice ? '跟随任务默认设置' : '跟随当前对话模型'} icon="sync-outline" onPress={() => void change({ kind: 'task_choice', task: { mode: taskChoice ? 'global' : 'inherit', ...(taskChoice ? { task_kind: taskChoice } : {}) } }, () => setTaskChoice(null))} />
      {available.data?.options.map(m => <Row key={`${m.profile_id}:${m.model_id}`} title={m.model} detail={m.profile_name} icon="hardware-chip-outline" onPress={() => void change({ kind: 'task_choice', task: { mode: 'reference', selection: { profile_id: m.profile_id, model_id: m.model_id }, ...(taskChoice ? { task_kind: taskChoice } : {}) } }, () => setTaskChoice(null))} />)}
    </Page></FormModal>}
  </Page>;
}
