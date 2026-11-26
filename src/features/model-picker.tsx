import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { loadModelOptions, selectedModel, selectionKey, supportsTurnReasoning, type ModelSelection, type ModelOptions } from '../lib/models';
import { reasoningEffort, reasoningLabel, reasoningLevels } from '../lib/reasoning-effort';
import { Button, Heading, Page, Row, Section, s } from '../ui';
import { Chips, FormModal } from './common';

export function ModelPicker({ value, onChange, onClose, allowReasoning = false, title = '切换模型', sub = '用于下一条新提问，当前回复不受影响' }: { value: ModelSelection | null; onChange: (value: ModelSelection | null) => void; onClose: () => void; allowReasoning?: boolean; title?: string; sub?: string }) {
  const { api } = useAuth();
  const [data, setData] = useState<ModelOptions | null>(null);
  const [draft, setDraft] = useState(value);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    if (api) void loadModelOptions(api).then(v => { if (current) setData(v); }).catch(() => {
      if (current) setError('暂时无法读取模型，请重试。');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, retry]);
  useEffect(() => {
    if (!api || !allowReasoning) return;
    let active = true;
    void supportsTurnReasoning(api).then(supported => { if (active) setReasoningEnabled(supported); });
    return () => { active = false; };
  }, [api, allowReasoning, retry]);
  const choice = allowReasoning ? draft : value;
  const option = selectedModel(data, choice) || (!choice ? data?.options[0] : undefined);
  const levels = allowReasoning && reasoningEnabled ? reasoningLevels(option) : [];
  const chosenEffort = choice?.reasoning_effort;
  const visibleEffort = chosenEffort && levels.includes(chosenEffort) ? chosenEffort : '';
  const choose = (v: ModelSelection | null) => {
    if (allowReasoning) setDraft(current => selectionKey(current) === selectionKey(v) ? current : v);
    else { onChange(v); onClose(); }
  };
  return <FormModal onClose={onClose}><Page>
    <Heading title={title} sub={sub} right={allowReasoning
      ? <Button title="完成" onPress={() => { onChange(draft); onClose(); }} />
      : <Button title="关闭" secondary onPress={onClose} />} />
    {option && levels.length > 0 ? <>
      <Section title="推理强度" />
      <Chips value={visibleEffort} items={[{ value: '', label: '跟随模型' }, ...levels.map(level => ({ value: level, label: reasoningLabel(level) }))]} onChange={raw => {
        const effort = reasoningEffort(raw);
        if (!effort) {
          if (draft) setDraft({ profile_id: draft.profile_id, model_id: draft.model_id });
        } else {
          setDraft({ profile_id: option.profile_id, model_id: option.model_id, reasoning_effort: effort });
        }
      }} />
    </> : null}
    <Row title="跟随服务默认模型" detail={data?.options.find(m => selectionKey(m) === selectionKey(data.active))?.model || '使用服务器当前默认设置'}
      icon={!choice ? 'checkmark-circle' : 'ellipse-outline'} onPress={() => choose(null)} />
    {loading ? <Text style={s.muted}>正在加载模型…</Text> : null}
    {error ? <View style={s.notice}><Text style={s.text}>{error}</Text><Button title="重新加载" onPress={() => { setLoading(true); setError(''); setRetry(n => n + 1); }} /></View> : null}
    {data?.options.map(m => <Row key={selectionKey(m)} title={m.model} detail={`${m.profile_name || m.provider}${m.is_active_default ? ' · 默认' : ''}`}
      icon={selectionKey(m) === selectionKey(choice) ? 'checkmark-circle' : 'ellipse-outline'} onPress={() => choose({ profile_id: m.profile_id, model_id: m.model_id })} />)}
    {!loading && !error && !data?.options.length ? <Text style={s.muted}>当前账号没有可用模型，请在模型与密钥中检查配置或授权。</Text> : null}
    <View style={{ marginTop: 20 }}><Button title="管理模型与 API Key" secondary onPress={() => { onClose(); router.push('/models'); }} /></View>
  </Page></FormModal>;
}
