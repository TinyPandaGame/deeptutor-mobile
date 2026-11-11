import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { existingProviderModels, importModels, providerRefKey } from '../lib/model-discovery';
import { managedProvider, providerSources, type Catalog, type ProviderSource, type Service } from '../lib/models';
import { Button, C, Field, Heading, Page, s } from '../ui';
import { Chips, FormModal, useAction } from './common';
import { DiscoveryStatus, ModelChoices, useModelDiscovery } from './model-discovery';

export function ModelImport({ catalog, service, onSaved, onClose }: {
  catalog: Catalog; service: Service; onSaved: () => Promise<void>; onClose: () => void;
}) {
  const sources = providerSources(catalog).filter(p => !managedProvider(p.provider));
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState(false);
  return <FormModal onClose={() => { if (!busy) onClose(); }}><Page>
    <Heading title="批量添加模型" right={<Button title="关闭" secondary disabled={busy} onPress={onClose} />} />
    <Text style={s.label}>选择服务商</Text>
    <Chips value={String(chosen)} onChange={v => { if (!busy) setChosen(Number(v)); }} items={sources.map((p, i) => ({ value: String(i), label: p.provider.name }))} />
    {sources[chosen] && <ImportChoices key={providerRefKey(sources[chosen])} catalog={catalog} source={sources[chosen]} service={service} onSaved={onSaved} onClose={onClose} setBusy={setBusy} />}
  </Page></FormModal>;
}

function ImportChoices({ source, catalog, service, onSaved, onClose, setBusy }: {
  source: ProviderSource; catalog: Catalog; service: Service; onSaved: () => Promise<void>; onClose: () => void; setBusy: (v: boolean) => void;
}) {
  const { api } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [manual, setManual] = useState('');
  const action = useAction();
  const p = source.provider;
  const existing = existingProviderModels(catalog, source, service);
  const discovery = useModelDiscovery('/api/settings/test-provider', {
    ...source.ref, service, binding: p.binding || p.provider, base_url: p.base_url,
    api_format: p.api_format || 'auto', api_key: p.api_key ? '***' : '',
  }, service, true);
  return <View style={{ gap: 14 }}>
    <DiscoveryStatus value={discovery} />
    <ModelChoices models={discovery.models} selected={selected} existing={existing} onChange={setSelected} disabled={action.busy} />
    <Field label="手动添加模型 ID" value={manual} onChangeText={setManual} editable={!action.busy} autoCorrect={false} autoCapitalize="none" />
    <Button title="加入选择" secondary disabled={action.busy || !manual.trim()} onPress={() => {
      const id = manual.trim(); if (!existing.includes(id)) setSelected(v => [...new Set([...v, id])]); setManual('');
    }} />
    {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
    <Button title={`添加所选模型（${selected.length}）`} busy={action.busy} disabled={!selected.length} onPress={() => void action.run(async () => {
      if (!api) return;
      setBusy(true);
      try {
        try { await importModels(api, source, service, selected); }
        catch (error) { await onSaved(); throw error; }
        await onSaved(); onClose();
      } finally { setBusy(false); }
    })} />
    <Text style={s.muted}>已添加的模型会自动跳过。已有默认模型保持不变，首次配置使用服务端默认规则。</Text>
  </View>;
}
