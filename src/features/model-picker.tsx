import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { loadModelOptions, selectionKey, type ModelSelection, type ModelOptions } from '../lib/models';
import { Button, Heading, Page, Row, s } from '../ui';
import { FormModal } from './common';

export function ModelPicker({ value, onChange, onClose, title = '切换模型', sub = '用于下一条新提问，当前回复不受影响' }: { value: ModelSelection | null; onChange: (value: ModelSelection | null) => void; onClose: () => void; title?: string; sub?: string }) {
  const { api } = useAuth();
  const [data, setData] = useState<ModelOptions | null>(null);
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
  const choose = (v: ModelSelection | null) => { onChange(v); onClose(); };
  return <FormModal onClose={onClose}><Page>
    <Heading title={title} sub={sub} right={<Button title="关闭" secondary onPress={onClose} />} />
    <Row title="跟随服务默认模型" detail={data?.options.find(m => selectionKey(m) === selectionKey(data.active))?.model || '使用服务器当前默认设置'}
      icon={!value ? 'checkmark-circle' : 'ellipse-outline'} onPress={() => choose(null)} />
    {loading ? <Text style={s.muted}>正在加载模型…</Text> : null}
    {error ? <View style={s.notice}><Text style={s.text}>{error}</Text><Button title="重新加载" onPress={() => { setLoading(true); setError(''); setRetry(n => n + 1); }} /></View> : null}
    {data?.options.map(m => <Row key={selectionKey(m)} title={m.model} detail={`${m.profile_name || m.provider}${m.is_active_default ? ' · 默认' : ''}`}
      icon={selectionKey(m) === selectionKey(value) ? 'checkmark-circle' : 'ellipse-outline'} onPress={() => choose({ profile_id: m.profile_id, model_id: m.model_id })} />)}
    {!loading && !error && !data?.options.length ? <Text style={s.muted}>当前账号没有可用模型，请在模型与密钥中检查配置或授权。</Text> : null}
    <View style={{ marginTop: 20 }}><Button title="管理模型与 API Key" secondary onPress={() => { onClose(); router.push('/models'); }} /></View>
  </Page></FormModal>;
}
