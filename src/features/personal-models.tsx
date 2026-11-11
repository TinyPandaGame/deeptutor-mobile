import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { useResource } from '../lib/resources';
import { type ProviderChoice, type ModelOptions } from '../lib/models';
import { DiscoveryStatus, ModelChoices, useModelDiscovery } from './model-discovery';
import { Button, C, Field, Heading, Page, Row, Section, s } from '../ui';
import { Chips, FormModal, ResourceState, SmallAction, useAction } from './common';

type PersonalProfile = { id: string; name: string; binding: string; base_url: string; api_format: string; has_key: boolean; models: { id: string; model: string; name: string }[] };
type PersonalSettings = { profiles: PersonalProfile[]; providers: ProviderChoice[]; active: { profile_id: string; model_id: string } | null };
const providerName = (v: ProviderChoice) => v.label.replace('Custom (OpenAI API)', '自定义 OpenAI 接口').replace('Custom (Anthropic API)', '自定义 Anthropic 接口');

function PersonalEditor({ profile, choices, onClose, onSaved }: { profile?: PersonalProfile; choices: ProviderChoice[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { api } = useAuth();
  const first = choices.find(v => v.value === 'deepseek') || choices[0];
  const [binding, setBinding] = useState(profile?.binding || first?.value || 'custom');
  const [name, setName] = useState(profile?.name || (first ? providerName(first) : ''));
  const [base, setBase] = useState(profile?.base_url || first?.base_url || '');
  const [format, setFormat] = useState(profile?.api_format || 'auto');
  const [key, setKey] = useState('');
  const [models, setModels] = useState(profile?.models.map(m => m.model) || []);
  const [manual, setManual] = useState('');
  const [allProviders, setAllProviders] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const action = useAction();
  const chooseProvider = (v: string) => {
    if (action.busy) return;
    const choice = choices.find(c => c.value === v); setBinding(v); setName(choice ? providerName(choice) : v);
    setBase(choice?.base_url || ''); setFormat(choice?.default_api_format || 'auto'); setKey(''); setModels([]); setAllProviders(false);
  };
  const formats = choices.find(c => c.value === binding)?.api_formats || [];
  const payload = () => ({ ...(profile ? { id: profile.id } : {}), name: name.trim(), binding, base_url: base.trim(), api_format: format, ...(key.trim() ? { api_key: key.trim() } : {}) });
  const discovery = useModelDiscovery('/api/mobile/models/discover', payload(), 'llm',
    !!base.trim() && (!!key.trim() || !!profile?.has_key && base.trim() === profile.base_url && binding === profile.binding) && !action.busy);
  const resetPicks = () => setModels(profile && base.trim() === profile.base_url && binding === profile.binding ? profile.models.map(m => m.model) : []);
  return <FormModal onClose={onClose}><Page>
    <Heading title={profile ? '修改我的模型与密钥' : '添加我的 API Key'} right={<Button title="取消" secondary disabled={action.busy} onPress={onClose} />} />
    <View style={{ gap: 14 }}>
      <Text style={s.muted}>只影响当前账号。密钥提交给当前学习服务器保存，手机不保存密钥明文。</Text>
      <Text style={s.label}>服务商</Text>
      <Chips value={binding} items={choices.filter(v => ['deepseek', 'openai', 'anthropic', 'custom', 'gemini', binding].includes(v.value)).map(v => ({ value: v.value, label: providerName(v) }))} onChange={chooseProvider} />
      <SmallAction title="查看全部服务商" onPress={() => setAllProviders(true)} />
      <Field label="显示名称" value={name} onChangeText={setName} editable={!action.busy} />
      <Field label="API 地址" value={base} onChangeText={v => { setBase(v); setKey(''); setModels([]); }} autoCapitalize="none" autoCorrect={false} editable={!action.busy} />
      <Text style={s.label}>接口格式</Text>
      <Chips value={format} onChange={v => { if (!action.busy) { setFormat(v); resetPicks(); } }} items={[{ value: 'auto', label: '自动' }, { value: 'openai_chat', label: 'OpenAI 对话' }, { value: 'openai_responses', label: 'OpenAI Responses' }, { value: 'anthropic', label: 'Anthropic' }].filter(v => v.value === 'auto' || formats.includes(v.value))} />
      <Field label={profile?.has_key ? '替换 API Key' : 'API Key'} value={key} onChangeText={v => { setKey(v); resetPicks(); }} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={!action.busy} placeholder={profile?.has_key ? '留空保留已有密钥' : '输入服务商提供的密钥'} />
      {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
      <DiscoveryStatus value={discovery} />
      <Section title={`选用模型（${models.length}）`} />
      <ModelChoices models={discovery.models} selected={models} onChange={setModels} disabled={action.busy} />
      <Field label="手动添加模型 ID" value={manual} onChangeText={setManual} autoCapitalize="none" autoCorrect={false} editable={!action.busy} placeholder="自动获取不可用时，可填服务商给出的模型 ID" />
      <SmallAction title="添加这个模型" onPress={() => { const id = manual.trim(); if (!action.busy && id) { setModels(v => [...new Set([...v, id])]); setManual(''); } }} />
      <Button title="保存模型与密钥" busy={action.busy} onPress={() => void action.run(async () => {
        if (!api) return;
        if (!name.trim() || !base.trim()) throw Error('请填写显示名称和 API 地址。');
        if (!models.length) throw Error('请至少选择或手动添加一个模型。');
        await api.json('/api/mobile/models/profile', { ...payload(), models });
        setKey(''); await onSaved(); onClose();
      })} />
    </View>
    {allProviders && <FormModal onClose={() => setAllProviders(false)}><Page>
      <Heading title="选择服务商" right={<Button title="返回" secondary onPress={() => setAllProviders(false)} />} />
      <Field label="搜索服务商" value={providerSearch} onChangeText={setProviderSearch} />
      {choices.filter(v => `${v.value} ${v.label}`.toLowerCase().includes(providerSearch.toLowerCase())).map(v => <Row key={v.value} title={providerName(v)} icon="cloud-outline" onPress={() => chooseProvider(v.value)} />)}
    </Page></FormModal>}
  </Page></FormModal>;
}

export function PersonalModels() {
  const { api } = useAuth();
  const settings = useResource<PersonalSettings>('/api/mobile/models');
  const available = useResource<ModelOptions>('/api/settings/llm-options');
  const [editing, setEditing] = useState<{ profile?: PersonalProfile } | null>(null);
  const action = useAction();
  const reload = async () => { await settings.reload(); await available.reload(); };
  const missing = settings.errorStatus === 404;
  return <>
    <Text style={s.muted}>填写自己的 API Key 后获取模型，再到对话中切换使用。已有服务端分配的模型仍可使用。</Text>
    {missing ? <View style={s.notice}><Text style={s.text}>当前服务器尚未安装个人模型接口。安装后可在这里添加、替换自己的 API Key；现有模型切换不受影响。</Text><Button title="重新检查服务器" secondary onPress={() => void settings.reload()} /></View> : <ResourceState resource={settings} />}
    {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
    {settings.data && <>
      <Button title="添加 API Key / 服务商" onPress={() => setEditing({})} />
      <Section title="我的模型与密钥" />
      {!settings.data.profiles.length && <Text style={s.muted}>还没有个人配置。添加密钥后即可获取模型列表。</Text>}
      {settings.data.profiles.map(p => <View key={p.id} style={[s.card, { gap: 12, marginBottom: 12 }]}>
        <Text style={s.rowTitle}>{p.name}</Text><Text style={s.muted}>{p.has_key ? 'API Key 已保存' : '未配置 API Key'}</Text>
        <SmallAction title="更换 API Key / 编辑模型" onPress={() => setEditing({ profile: p })} />
        {p.models.map(m => <Row key={m.id} title={m.model} detail={settings.data?.active?.profile_id === p.id && settings.data.active.model_id === m.id ? '我的默认模型' : '点击设为我的默认模型'} icon="hardware-chip-outline" onPress={() => void action.run(async () => { await api?.json('/api/mobile/models/default', { profile_id: p.id, model_id: m.id }); await reload(); })} />)}
        <SmallAction title="删除这组个人配置" onPress={() => Alert.alert('删除个人模型与密钥？', '仅删除当前账号的这组配置，已有对话和学习资料保留。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void action.run(async () => { await api?.request(`/api/mobile/models/profile/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); await reload(); }) }])} />
      </View>)}
    </>}
    <Section title="当前可用模型" /><ResourceState resource={available} empty={!available.data?.options.length} />
    {available.data?.options.map(m => <View key={`${m.profile_id}:${m.model_id}`} style={[s.card, { marginBottom: 10 }]}><Text style={s.rowTitle}>{m.model}</Text><Text style={s.muted}>{m.profile_name || m.provider} · 在对话输入区切换</Text></View>)}
    {editing && settings.data && <PersonalEditor {...editing} choices={settings.data.providers} onClose={() => setEditing(null)} onSaved={reload} />}
  </>;
}
