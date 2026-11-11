import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { File } from 'expo-file-system';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useAuth } from '../lib/auth';
import { temporaryBytes } from '../lib/temporary-files';
import { SPEECH_RATES, SpeechRequest, speechPassage, speechRate, speechRateKey } from '../lib/speech';
import { Button, C, Field, Heading, Page, s } from '../ui';
import { Chips, FormModal, SmallAction } from './common';

export function ReadAloud({ text, conversation, disabled = false }: { text: string; conversation: string; disabled?: boolean }) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  if (!api || !text.trim()) return null;
  return <>
    <SmallAction title="选段朗读" icon="volume-medium-outline" disabled={disabled} onPress={() => setOpen(true)} />
    {open && <SpeechDialog key={`${api.scope}:${conversation}`} text={text} conversation={conversation} onClose={() => setOpen(false)} />}
  </>;
}

function SpeechDialog({ text, conversation, onClose }: { text: string; conversation: string; onClose: () => void }) {
  const { api } = useAuth();
  const request = useMemo(() => api ? new SpeechRequest(api) : null, [api]);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [spoken, setSpoken] = useState('');
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const uri = useRef('');
  const epoch = useRef(0);
  const currentRate = useRef(1);
  const rateEdited = useRef(false);
  const writes = useRef(Promise.resolve());
  const key = speechRateKey(api?.scope || '', conversation);
  const invalidate = useCallback(() => { ++epoch.current; }, []);
  const removeFile = useCallback(() => {
    if (uri.current) { try { new File(uri.current).delete(); } catch {} uri.current = ''; }
  }, []);
  const stop = useCallback(() => {
    invalidate(); request?.cancel(); player.pause(); player.replace(null);
    removeFile(); setBusy(false); setPrepared(false);
  }, [request, player, removeFile, invalidate]);
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(key).then(value => {
      if (active && !rateEdited.current) {
        currentRate.current = speechRate(value); setRate(currentRate.current);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [key]);
  useEffect(() => { player.setPlaybackRate(rate); }, [player, rate]);
  useEffect(() => {
    const unsubscribe = api?.onClose(() => { stop(); onClose(); });
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') stop(); });
    return () => { unsubscribe?.(); sub.remove(); invalidate(); request?.cancel(); try { player.pause(); } catch {} removeFile(); };
    // This dialog is keyed by account, workspace and conversation; close callbacks need not restart audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, request, player, stop, removeFile, invalidate]);
  async function play(selected: boolean) {
    stop(); setError('');
    const run = epoch.current;
    try {
      const passage = speechPassage(text, selected ? range : undefined);
      setBusy(true); setSpoken(passage);
      const audio = await request?.generate(passage);
      if (!audio || !api || run !== epoch.current) return;
      uri.current = temporaryBytes(api, audio.bytes, `speech.${audio.extension}`);
      player.replace({ uri: uri.current }); player.setPlaybackRate(currentRate.current); player.play(); setPrepared(true);
    } catch (e) { if (run === epoch.current) setError((e as Error).message); }
    finally { if (run === epoch.current) setBusy(false); }
  }
  return <FormModal onClose={() => { stop(); onClose(); }}><Page>
    <Heading title="选段朗读" sub="使用当前服务器配置的语音服务" right={<Button title="关闭" secondary onPress={() => { stop(); onClose(); }} />} />
    <Text style={s.muted}>长按下方文字选择想听的段落，也可以朗读全文。选择不会修改原文。</Text>
    <Field label="原文" value={text} multiline showSoftInputOnFocus={false} selectTextOnFocus={false}
      onSelectionChange={e => setRange(e.nativeEvent.selection)} style={{ minHeight: 180, maxHeight: 340 }} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Button title="朗读选中段落" icon="volume-medium-outline" disabled={busy || range.end <= range.start} onPress={() => void play(true)} />
      <Button title="朗读全文" secondary disabled={busy} onPress={() => void play(false)} />
      {(busy || prepared) && <Button title="停止" secondary onPress={stop} />}
    </View>
    {busy && <Text style={s.muted}>正在生成语音，可随时停止…</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{error}</Text>}
    {prepared && <Button title={status.playing ? '暂停' : '继续播放'} secondary onPress={() => {
      if (status.playing) player.pause();
      else if (status.didJustFinish || status.duration > 0 && status.currentTime >= status.duration) {
        const run = epoch.current;
        void player.seekTo(0).then(() => { if (run === epoch.current) player.play(); }).catch(() => {});
      }
      else player.play();
    }} />}
    <Text style={s.label}>朗读速度</Text>
    <Chips value={String(rate)} items={SPEECH_RATES.map(v => ({ value: String(v), label: `${v} 倍` }))} onChange={value => {
      rateEdited.current = true; const next = speechRate(value); currentRate.current = next; setRate(next);
      writes.current = writes.current.catch(() => {}).then(() => SecureStore.setItemAsync(key, String(next)));
      void writes.current.catch(() => {});
    }} />
    {!!spoken && <Text style={s.muted}>本次朗读 {spoken.length} 字；速度会按当前账号和对话保存。</Text>}
  </Page></FormModal>;
}
