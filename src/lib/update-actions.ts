import { Alert } from "react-native";
import * as Linking from "expo-linking";
import { ota } from "./ota";
import type { UpdateOffer } from "./update-offer";

export async function openRelease(url: string) {
  try { await Linking.openURL(url); }
  catch { Alert.alert("暂时无法打开", "请确认设备可以使用浏览器后重试。"); }
}

export function downloadUpdate(offer: UpdateOffer) {
  if (offer.kind === "ota") void ota.download(offer.release.tag);
  else void openRelease(offer.release.url);
}

export function promptForUpdate(offer: UpdateOffer) {
  Alert.alert(`发现新版本 ${offer.release.tag}`, offer.kind === "unavailable" ? offer.detail
    : `${offer.detail}\n\n现在下载吗？`, [
    { text: "稍后", style: "cancel" },
    { text: offer.kind === "unavailable" ? "查看说明" : "去下载", onPress: () => downloadUpdate(offer) },
  ], { cancelable: true });
}

export function restartForUpdate() {
  Alert.alert("重新打开应用？", "新版本已下载。请先完成当前编辑，再重新打开应用。", [
    { text: "稍后", style: "cancel" }, { text: "立即重启", onPress: () => void ota.restart() },
  ]);
}
