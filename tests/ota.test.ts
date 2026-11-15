import test from "node:test";
import assert from "node:assert/strict";
import { OtaController, type OtaDriver } from "../src/lib/ota-controller.ts";
import { githubUpdate } from "../src/lib/github-ota.ts";
import { parseReleases, RELEASES_URL } from "../src/lib/updates.ts";
import { selectUpdateOffer, type UpdateOffer } from "../src/lib/update-offer.ts";
import { observeUpdateChecks } from "../src/lib/update-lifecycle.ts";

const offer = (tag = "v0.4.2", kind: UpdateOffer["kind"] = "ota"): UpdateOffer => ({
  kind, detail: "更新说明", release: { tag, url: `${RELEASES_URL}/tag/${tag}`, notes: "说明",
    published: "2026-11-15T10:00:00Z", preview: false, hasAndroidApk: true, otaAssets: [] },
});
const driver = (overrides: Partial<OtaDriver> = {}): OtaDriver => ({
  async check() { return offer(); }, async download() { return { ready: true }; }, async reload() {}, ...overrides,
});

test("startup only checks; dismissal preserves the page offer; explicit download coalesces and never auto-restarts", async () => {
  let checks = 0, downloads = 0, restarts = 0;
  const controller = new OtaController({
    async check() { checks++; return offer(); },
    async download() { downloads++; return { ready: true }; }, async reload() { restarts++; },
  });
  const states: string[] = [];
  controller.subscribe(() => states.push(controller.snapshot.status));
  await Promise.all([controller.check(), controller.check(), controller.check(true)]);
  assert.deepEqual(states, ["checking", "available"]);
  assert.equal(checks, 1); assert.equal(downloads, 0); assert.equal(restarts, 0);
  assert.equal(controller.claimPrompt()?.release.tag, "v0.4.2");
  assert.equal(controller.claimPrompt(), null);
  assert.equal(controller.snapshot.offer?.release.tag, "v0.4.2");
  await controller.restart(); assert.equal(restarts, 0);
  await Promise.all([controller.download("v0.4.2"), controller.download("v0.4.2"), controller.check(true)]);
  assert.equal(downloads, 1); assert.equal(restarts, 0);
  assert.equal(controller.snapshot.status, "ready");
  await controller.check(true); assert.equal(checks, 1);
  await controller.restart(); assert.equal(restarts, 1);
});

test("failed download remains visible and retryable without consent being reused by checks", async () => {
  let fail = true;
  const controller = new OtaController(driver({
    async download() { if (fail) throw Error("offline"); return { ready: true }; },
  }));
  await controller.check(); await controller.download("v0.4.2");
  assert.equal(controller.snapshot.status, "error");
  assert.equal(controller.snapshot.offer?.release.tag, "v0.4.2");
  fail = false; await controller.check(true); assert.equal(controller.snapshot.status, "available");
  await controller.download("v0.4.2"); assert.equal(controller.snapshot.status, "ready");
});

test("APK and source-only offers notify without invoking OTA; current builds never download or restart", async () => {
  for (const kind of ["apk", "unavailable"] as const) {
    const controller = new OtaController(driver({ async check() { return offer("v0.4.2", kind); },
      async download() { assert.fail("must not invoke native OTA for this release"); },
    }));
    await controller.check(); assert.equal(controller.claimPrompt()?.kind, kind);
    await controller.download("v0.4.2"); assert.equal(controller.snapshot.status, "available");
  }
  const current = new OtaController(driver({ async check() { return null; },
    async download() { assert.fail("no update"); }, async reload() { assert.fail("no update"); },
  }));
  await current.check(); await current.restart(); await current.download("v0.4.2");
  assert.equal(current.snapshot.status, "current"); assert.equal(current.claimPrompt(), null);
});

test("offline checks never claim current and retain a previously discovered offer", async () => {
  let fail = true;
  const controller = new OtaController(driver({ async check() {
    if (fail) throw Error("offline"); return offer();
  } }));
  await controller.check(); assert.equal(controller.snapshot.status, "error");
  assert.equal(controller.snapshot.checkedAt, undefined); assert.equal(controller.claimPrompt(), null);
  fail = false; await controller.check(true); const checked = controller.snapshot.checkedAt;
  fail = true; await controller.check(true);
  assert.equal(controller.snapshot.status, "error");
  assert.equal(controller.snapshot.checkedAt, checked);
  assert.equal(controller.snapshot.offer?.release.tag, "v0.4.2");
});

test("consent for an old prompt cannot download a newer release", async () => {
  let tag = "v0.4.2", downloads = 0;
  const controller = new OtaController(driver({ async check() { return offer(tag); },
    async download(selected) { downloads++; assert.equal(selected.release.tag, "v0.4.3"); return { ready: true }; },
  }));
  await controller.check(); assert.equal(controller.claimPrompt()?.release.tag, "v0.4.2");
  tag = "v0.4.3";
  const checking = controller.check(true);
  await controller.download("v0.4.2"); await checking;
  assert.equal(downloads, 0);
  assert.equal(controller.claimPrompt()?.release.tag, "v0.4.3");
  await controller.download("v0.4.3"); assert.equal(downloads, 1);
});

test("startup and every return to foreground check, without repeating a dismissed prompt in the same run", async () => {
  let active = "active", listener: ((status: string) => void) | undefined;
  let checks = 0, prompts = 0;
  const controller = new OtaController(driver({ async check() { checks++; return offer(); },
    async download() { assert.fail("no consent"); },
  }));
  const app = { current: () => active, subscribe(fn: (status: string) => void) { listener = fn; return () => { listener = undefined; }; } };
  const emit = (status: string) => { active = status; listener?.(status); };
  const stop = observeUpdateChecks(controller, app, () => { prompts++; });
  await controller.check(); assert.equal(checks, 1); assert.equal(prompts, 1);
  emit("active"); await controller.check(); assert.equal(checks, 1);
  emit("background"); emit("active"); await controller.check();
  assert.equal(checks, 2); assert.equal(prompts, 1);
  assert.equal(controller.snapshot.offer?.release.tag, "v0.4.2");
  stop(); assert.equal(listener, undefined);
  const coldStart = new OtaController(driver());
  const stopNext = observeUpdateChecks(coldStart, app, () => { prompts++; });
  await coldStart.check(); assert.equal(prompts, 2); stopNext();
});

test("checks finishing in background wait to prompt; unmounted observers cannot alert", async () => {
  let active = "active", listener: ((status: string) => void) | undefined, prompts = 0;
  let finish!: (value: UpdateOffer) => void;
  const pending = new Promise<UpdateOffer>(resolve => { finish = resolve; });
  const controller = new OtaController(driver({ check: () => pending }));
  const app = { current: () => active, subscribe(fn: (status: string) => void) { listener = fn; return () => { listener = undefined; }; } };
  const stop = observeUpdateChecks(controller, app, () => { prompts++; });
  active = "background"; listener?.(active); finish(offer());
  await controller.check(); assert.equal(prompts, 0);
  active = "active"; listener?.(active); await controller.check(); assert.equal(prompts, 1);
  stop();
  const next = new OtaController(driver());
  const stopNext = observeUpdateChecks(next, app, () => { prompts++; }); stopNext();
  await next.check(); assert.equal(prompts, 1);
  assert.equal(next.claimPrompt()?.release.tag, "v0.4.2");
});

const release = (tag: string, runtime = "runtime-a", preview = false) => ({
  tag_name: tag, html_url: `${RELEASES_URL}/tag/${tag}`, draft: false, prerelease: preview,
  published_at: "2026-11-02T10:00:00Z", body: "Tested client release", assets: [{
    name: `ota-android-${runtime}.json`, size: 1024, state: "uploaded",
    browser_download_url: `${RELEASES_URL}/download/${tag}/ota-android-${runtime}.json`,
  }],
});
const manifest = (tag = "v0.3.1", runtime = "runtime-a") => ({
  runtimeVersion: runtime, metadata: { platform: "android", releaseTag: tag },
  extra: { expoClient: { extra: { releaseVersion: tag.slice(1) } } }, assets: [],
  launchAsset: { hash: "a".repeat(43), url: `${RELEASES_URL}/download/${tag}/bundle.hbc` },
});
const envelope = (body = manifest()) => ({ manifest: JSON.stringify(body), signature: "A".repeat(512) });
const respond = (data: unknown) => new Response(JSON.stringify(data));

test("startup and page choose the newest release, including APK updates when OTA is disabled or incompatible", () => {
  const older = release("v0.4.2");
  const newer = release("v0.4.3", "new-runtime");
  const apk = { name: "client.apk", size: 123, state: "uploaded",
    browser_download_url: `${RELEASES_URL}/download/v0.4.3/client.apk` };
  const rows = parseReleases([older, { ...newer, assets: [...newer.assets, apk] }]);
  for (const enabled of [true, false]) {
    const result = selectUpdateOffer(rows, "0.4.1", "android", "runtime-a", enabled);
    assert.equal(result?.release.tag, "v0.4.3"); assert.equal(result?.kind, "apk");
  }
  assert.equal(selectUpdateOffer(rows, "0.4.1", "android", "new-runtime", true)?.kind, "ota");
  assert.equal(selectUpdateOffer(rows, "0.4.1", "ios", "new-runtime", true)?.kind, "unavailable");
  // A newer source-only release is not mislabeled as a downloadable older OTA.
  const source = parseReleases([{ ...release("v0.4.4"), assets: [] }]);
  const unavailable = selectUpdateOffer([...rows, ...source], "0.4.1", "android", "runtime-a", true);
  assert.equal(unavailable?.kind, "unavailable"); assert.equal(unavailable?.release.tag, "v0.4.4");
});

test("release discovery ignores stable-channel previews and never suggests a downgrade", () => {
  const rows = parseReleases([release("v0.4.2-preview.1", "runtime-a", true),
    { ...release("v9.0.0"), draft: true }, release("v0.4.1")]);
  assert.equal(selectUpdateOffer(rows, "0.4.1", "android", "runtime-a", true), null);
  assert.equal(selectUpdateOffer(rows, "0.4.3", "android", "runtime-a", true), null);
  assert.equal(selectUpdateOffer(rows, "0.4.0-preview.1", "android", "runtime-a", true)?.release.tag, "v0.4.2-preview.1");
  assert.equal(selectUpdateOffer([], "0.4.1", "android", "runtime-a", true), null);
  assert.throws(() => selectUpdateOffer(rows, "", "android", "runtime-a", true), /无法确认/);
});

test("approved OTA download stays bound to its offered release instead of requerying latest", async () => {
  const selected = parseReleases([release("v0.4.2")]);
  const urls: string[] = [];
  const result = await githubUpdate("android", "runtime-a", "0.4.1", async input => {
    urls.push(String(input));
    assert.equal(String(input), `${RELEASES_URL}/download/v0.4.2/ota-android-runtime-a.json`);
    return respond(envelope(manifest("v0.4.2")));
  }, selected);
  assert.equal(urls.length, 1); assert.equal(result?.version, "0.4.2");
});

test("a failed readiness result is retryable and reload failure preserves the downloaded offer", async () => {
  let ready = false;
  const controller = new OtaController(driver({ async download() { return { ready }; },
    async reload() { throw Error("reload unavailable"); },
  }));
  await controller.check(); await controller.download("v0.4.2");
  assert.equal(controller.snapshot.status, "error");
  ready = true; await controller.download("v0.4.2"); await controller.restart();
  assert.equal(controller.snapshot.status, "ready");
  assert.equal(controller.snapshot.offer?.release.tag, "v0.4.2");
  assert.match(controller.snapshot.message || "", /关闭并重新打开/);
});

test("only our published compatible manifests are selected; no upstream official, draft, preview, downgrade or source-only update", async () => {
  const visited: string[] = [];
  const releases = [release("v0.4.0", "another-runtime"), release("v0.5.0-preview.1", "runtime-a", true),
    { ...release("v9.0.0"), draft: true }, release("v0.3.1"), { ...release("v0.3.2"), assets: [] }];
  const result = await githubUpdate("android", "runtime-a", "0.3.0", async (input, init) => {
    const url = String(input); visited.push(url);
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return respond(url.includes("api.github.com") ? releases : envelope());
  });
  assert.equal(result?.version, "0.3.1"); assert.equal(visited.length, 2);
  assert.ok(visited.every(url => url.includes("TinyPandaGame/deeptutor-mobile")));
  assert.equal(await githubUpdate("android", "runtime-a", "0.6.0", async () => respond(releases)), null);
});

test("wrong runtime, wrong version and outside-repository asset payloads fail before reaching the native updater", async () => {
  for (const body of [manifest("v0.3.1", "wrong"), manifest("v0.3.2"),
    { ...manifest(), launchAsset: { hash: "a".repeat(43), url: "https://example.com/evil.hbc" } }]) {
    await assert.rejects(githubUpdate("android", "runtime-a", "0.3.0", async input => respond(String(input).includes("api.github.com") ? [release("v0.3.1")] : envelope(body))));
  }
});
