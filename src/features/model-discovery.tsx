import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { EMPTY_DISCOVERY, ModelDiscovery, type DiscoveryState } from '../lib/model-discovery';
import type { Service } from '../lib/models';
import { Button, C, Field, Row, s } from '../ui';

export function useModelDiscovery(path: string, payload: unknown, service: Service, enabled: boolean) {
  const { api } = useAuth();
  const [state, setState] = useState<DiscoveryState>(EMPTY_DISCOVERY);
  const runner = useMemo(() => api ? new ModelDiscovery(api, setState) : null, [api]);
  // Contains credentials only in component memory; never persisted or logged.
  const identity = JSON.stringify(payload);
  useEffect(() => {
    runner?.reset();
    const timer = enabled ? setTimeout(() => void runner?.run(path, JSON.parse(identity), service), 800) : null;
    return () => { if (timer) clearTimeout(timer); runner?.reset(); };
  }, [runner, path, identity, service, enabled]);
  return { ...state, enabled, refresh: () => { if (enabled) void runner?.run(path, JSON.parse(identity), service); } };
}

export function ModelChoices({ models, selected, existing = [], onChange, disabled = false }: {
  models: string[]; selected: string[]; existing?: string[]; onChange: (values: string[]) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const rows = [...new Set([...selected, ...models])].filter(id => id.toLowerCase().includes(query.trim().toLowerCase()));
  return <View style={{ gap: 10 }}>
    <Field label="筛选模型" value={query} onChangeText={setQuery} editable={!disabled} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Button compact secondary title="选择筛选结果" disabled={disabled || !rows.some(id => !existing.includes(id))}
        onPress={() => onChange([...new Set([...selected, ...rows.filter(id => !existing.includes(id))])])} />
      <Button compact secondary title="清空选择" disabled={disabled || !selected.length} onPress={() => onChange([])} />
    </View>
    {rows.map(id => <Row key={id} title={id} detail={existing.includes(id) ? '已添加' : undefined}
      icon={existing.includes(id) || selected.includes(id) ? 'checkbox' : 'square-outline'}
      onPress={() => { if (!disabled && !existing.includes(id)) onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]); }} />)}
    {!rows.length && <Text style={s.muted}>没有匹配的模型；也可以手动填写模型 ID。</Text>}
  </View>;
}
export function DiscoveryStatus({ value }: { value: ReturnType<typeof useModelDiscovery> }) {
  return <>
    <Button title={value.loading ? '正在获取模型…' : '重新获取模型'} secondary busy={value.loading} disabled={!value.enabled} onPress={value.refresh} />
    {!!value.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{value.error}</Text>}
    {value.connected && <Text style={s.muted}>连接成功，找到 {value.models.length} 个候选模型。列表不代表模型已获推理权限，请按服务商授权选择。</Text>}
  </>;
}
