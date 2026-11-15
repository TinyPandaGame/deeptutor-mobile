import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import * as Sharing from "expo-sharing";
import { SafeAreaView } from "react-native-safe-area-context";
import { FormModal } from "../features/common";
import { Button, C, Heading, s } from "../ui";
import { copyImage } from "../lib/native-clipboard";
import { assertLocalImage, imageDataUri } from "../lib/copy-content";
import { useContentAction } from "../lib/use-content-action";
import { temporaryBytes } from "../lib/temporary-files";

export function QuestionImage({ uri, onError }: { uri: string; onError?: () => void }) {
  const action = useContentAction(uri);
  const [selection, setSelection] = useState<{ api: typeof action.api; uri: string } | null>(null);
  const open = selection !== null && selection.api === action.api && selection.uri === uri;
  const copy = () => void action.run(active => copyImage(uri, active), "图片已复制，可在支持图片粘贴的应用中使用");
  const share = () => void action.run(async active => {
    if (!await Sharing.isAvailableAsync()) throw Error("当前设备暂不支持图片分享。");
    active();
    let file = uri;
    const data = imageDataUri(uri);
    if (data) {
      if (!action.api) throw Error("请重新打开图片后再试。");
      const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      file = temporaryBytes(action.api, bytes.buffer, `photo.${data.mime === 'image/jpeg' ? 'jpg' : data.mime.split('/')[1]}`);
    } else assertLocalImage(uri);
    active();
    await Sharing.shareAsync(file, { dialogTitle: "分享图片", ...(data ? { mimeType: data.mime } : {}) });
  }, "");
  const menu = () => {
    if (action.busy) return;
    Alert.alert("图片操作", "", [
      { text: "复制图片", onPress: copy },
      { text: "分享图片", onPress: share },
      { text: "取消", style: "cancel" },
    ]);
  };
  const feedback = <>
    {!!action.notice && <Text accessibilityLiveRegion="polite" style={s.muted}>{action.notice}</Text>}
    {!!action.error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{action.error}</Text>}
  </>;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="查看题目原图" accessibilityHint="点击放大，长按复制或分享图片"
      onPress={() => setSelection({ api: action.api, uri })} onLongPress={menu}>
      <Image source={{ uri }} onError={onError} resizeMode="contain" style={{ width: "100%", height: 220, borderRadius: 12, backgroundColor: C.white }} />
    </Pressable>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button title="复制图片" icon="copy-outline" compact secondary busy={action.busy} onPress={copy} />
      <Button title="分享图片" icon="share-outline" compact secondary disabled={action.busy} onPress={share} />
    </View>
    {feedback}
    {open ? <FormModal onClose={() => setSelection(null)}><SafeAreaView style={{ flex: 1, backgroundColor: C.white }}>
      <View style={{ padding: 18 }}><Heading title="题目照片" right={<Button title="关闭" secondary onPress={() => setSelection(null)} />} /></View>
      <Pressable style={{ flex: 1 }} onLongPress={menu} accessibilityLabel="题目原图，长按复制或分享">
        <Image accessibilityLabel="题目原图" source={{ uri }} resizeMode="contain" style={{ flex: 1, width: "100%", marginBottom: 16 }} />
      </Pressable>
      <View style={{ padding: 18, gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button title="复制图片" icon="copy-outline" secondary busy={action.busy} onPress={copy} />
          <Button title="分享图片" icon="share-outline" secondary disabled={action.busy} onPress={share} />
        </View>
        {feedback}
      </View>
    </SafeAreaView></FormModal> : null}
  </>;
}
