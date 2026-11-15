import { useMemo, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clipboardText } from '../lib/copy-content';
import { copyText } from '../lib/native-clipboard';
import { useContentAction } from '../lib/use-content-action';
import { Button, C, Heading, s } from '../ui';

export function TextCopyActions({ text, disabled = false }: { text: string; disabled?: boolean }) {
  const plain = useMemo(() => disabled ? '' : clipboardText(text), [text, disabled]);
  const action = useContentAction(text);
  const [selection, setSelection] = useState<{ api: typeof action.api; text: string } | null>(null);
  const selecting = selection !== null && selection.api === action.api && selection.text === text;
  const copy = () => void action.run(async active => { active(); await copyText(plain); }, '已复制，可以到其他应用粘贴');
  if (!plain || disabled) return null;
  return <>
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button title="复制全文" icon="copy-outline" compact secondary busy={action.busy} onPress={copy} />
        <Button title="选择文字" icon="text-outline" compact secondary onPress={() => setSelection({ api: action.api, text })} />
      </View>
      {!!action.notice && <Text accessibilityLiveRegion="polite" style={s.muted}>{action.notice}</Text>}
      {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
    </View>
    {selecting && <Modal animationType="slide" onRequestClose={() => setSelection(null)}>
      <SafeAreaView style={[s.page, { padding: 18, gap: 14 }]}>
        <Heading title="选择文字" right={<Button title="关闭" secondary compact onPress={() => setSelection(null)} />} />
        <Text style={s.muted}>长按文字，拖动两端选择范围，再点系统菜单中的“复制”。</Text>
        <Button title="复制全文" icon="copy-outline" secondary busy={action.busy} onPress={copy} />
        {!!action.notice && <Text accessibilityLiveRegion="polite" style={s.muted}>{action.notice}</Text>}
        {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
        <ScrollView style={{ flex: 1 }}><Text selectable style={[s.text, { lineHeight: 28, paddingBottom: 28 }]}>{plain}</Text></ScrollView>
      </SafeAreaView>
    </Modal>}
  </>;
}
