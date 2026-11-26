import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readingHintExcerpts, readingQuizSupport, requestReadingQuizHelp, startReadingQuiz, submitReadingQuizAnswer,
} from "../src/lib/reading-quiz.ts";
import { TutorClient } from "../src/lib/client.ts";

function fixture(respond: (path: string, body: Record<string, unknown>) => unknown) {
  const calls: { path: string; scope: string | null; authorization: string | null; method?: string; body: Record<string, unknown> }[] = [];
  const client = new TutorClient({ origin: "https://example.test", kind: "server" }, null, async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path: url.pathname, scope: headers.get("x-deeptutor-workspace"), authorization: headers.get("authorization"),
      method: init?.method, body });
    return Response.json(respond(url.pathname, body));
  });
  client.workspaceId = "workspace-reading";
  client.token = "fixture-token";
  return { client, calls, signal: new AbortController().signal };
}

test("1.7.4 reading quiz and hint use the current workspace, current page and server verdict", async () => {
  const material = "fictional material/one";
  const { client, calls, signal } = fixture(path => {
    if (path.endsWith("/answers")) return { answers: [{ question_id: "quiz-42:0", is_correct: false }], reward: { stars: 2 } };
    if (path.endsWith("/guide")) return { type: "card", payload: { steps: ["Find a clue."] },
      quiz_help: { question_id: "quiz-42:0", hints_used: 1 } };
    return { type: "quiz", payload: { questions: [{ id: "quiz-42:0", prompt: "找一找原文中的线索。", choices: ["甲", "乙"], can_answer: true }] } };
  });
  const { questions: [question] } = await startReadingQuiz(client, material, 3, signal);
  assert.deepEqual(question, { id: "quiz-42:0", prompt: "找一找原文中的线索。", choices: ["甲", "乙"], canAnswer: true, questionHelp: true });
  const excerpt = readingHintExcerpts("First line\n about the topic.\n\nSecond paragraph.")[0];
  assert.equal(excerpt, "First line about the topic.");
  const first = await requestReadingQuizHelp(client, material, 3, question, excerpt, "help-same-key", signal);
  const replay = await requestReadingQuizHelp(client, material, 3, question, excerpt, "help-same-key", signal);
  assert.deepEqual(replay, first);
  assert.equal(first.count, 1);
  assert.deepEqual(await submitReadingQuizAnswer(client, material, 3, question, 0, "same-submission", signal), { correct: false, stars: 2 });
  assert.equal(calls[0].path, "/api/reading/materials/fictional%20material%2Fone/extensions/quiz/actions/start");
  assert.deepEqual(calls[0].body, { locator: 3, locale: "zh" });
  assert.deepEqual(calls[1].body, { locator: 3, locale: "zh", selection: excerpt, question_id: "quiz-42:0", help_request_id: "help-same-key" });
  assert.deepEqual(calls[1], calls[2]);
  assert.deepEqual(calls[3].body, { locator: 3, submission_id: "same-submission", answers: [{ question_id: "quiz-42:0", selected_index: 0 }] });
  assert(calls.every(call => call.method === "POST" && call.scope === "workspace-reading" && call.authorization === "Bearer fixture-token"));
});

test("1.7.2 compatible quiz drops the answer key from UI state and does not claim saved help", async () => {
  const { client, signal, calls } = fixture(() => ({ type: "quiz", payload: { questions: [
    { id: "legacy:0", prompt: "Which route?", choices: ["A", "B"], correct_choice_index: 1, evidence: "mock key" },
  ] } }));
  const { questions: [question] } = await startReadingQuiz(client, "storybook", 1, signal);
  assert.deepEqual(question, { id: "legacy:0", prompt: "Which route?", choices: ["A", "B"], canAnswer: true, questionHelp: false });
  await assert.rejects(requestReadingQuizHelp(client, "storybook", 1, question, "source", "help-id", signal));
  await assert.rejects(submitReadingQuizAnswer(client, "storybook", 1, question, 7, "attempt", signal));
  assert.equal(calls.length, 1);
  assert.deepEqual(readingQuizSupport([{ id: "quiz", actions: [{ id: "start" }] }]), { quiz: true, guidance: false });
  assert.deepEqual(readingQuizSupport([{ id: "guided_learning", actions: [{ id: "guide" }] }]), { quiz: false, guidance: true });
});

test("only a successful receipt for this exact question can confirm saved help", async () => {
  const { client, signal } = fixture(() => ({
    type: "card", payload: { steps: ["A clue"] }, quiz_help: { question_id: "other-question", hints_used: 1 },
  }));
  await assert.rejects(requestReadingQuizHelp(client, "material", 1,
    { id: "target-question", prompt: "Which clue?", choices: ["A"], canAnswer: true, questionHelp: true }, "source", "request", signal),
  /没有记录/);
});
