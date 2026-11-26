import assert from "node:assert/strict";
import { test } from "node:test";
import { activeSessionTurn, messagesForTurnReplay, reachedReplayHead } from "../src/lib/active-turn.ts";

test("1.7.4 detail supplies the waiting turn and its replay cursor", () => {
  const active = {
    id: "original-turn",
    status: "waiting_input",
    last_seq: 54,
    assistant_message_id: 12,
  };
  assert.deepEqual(activeSessionTurn({ active_turns: [active] }), active);
  assert.equal(reachedReplayHead(active, { type: "wait_for_input", turn_id: active.id }, 30), false);
  assert.equal(reachedReplayHead(active, { type: "wait_for_input", turn_id: active.id }, 54), true);
  assert.equal(reachedReplayHead(active, { type: "done", turn_id: "other-turn" }, 55), false);
  assert.equal(reachedReplayHead(active, { type: "done", turn_id: active.id }, 55), true);
});

test("replaying the same active turn preserves other messages, including the original prompt", () => {
  const messages = [
    { id: "10", role: "assistant" },
    { id: "11", role: "user" },
    { id: "12", role: "assistant" },
  ];
  assert.deepEqual(messagesForTurnReplay(messages, {
    id: "original-turn", status: "running", assistant_message_id: 12,
  }), messages.slice(0, 2));
  assert.strictEqual(messagesForTurnReplay(messages, undefined), messages);
});

test("a fresh empty task list wins over a stale summary, and older response forms still work", () => {
  const stale = { active_turn_id: "prior-turn", status: "running" };
  assert.equal(activeSessionTurn({ ...stale, active_turns: [] }), undefined);
  assert.equal(activeSessionTurn({ ...stale, status: "cancelled" }), undefined);
  assert.equal(activeSessionTurn(stale)?.id, "prior-turn");
  assert.equal(activeSessionTurn({ active_turn: { id: "legacy", status: "queued" } })?.id, "legacy");
});
