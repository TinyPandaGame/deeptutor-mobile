import test from "node:test";
import assert from "node:assert/strict";
import { TutorClient } from "../src/lib/client.ts";
import { connection } from "../src/lib/connection.ts";
import type { JudgeSocket } from "../src/lib/quiz-judge.ts";
import {
  parseRecognizedQuestion,
  recognizeQuestion,
  recognitionCommand,
} from "../src/lib/question-recognition.ts";
import {
  questionEntryPayload,
  saveQuestionEntry,
} from "../src/lib/question-entry.ts";

const photo = {
  type: "image",
  base64: "synthetic-photo",
  mime_type: "image/jpeg",
  filename: "question.jpg",
};
const choice = { profile_id: "vision-profile", model_id: "vision-model" };
const recognized = {
  question: "3 × 4 = ?\nA. 10\nB. 12",
  user_answer: "10",
  uncertainties: ["最后一个字看不清"],
};

test("recognition preserves notation, options and uncertainty without manufacturing a correct answer", () => {
  assert.deepEqual(
    parseRecognizedQuestion(JSON.stringify(recognized)),
    recognized,
  );
  assert.deepEqual(
    parseRecognizedQuestion("```json\n" + JSON.stringify(recognized) + "\n```"),
    recognized,
  );
  assert.deepEqual(
    parseRecognizedQuestion(
      '{"question":"","user_answer":"","uncertainties":["请裁剪到一道题"]}',
    ),
    { question: "", user_answer: "", uncertainties: ["请裁剪到一道题"] },
  );
  for (const value of [
    "我看不到图片",
    "[]",
    "{}",
    '{"question":42,"user_answer":"","uncertainties":[]}',
    JSON.stringify({ ...recognized, uncertainties: [{}] }),
    JSON.stringify({ ...recognized, question: "x".repeat(20001) }),
  ])
    assert.throws(() => parseRecognizedQuestion(value));
});

test("the recognition request uses the selected model, image and workspace without automatically collecting anything", () => {
  const payload = recognitionCommand(
    photo,
    choice,
    "math",
    "fixture-submission",
  );
  assert.equal(payload.workspace_id, "math");
  assert.deepEqual(payload.llm_selection, choice);
  assert.equal(payload.attachments[0].base64, photo.base64);
  assert.equal(payload.attachments[0].mime_type, "image/jpeg");
  assert.match(payload.content, /不判分/);
  assert.match(payload.content, /不要编造/);
  assert.equal("session_id" in payload, false);
  assert.throws(() =>
    recognitionCommand({ ...photo, base64: "" }, choice, "", "x"),
  );
  assert.throws(() =>
    recognitionCommand({ ...photo, mime_type: "text/html" }, choice, "", "x"),
  );
  assert.throws(() =>
    recognitionCommand(
      { ...photo, base64: "x".repeat(10 * 1024 * 1024 + 1) },
      choice,
      "",
      "x",
    ),
  );
});

async function setup({
  vision = true as boolean | null,
  timeout = 1000,
  selected = choice as typeof choice | null,
} = {}) {
  const reads: string[] = [],
    sent: Record<string, unknown>[] = [],
    sessions: string[] = [];
  const info: { url?: string; headers?: Record<string, string> } = {};
  let closes = 0;
  const api = new TutorClient(
    connection("https://fixture.example.com", "server"),
    null,
    async (url, init) => {
      reads.push(String(url));
      assert.ok(
        !init?.method || init.method === "GET",
        "recognition cannot write notebook entries",
      );
      if (String(url).endsWith("/api/auth/status"))
        return new Response(
          JSON.stringify({
            enabled: true,
            authenticated: true,
            user_id: "fixture",
          }),
        );
      assert.equal(
        new Headers(init?.headers).get("X-DeepTutor-Workspace"),
        "math",
      );
      return new Response(
        JSON.stringify({
          active: choice,
          options: [
            {
              ...choice,
              model: "fixture-vision",
              ...(vision === null ? {} : { supports_vision: vision }),
            },
          ],
        }),
      );
    },
  );
  api.user = { user_id: "fixture", username: "fixture", role: "user" };
  api.token = "fixture-token";
  api.workspaceId = "math";
  const control = new AbortController();
  const socket: JudgeSocket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (body) => sent.push(JSON.parse(body)),
    close: () => {
      closes++;
    },
  };
  const result = recognizeQuestion(
    api,
    photo,
    selected,
    (url, headers) => {
      Object.assign(info, { url, headers });
      return socket;
    },
    control.signal,
    (id) => sessions.push(id),
    timeout,
  );
  // Attach a handler immediately: an unavailable model can reject before the next tick.
  void result.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  const emit = (value: unknown) =>
    socket.onmessage?.({ data: JSON.stringify(value) });
  return {
    api,
    control,
    socket,
    result,
    reads,
    sent,
    sessions,
    info,
    emit,
    closes: () => closes,
  };
}

test("authenticated stream preserves source, ignores replay and waits for done before exposing a draft", async () => {
  const run = await setup();
  run.socket.onopen?.();
  assert.equal(run.info.url, "wss://fixture.example.com/ws");
  assert.equal(run.info.headers?.Cookie, "dt_token=fixture-token");
  assert.equal(run.info.headers?.["X-DeepTutor-Workspace"], "math");
  assert.deepEqual(run.sent[0].llm_selection, choice);
  let complete = false;
  void run.result.then(() => {
    complete = true;
  });
  const text = JSON.stringify(recognized);
  run.emit({
    type: "session",
    session_id: "synthetic-session",
    turn_id: "turn",
    seq: 1,
  });
  run.emit({ type: "content", content: text.slice(0, 20), seq: 2 });
  run.emit({ type: "content", content: "replayed junk", seq: 2 });
  run.emit({ type: "content", content: text.slice(20), seq: 3 });
  await Promise.resolve();
  assert.equal(complete, false);
  run.emit({ type: "done", seq: 4 });
  assert.deepEqual(await run.result, {
    ...recognized,
    session_id: "synthetic-session",
    turn_id: "turn",
  });
  assert.deepEqual(run.sessions, ["synthetic-session"]);
  assert.equal(run.closes(), 1);
  run.emit({ type: "content", content: "late" });
  assert.equal(run.closes(), 1);
});

test("final snapshots and legacy servers without vision metadata remain usable", async () => {
  const run = await setup({ vision: null, selected: null });
  run.socket.onopen?.();
  run.emit({
    type: "result",
    metadata: { response: JSON.stringify(recognized) },
    session_id: "s",
    turn_id: "t",
  });
  run.emit({ type: "done" });
  assert.equal((await run.result).user_answer, "10");
});

test("confirmed corrections and original image copies save together under a stable identity; partial saves are explicit", async () => {
  const value = {
    id: "fixture-question",
    question: " 校对后的题目 ",
    user_answer: "10",
    correct_answer: "",
    explanation: "",
    options: {},
    session_id: "recognition-session",
    turn_id: "recognition-turn",
  };
  const copies = [
    {
      id: "fixture-question_photo_0",
      base64: "synthetic-photo",
      filename: "question.jpg",
      mime_type: "image/jpeg",
    },
  ];
  const payload = questionEntryPayload(value, copies);
  assert.equal(payload.question, "校对后的题目");
  assert.equal(payload.origin_ref, "recognition-session");
  assert.deepEqual(payload.user_answer_images, copies);
  assert.equal(
    questionEntryPayload({ ...value, session_id: "" }).origin_ref,
    value.id,
  );
  const writes: unknown[] = [];
  const api = {
    assertOpen() {},
    json: async <T>(path: string, body: unknown) => {
      assert.equal(path, "/api/question-notebook/entries/upsert");
      writes.push(body);
      return {
        ...payload,
        id: 5,
        user_answer_images: [
          { id: copies[0].id, url: "/files/attachments/question/photo.jpg" },
        ],
      } as T;
    },
  };
  await saveQuestionEntry(api, value, copies);
  await saveQuestionEntry(api, value, copies);
  assert.deepEqual(writes[0], writes[1]);
  for (const response of [
    { ...payload, id: 5, user_answer_images: [] },
    { ...payload, id: 5, question_id: "wrong-id" },
    {
      ...payload,
      id: 5,
      user_answer_images: [{ url: "//other.example/photo.jpg" }],
    },
  ])
    await assert.rejects(
      saveQuestionEntry(
        { ...api, json: async <T>() => response as T },
        value,
        copies,
      ),
      /未完整|尚未确认/,
    );
  await assert.rejects(
    saveQuestionEntry(
      {
        ...api,
        assertOpen() {
          throw Error("retired");
        },
      },
      value,
      copies,
    ),
    /retired/,
  );
  assert.equal(writes.length, 2);
});

test("explicitly unsupported or revoked models are rejected before any image leaves the device", async () => {
  for (const options of [
    { vision: false },
    { selected: { profile_id: "removed", model_id: "removed" } },
  ]) {
    const run = await setup(options);
    await assert.rejects(run.result, /不支持|不可用/);
    assert.equal(run.info.url, undefined);
    assert.equal(run.sent.length, 0);
  }
});

test("cancel, logout, timeout, malformed or interrupted streams never become a draft and cancel admitted work", async () => {
  for (const stop of [
    (r: Awaited<ReturnType<typeof setup>>) => r.control.abort(),
    (r: Awaited<ReturnType<typeof setup>>) => r.api.close(),
    (r: Awaited<ReturnType<typeof setup>>) => r.socket.onclose?.(),
    (r: Awaited<ReturnType<typeof setup>>) => r.socket.onerror?.(),
    (r: Awaited<ReturnType<typeof setup>>) =>
      r.emit({ type: "error", content: "provider secret must not be shown" }),
    (r: Awaited<ReturnType<typeof setup>>) =>
      r.emit({ type: "protocol_error", message: "private error" }),
    (r: Awaited<ReturnType<typeof setup>>) =>
      r.emit({ type: "wait_for_input" }),
    (r: Awaited<ReturnType<typeof setup>>) => r.emit({ type: "done" }),
    (r: Awaited<ReturnType<typeof setup>>) =>
      r.socket.onmessage?.({ data: "?" }),
    (r: Awaited<ReturnType<typeof setup>>) =>
      r.emit({ type: "content", content: "x".repeat(60001) }),
  ]) {
    const run = await setup();
    run.socket.onopen?.();
    run.emit({ type: "session", session_id: "s", turn_id: "t" });
    stop(run);
    await assert.rejects(run.result, (error) => {
      assert.doesNotMatch(String(error), /provider secret|private error/);
      return true;
    });
    assert.equal(run.closes(), 1);
  }
  const run = await setup({ timeout: 5 });
  run.socket.onopen?.();
  run.emit({ type: "session", turn_id: "t" });
  await assert.rejects(run.result, /超时/);
  assert.equal(run.sent.at(-1)?.type, "cancel_turn");
});
