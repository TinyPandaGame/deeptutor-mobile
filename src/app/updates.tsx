import { useEffect } from "react";
import { Platform, Text, View } from "react-native";
import { APP_RELEASE } from "../lib/app-release";
import { readableReleaseNotes, RELEASES_URL } from "../lib/updates";
import { Button, C, Heading, Page, Section, s } from "../ui";
import { ota, useOta } from "../lib/ota";
import { downloadUpdate, openRelease, restartForUpdate } from "../lib/update-actions";

export default function Updates() {
  const state = useOta();
  useEffect(() => { void ota.check(); }, []);
  const { offer, status } = state;
  const checking = status === "idle" || status === "checking";
  const downloading = status === "downloading";
  const ready = status === "ready";
  return <Page>
    <Heading title="应用更新" back />
    <View style={[s.card, { gap: 12, marginBottom: 16 }, offer && { borderColor: C.teal, backgroundColor: C.pale }]}>
      <Text accessibilityRole="header" style={s.h2}>{offer
        ? ready ? "新版本已下载" : "发现新版本"
        : checking ? "正在检查新版本…" : status === "error" ? "暂时无法检查更新" : "暂无新版本"}</Text>
      {offer ? <>
        <Text style={[s.h1, { color: C.teal }]}>{offer.release.tag}</Text>
        <Text style={s.muted}>发布于 {new Date(offer.release.published).toLocaleDateString("zh-CN")}</Text>
        <Text style={s.text}>{ready ? "重新打开应用，即可使用新版本。"
          : downloading ? "正在下载更新，你可以继续学习。" : offer.detail}</Text>
        {ready ? <Button title="重新打开应用" onPress={restartForUpdate} />
          : <Button title={downloading ? "正在下载…" : offer.kind === "ota" ? "下载更新"
            : offer.kind === "apk" ? "下载安装包" : "查看版本说明"}
            busy={downloading} disabled={checking} onPress={() => downloadUpdate(offer)} />}
        {Platform.OS === "android" && status === "error" && offer.kind === "ota" && offer.release.hasAndroidApk &&
          <Button title="前往发布页下载安装包" secondary onPress={() => void openRelease(offer.release.url)} />}
      </> : status === "current" ? <Text style={s.muted}>有新版本时会在这里提醒你。</Text> : null}
      {!!state.message && <Text accessibilityRole="alert" style={{ color: C.danger, lineHeight: 22 }}>{state.message}</Text>}
      {status === "error" && !offer && <Button title="重新检查" onPress={() => void ota.check(true)} />}
    </View>
    <View style={[s.card, { gap: 12 }]}>
      <Text style={s.h2}>当前版本</Text>
      <Text style={s.text}>DeepTutor 移动版 · {APP_RELEASE || "未标记版本"}</Text>
      {!ready && <Button title={checking ? "正在检查…" : "检查新版本"} secondary busy={checking}
        disabled={downloading} onPress={() => void ota.check(true)} />}
      {!!state.checkedAt && <Text style={s.muted}>上次检查：{new Date(state.checkedAt).toLocaleString("zh-CN")}</Text>}
    </View>
    {offer && <>
      <Section title="更新说明" />
      <View style={s.card}><Text selectable style={s.text}>{readableReleaseNotes(offer.release.notes) || "暂无更新说明。"}</Text></View>
    </>}
    <Section title="发布记录" />
    <Button title="查看历史版本" secondary onPress={() => void openRelease(RELEASES_URL)} />
  </Page>;
}
