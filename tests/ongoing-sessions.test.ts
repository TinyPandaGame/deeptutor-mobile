import { test } from "node:test";
import assert from "node:assert/strict";
import { TutorClient } from "../src/lib/client.ts";
import { loadTaskOverview } from "../src/lib/ongoing-sessions.ts";

test("uses current workspace session summaries and discovers an older waiting task", async () => {
  const calls: string[] = [];
  const firstPage = [
    { id: "running", title: "正在出题", status: "running", active_turn_id: "turn-1" },
    { id: "completed", title: "已生成的练习", status: "completed", active_turn_id: "" },
    { id: "stopped", title: "已停止的任务", status: "cancelled", active_turn_id: "" },
    ...Array.from({ length: 197 }, (_, i) => ({ id: `idle-${i}`, title: "旧聊天", status: "idle" })),
  ];
  const api = new TutorClient(
    { origin: "https://study.example.com", kind: "server" },
    null,
    async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      assert.equal(url.pathname, "/api/sessions");
      assert.equal(url.searchParams.get("all_workspaces"), null);
      assert.equal(headers.get("x-deeptutor-workspace"), "math");
      assert.equal(headers.get("authorization"), "Bearer fixture-token");
      calls.push(url.search);
      if (calls.length === 1) return Response.json({ sessions: firstPage });
      if (calls.length === 2) return Response.json({
        sessions: [
          { id: "waiting", title: "请选一题", status: "waiting_input", active_turn_id: "turn-2" },
          firstPage[0],
        ],
      });
      return Response.json({ sessions: [
        { id: "moved", title: "电脑刚发起", status: "queued", active_turn_id: "turn-3" },
        ...firstPage,
      ].slice(0, 200) });
    },
  );
  api.workspaceId = "math";
  api.token = "fixture-token";
  const tasks = await loadTaskOverview(api, new AbortController().signal);
  assert.deepEqual(calls, ["?limit=200&offset=0", "?limit=200&offset=180", "?limit=200&offset=0"]);
  assert.deepEqual(tasks.active.map(task => [task.id, task.label]), [
    ["waiting", "等你回答"], ["moved", "排队中"], ["running", "正在生成"],
  ]);
  assert.deepEqual(tasks.recent.map(task => [task.id, task.label]), [
    ["completed", "已完成"], ["stopped", "已停止"],
  ]);
});
