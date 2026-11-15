import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { OtaController } from "../src/lib/ota-controller.ts";
import { selectUpdateOffer } from "../src/lib/update-offer.ts";
import { readableReleaseNotes, RELEASES_URL } from "../src/lib/updates.ts";

// Exercise the actual screen/actions/native adapter wiring in Node. Only the
// React Native host is replaced; this is not a device or gesture acceptance test.
function load(file, dependencies, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, ...globals,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return module.exports;
}
const release = { tag: "v0.4.2", url: `${RELEASES_URL}/tag/v0.4.2`, notes: "## 更方便的更新\n修复提示", published: "2026-11-15T10:00:00Z",
  preview: false, hasAndroidApk: true, otaAssets: [{ name: "ota-android-runtime-a.json", url: `${RELEASES_URL}/download/v0.4.2/ota-android-runtime-a.json` }] };
function host(controller) {
  const alerts = [], opened = [];
  const actions = load("../src/lib/update-actions.ts", {
    "react-native": { Alert: { alert: (...args) => alerts.push(args) } },
    "expo-linking": { openURL: async url => { opened.push(url); } }, "./ota": { ota: controller },
  });
  const jsx = (type, props) => ({ type, props });
  const { default: Screen } = load("../src/app/updates.tsx", {
    react: { useEffect() {} }, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Platform: { OS: "android" }, Text: "Text", View: "View" },
    "../lib/app-release": { APP_RELEASE: "0.4.1" },
    "../lib/updates": { readableReleaseNotes, RELEASES_URL },
    "../ui": { Button: "Button", Heading: "Heading", Page: "Page", Section: "Section", C: {}, s: {} },
    "../lib/ota": { ota: controller, useOta: () => controller.snapshot },
    "../lib/update-actions": actions,
  });
  function nodes(value) {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (value && typeof value === "object") return [value, ...nodes(value.props?.children)];
    return typeof value === "string" ? [value] : [];
  }
  return { actions, alerts, opened, render: () => nodes(Screen()) };
}

test("dismissed startup offer remains first on the actual page; download and restart need separate taps", async () => {
  let downloads = 0, restarts = 0;
  const controller = new OtaController({ async check() { return selectUpdateOffer([release], "0.4.1", "android", "runtime-a", true); },
    async download() { downloads++; return { ready: true }; }, async reload() { restarts++; },
  });
  const ui = host(controller);
  await controller.check(); ui.actions.promptForUpdate(controller.claimPrompt());
  const [title, message, buttons, options] = ui.alerts[0];
  assert.match(title, /发现新版本 v0.4.2/); assert.match(message, /现在下载吗/);
  assert.equal(buttons[0].text, "稍后"); assert.equal(buttons[0].onPress, undefined);
  assert.equal(options.cancelable, true); assert.equal(downloads, 0);
  let screen = ui.render();
  assert.ok(screen.indexOf("发现新版本") < screen.indexOf("当前版本"));
  assert.ok(screen.includes("v0.4.2")); assert.equal(screen.includes("自动更新"), false);
  const download = screen.find(node => node.type === "Button" && node.props.title === "下载更新");
  assert.equal(download.props.disabled, false); download.props.onPress();
  await controller.download("v0.4.2"); assert.equal(downloads, 1); assert.equal(restarts, 0);
  screen = ui.render(); assert.ok(screen.includes("新版本已下载"));
  screen.find(node => node.type === "Button" && node.props.title === "重新打开应用").props.onPress();
  assert.equal(restarts, 0);
  ui.alerts.at(-1)[2].find(button => button.text === "立即重启").onPress();
  assert.equal(restarts, 1);
});

test("APK prompt and page lead to the same release only after a tap; source-only releases do not promise a download", async () => {
  for (const hasAndroidApk of [true, false]) {
    const controller = new OtaController({
      async check() { return selectUpdateOffer([{ ...release, hasAndroidApk, otaAssets: [] }], "0.4.1", "android", "old-runtime", false); },
      async download() { assert.fail("must not invoke OTA"); }, async reload() {},
    });
    const ui = host(controller);
    await controller.check(); ui.actions.promptForUpdate(controller.claimPrompt());
    assert.equal(ui.opened.length, 0);
    const button = ui.alerts[0][2][1];
    assert.equal(button.text, hasAndroidApk ? "去下载" : "查看说明");
    button.onPress(); assert.deepEqual(ui.opened, [release.url]);
    ui.render().find(node => node.type === "Button" && node.props.title === (hasAndroidApk ? "下载安装包" : "查看版本说明")).props.onPress();
    assert.deepEqual(ui.opened, [release.url, release.url]);
  }
});

test("actual native driver discovers releases without native/network download work until consent", async () => {
  const nativeCalls = [], manifests = [];
  const manifest = { extra: { expoClient: { extra: { releaseVersion: "0.4.2" } } } };
  const { ota } = load("../src/lib/ota.ts", {
    react: { useSyncExternalStore() {} },
    "expo-updates": { isEnabled: true, runtimeVersion: "runtime-a",
      async checkForUpdateAsync() { nativeCalls.push("check"); return { isAvailable: true, manifest }; },
      async fetchUpdateAsync() { nativeCalls.push("fetch"); return { isNew: true, manifest }; },
      async reloadAsync() { nativeCalls.push("reload"); },
    },
    "./ota-controller": { OtaController },
    expo: { requireOptionalNativeModule: () => ({ async prepare(...args) { nativeCalls.push("prepare"); manifests.push(args); return true; } }) },
    "react-native": { Platform: { OS: "android" } }, "./app-release": { APP_RELEASE: "0.4.1" },
    "./github-ota": { async githubUpdate(_platform, _runtime, _current, _fetch, releases) {
      nativeCalls.push("manifest"); assert.deepEqual(Array.from(releases), [release]);
      return { manifest: "signed-manifest-bytes", signature: "signature", version: "0.4.2" };
    } },
    "./updates": { checkReleases: async () => [release] }, "./update-offer": { selectUpdateOffer },
  }, { __DEV__: false, fetch: () => assert.fail("unexpected network") });
  await ota.check(); assert.deepEqual(nativeCalls, []);
  assert.equal(ota.snapshot.offer?.kind, "ota");
  await ota.download("v0.4.2");
  assert.deepEqual(nativeCalls, ["manifest", "prepare", "check", "fetch"]);
  assert.deepEqual(manifests, [["signed-manifest-bytes", "signature"]]);
  assert.equal(ota.snapshot.status, "ready");
  await ota.restart(); assert.equal(nativeCalls.at(-1), "reload");
});
