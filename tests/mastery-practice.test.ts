import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, TutorClient } from "../src/lib/client.ts";
import { loadPracticeSources, practiceTopicSources } from "../src/lib/mastery-practice.ts";

const addr = { origin: "https://test.example", kind: "server" } as const;

test("mastery question sources use the upstream workspace, search, and page, then send canonical topic source references", async () => {
  const requests: { url: URL; workspace: string | null; body: unknown }[] = [];
  const api = new TutorClient(addr, null, async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      url, workspace: new Headers(init?.headers).get("X-DeepTutor-Workspace"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (init?.method === "POST") return Response.json({ path_id: "topic-sample" });
    return Response.json({
      items: [{ id: 31, question: "  为什么？\n请举例。 " }, { id: 32, question: "不可用", unreadable: true }],
      total: 40,
      has_more: true,
    });
  });
  api.workspaceId = "workspace-sample";
  const page = await loadPracticeSources(api, "  为什么？  ", 2, new AbortController().signal);
  assert.equal(requests[0].url.pathname, "/api/dashboard/source-library/practice");
  assert.equal(requests[0].url.searchParams.get("search"), "为什么？");
  assert.equal(requests[0].url.searchParams.get("offset"), "24");
  assert.equal(requests[0].workspace, "workspace-sample");
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.items.map(item => item.id), [31]);
  await api.json("/api/mastery-paths/topics", { name: "示例", goal: "练习", sources: practiceTopicSources(page.items) });
  assert.equal(requests[1].workspace, "workspace-sample");
  assert.deepEqual(requests[1].body, {
    name: "示例", goal: "练习",
    sources: [{ kind: "question_bank", source_id: "31", label: "为什么？ 请举例。", excerpt: "为什么？\n请举例。" }],
  });
});

test("an older unpaged dashboard falls back to server-side notebook pagination and does not fetch its index again", async () => {
  const paths: string[] = [];
  const api = new TutorClient(addr, null, async input => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.includes("/dashboard/")) return Response.json({ items: [] });
    return Response.json({ items: [{ id: 1, question: "合成题" }], total: 1 });
  });
  const signal = new AbortController().signal;
  const page = await loadPracticeSources(api, "合成题", 0, signal);
  assert.equal(page.useLegacy, true);
  assert.equal(page.hasMore, false);
  await loadPracticeSources(api, "合成题", 0, signal, page.useLegacy);
  assert.deepEqual(paths, [
    "/api/dashboard/source-library/practice",
    "/api/question-notebook/entries",
    "/api/question-notebook/entries",
  ]);
});

test("a permission error does not retry another source endpoint", async () => {
  let requests = 0;
  const api = new TutorClient(addr, null, async () => {
    requests++;
    return new Response(null, { status: 403 });
  });
  await assert.rejects(loadPracticeSources(api, "", 0, new AbortController().signal),
    error => error instanceof ApiError && error.status === 403);
  assert.equal(requests, 1);
});
