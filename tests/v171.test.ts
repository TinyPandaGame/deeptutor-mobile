import test from "node:test";
import assert from "node:assert/strict";
import { ComposerDraftStore } from "../src/lib/composer-drafts.ts";
import { DEFAULT_DISPLAY, learningTextStyle, normalizeDisplay } from "../src/lib/learning-display.ts";
import { pageHasFlashcards, threadSource, tutorSource, visibleBranch } from "../src/lib/chat-actions.ts";
import { SessionManager, type Storage } from "../src/lib/session-manager.ts";
import { connection, scopedKey } from "../src/lib/connection.ts";
import type { Session } from "../src/lib/client.ts";
import { mergeChatOptions } from "../src/lib/learning-options.ts";

test("workspace knowledge inheritance omits the field, while a deliberate empty selection is written", () => {
  const defaults = { capability: "chat", persona: "teacher", config: {} };
  const inherited = mergeChatOptions(defaults, {});
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(inherited)), "knowledge_bases"), false);
  const disabled = mergeChatOptions(defaults, { knowledge_bases: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(disabled)).knowledge_bases, []);
  assert.deepEqual(mergeChatOptions(defaults, { knowledge_bases: ["教材"] }).knowledge_bases, ["教材"]);
});

test("restored options cannot overwrite a changed tutor anchor or current model", () => {
  const oldSource = { parent_session_id: "parent", source_message_id: 2, quoted_message_id: 2 };
  const freshSource = { ...oldSource, quoted_message_id: 1 };
  const context = { capability: "chat", persona: "teacher", selection_tutor_context: oldSource, llm_selection: { model_id: "old" } };
  const options = mergeChatOptions({ capability: "chat", persona: "teacher", config: {}, knowledge_bases: [] }, context);
  const payload = { ...context, selection_tutor_context: freshSource, ...options, llm_selection: { model_id: "current" } };
  assert.deepEqual(payload.selection_tutor_context, freshSource);
  assert.equal(Object.hasOwn(options, "selection_tutor_context"), false);
  assert.equal(Object.hasOwn(options, "llm_selection"), false);
});

test("learning typography validates remote choices and scales text plus spacing", () => {
  assert.deepEqual(normalizeDisplay({ content_font_scale: 999 as 100, content_line_spacing: "bad" as "normal" }), DEFAULT_DISPLAY);
  assert.deepEqual(learningTextStyle({ content_font_scale: 150, content_line_spacing: "relaxed" }), { fontSize: 24, lineHeight: 48 });
});
test("composer drafts persist across reload, retain attachments, isolate all scope components and serialize clears", async () => {
  let raw: string | null = null;
  const storage = { read: async () => raw, write: async (s: string) => { raw = s; } };
  const drafts = new ComposerDraftStore(storage);
  const value = { text: "未发送问题", attachments: [{ filename: "test.pdf", base64: "cGRm", mime_type: "application/pdf" }] };
  await Promise.all([drafts.save("server1:alice:work1", "new", value), drafts.save("server1:bob:work1", "new", { text: "bob", attachments: [] })]);
  assert.deepEqual(await new ComposerDraftStore(storage).read("server1:alice:work1", "new"), value);
  for (const scope of ["server2:alice:work1", "server1:alice:work2"]) assert.equal(await drafts.read(scope, "new"), undefined);
  assert.equal(await drafts.read("server1:alice:work1", "session1"), undefined);
  await Promise.all([drafts.save("server1:alice:work1", "new", value), drafts.save("server1:alice:work1", "new", { text: "", attachments: [] })]);
  assert.equal(await drafts.read("server1:alice:work1", "new"), undefined);
  assert.equal((await drafts.read("server1:bob:work1", "new"))?.text, "bob");
});
test("failed draft write preserves prior unsent work", async () => {
  let raw: string | null = null, fail = false;
  const drafts = new ComposerDraftStore({ read: async () => raw, write: async s => { if (fail) throw Error("disk full"); raw = s; } });
  await drafts.save("owner", "new", { text: "original", attachments: [] }); fail = true;
  await assert.rejects(drafts.save("owner", "new", { text: "replacement", attachments: [] }), /disk full/);
  assert.equal((await drafts.read("owner", "new"))?.text, "original");
});
test("message-level tutor supports explicit detach and validates a replacement source", () => {
  const parent = { id: "parent", messages: [{ id: "1", role: "user" }, { id: "2", role: "assistant" }] } as Session;
  assert.deepEqual(threadSource(parent, "1"), { parent_session_id: "parent", source_message_id: "2", quoted_message_id: "1" });
  assert.equal(threadSource(parent, null).quoted_message_id, null);
  assert.throws(() => threadSource(parent, "missing"), /原消息/);
  assert.equal(tutorSource({ parent_session_id: "parent", tutor_source_message_id: null })?.quoted_message_id, null);
  assert.equal(tutorSource({ parent_session_id: "parent", tutor_source_message_id: "" })?.quoted_message_id, null);
  assert.equal(tutorSource({}), null);
});
test("edited branches preserve original answers and can switch back without merging transcripts", () => {
  const messages = [{ id: 1, role: "user", parent_message_id: null }, { id: 2, role: "assistant", parent_message_id: 1 }, { id: 3, role: "user", parent_message_id: null }, { id: 4, role: "assistant", parent_message_id: 3 }];
  assert.deepEqual(visibleBranch(messages).map(m => m.id), [3, 4]);
  assert.deepEqual(visibleBranch(messages, { null: 1 }).map(m => m.id), [1, 2]);
  assert.equal(messages.length, 4);
  assert.equal(pageHasFlashcards([{ type: "paragraph", children: [{ type: "learning", props: { kind: "flashcards" } }] }]), true);
  assert.equal(pageHasFlashcards([{ type: "learning", props: { kind: "quiz" } }]), false);
});
test("password change updates saved auto-login; wrong current password cannot replace it", async () => {
  const config = connection("https://fixture.example", "server");
  const values = new Map<string, string>();
  const storage: Storage = { get: async k => values.get(k) || null, set: async (k,v) => { values.set(k,v); }, remove: async k => { values.delete(k); } };
  let password = "original-pass", validToken = "", n = 0;
  const response = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
  const fetcher = (async (url, init) => {
    const path = new URL(String(url)).pathname;
    const signedIn = new Headers(init?.headers).get("Authorization") === `Bearer ${validToken}` && !!validToken;
    if (path.endsWith("/status")) return response({ enabled: true, authenticated: signedIn, user_id: signedIn ? "alice" : null });
    const body = JSON.parse(String(init?.body || "{}"));
    if (path.endsWith("/login")) {
      if (body.password !== password) return response({},401);
      validToken = `token${++n}`;
      return response({ user_id: "alice", username: "alice", role: "user" },200,{ "Set-Cookie": `dt_token=${validToken}; HttpOnly` });
    }
    if (!signedIn) return response({},401);
    if (path.endsWith("/profile/password")) {
      if (body.current_password !== password) return response({ detail: "Current password is incorrect" },400);
      password = body.new_password; return response({ ok: true });
    }
    return response({});
  }) as typeof fetch;
  const manager = new SessionManager(storage, fetcher);
  await manager.start(); await manager.connect(config); await manager.login("alice", password);
  await assert.rejects(manager.changePassword("wrong", "changed-pass"), /当前密码/);
  assert.equal(JSON.parse(values.get(scopedKey(config.origin,"alice"))!).password,"original-pass");
  await manager.changePassword("original-pass", "changed-pass");
  assert.equal(JSON.parse(values.get(scopedKey(config.origin,"alice"))!).password,"changed-pass");
  manager.dispose(); validToken = "";
  const restarted = new SessionManager(storage, fetcher); await restarted.start();
  assert.equal(restarted.snapshot.api?.user?.username,"alice");
  assert.equal(restarted.snapshot.bootError,"");
});
