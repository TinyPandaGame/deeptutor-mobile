import { compareVersions, newestRelease, parseVersion, type AppRelease } from "./updates.ts";

export type UpdateOffer = {
  release: AppRelease;
  kind: "ota" | "apk" | "unavailable";
  detail: string;
};

// One release decision is shared by the startup prompt and the update page.
// Discovery never prepares or downloads executable update resources.
export function selectUpdateOffer(releases: AppRelease[], current: string, platform: string,
  runtime: string, canHotUpdate: boolean): UpdateOffer | null {
  const parsed = parseVersion(current);
  if (!parsed) throw Error("无法确认当前版本，请到发布页查看安装包。");
  const release = newestRelease(releases, !!parsed.pre.length);
  if (!release || (compareVersions(release.tag, current) || 0) <= 0) return null;
  if (canHotUpdate && ["android", "ios"].includes(platform) && runtime &&
    release.otaAssets.some(asset => asset.name === `ota-${platform}-${runtime}.json`)) {
    return { release, kind: "ota", detail: "下载完成后，重新打开应用即可使用新版本。" };
  }
  if (platform === "android" && release.hasAndroidApk) {
    return { release, kind: "apk", detail: "本次需要下载安装包。将打开发布页，下载后按系统提示安装。" };
  }
  return { release, kind: "unavailable", detail: platform === "ios"
    ? "此版本暂未提供适用于本安装包的更新。请等待你的发行者通过 TestFlight 或 App Store 提供新版。"
    : "此版本暂未提供适用于本设备的安装包，准备好后可在这里下载。" };
}
