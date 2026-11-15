import { checkReleases, compareVersions, parseVersion, RELEASES_URL, type AppRelease } from "./updates.ts";

export type SignedUpdate = { manifest: string; signature: string; version: string };
export async function githubUpdate(platform: string, runtime: string, current: string, fetcher: typeof fetch = fetch,
  releases?: AppRelease[]): Promise<SignedUpdate | null> {
  if (!["android", "ios"].includes(platform) || !/^[\w.-]{1,128}$/.test(runtime) || !parseVersion(current))
    throw Error("无法确认当前安装包版本。");
  const preview = !!parseVersion(current)?.pre.length;
  const rows = (releases ?? await checkReleases(undefined, fetcher))
    .filter(row => (preview || !row.preview) && (compareVersions(row.tag, current) || 0) > 0)
    .sort((a, b) => compareVersions(b.tag, a.tag) || 0);
  for (const row of rows) {
    const asset = row.otaAssets.find(a => a.name === `ota-${platform}-${runtime}.json`);
    if (!asset) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(asset.url, { signal: controller.signal, credentials: "omit" });
      if (!response.ok) throw Error("更新包尚未准备好。");
      const text = await response.text();
      if (text.length > 2_000_000) throw Error("更新清单过大。");
      const envelope = JSON.parse(text);
      if (typeof envelope.manifest !== "string" || typeof envelope.signature !== "string" ||
        !/^[A-Za-z0-9+/=]{128,1024}$/.test(envelope.signature)) throw Error("更新清单格式不正确。");
      const manifest = JSON.parse(envelope.manifest);
      if (manifest.runtimeVersion !== runtime || manifest.metadata?.platform !== platform ||
        manifest.metadata?.releaseTag !== row.tag || !Array.isArray(manifest.assets) ||
        manifest.extra?.expoClient?.extra?.releaseVersion !== row.tag.replace(/^v/, "")) throw Error("更新包不适合当前安装包。");
      const prefix = `${RELEASES_URL}/download/${encodeURIComponent(row.tag)}/`;
      for (const file of [manifest.launchAsset, ...manifest.assets]) {
        if (!file || typeof file.url !== "string" || !file.url.startsWith(prefix) ||
          !/^[\w.-]+$/.test(file.url.slice(prefix.length)) || !/^[\w-]{43}$/.test(file.hash))
          throw Error("更新资源来源不正确。");
      }
      // This validates routing, not authenticity. Expo's native updater verifies
      // the signature with the pinned certificate before loading any code.
      return { manifest: envelope.manifest, signature: envelope.signature, version: row.tag.replace(/^v/, "") };
    } finally { clearTimeout(timer); }
  }
  return null;
}
