import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookEditDecision,
  bookEditRequest,
  bookEditsPath,
  canGenerateOpenedBookPage,
  type BookEditProposal,
} from "../src/lib/book-edits.ts";

test("book edit requests convert one-based positions and keep source and destination separate", () => {
  assert.deepEqual(bookEditRequest("move_page", "destination", "original-page", "ignored", "3", ""), {
    action: "move_page",
    chapter_id: "destination",
    page_id: "original-page",
    position: 2,
  });
  assert.deepEqual(bookEditRequest("rename_page", "", "original-page", " 一位数乘法 ", "", ""), {
    action: "rename_page",
    page_id: "original-page",
    title: "一位数乘法",
  });
  assert.deepEqual(bookEditRequest("add_page", "chapter", "", "练习", "1", " 目标甲\n\n目标乙"), {
    action: "add_page",
    chapter_id: "chapter",
    title: "练习",
    position: 0,
    learning_objectives: ["目标甲", "目标乙"],
  });
  assert.throws(() => bookEditRequest("delete_page", "", "", "", "", ""), /选择小节/);
  assert.throws(() => bookEditRequest("move_page", "chapter", "page", "", "1e2", ""), /整数/);
  assert.equal(bookEditsPath("book/other", "section&other"), "/api/books/book%2Fother/edits?page_id=section%26other");
});

test("only a preview at the current revision can apply and only the last applied revision can undo", () => {
  const proposal: BookEditProposal = {
    id: "pending-edit",
    book_id: "a-book",
    page_id: "",
    expected_revision: 7,
    status: "proposed",
    diff: "+新章节",
    edit: { action: "add_chapter" },
  };
  assert.equal(bookEditDecision(proposal, 7), "apply");
  assert.equal(bookEditDecision(proposal, 8), undefined);
  const applied = { ...proposal, status: "applied", applied_revision: 8 };
  assert.equal(bookEditDecision(applied, 8), "undo");
  assert.equal(bookEditDecision(applied, 9), undefined);
  assert.equal(bookEditDecision({ ...applied, status: "undone" }, 8), undefined);
});

test("opening an empty pending book page never resumes paused work or overwrites existing blocks", () => {
  const emptyPending = { status: "pending", blocks: [] };
  assert.equal(canGenerateOpenedBookPage("ready", true, emptyPending), true);
  assert.equal(canGenerateOpenedBookPage("ready", false, emptyPending), false);
  assert.equal(canGenerateOpenedBookPage("paused", true, emptyPending), false);
  assert.equal(canGenerateOpenedBookPage("ready", true, { status: "ready", blocks: [] }), false);
  assert.equal(canGenerateOpenedBookPage("ready", true, { status: "pending", blocks: [{}] }), false);
});
