export const bookStructureActions = {
  add_chapter: "添加章节",
  rename_chapter: "重命名章节",
  move_chapter: "移动章节",
  delete_chapter: "删除章节",
  add_page: "添加小节",
  rename_page: "重命名小节",
  move_page: "移动小节",
  delete_page: "删除小节",
} as const;

export type BookStructureAction = keyof typeof bookStructureActions;
export type BookEditInput = {
  action: BookStructureAction;
  chapter_id?: string;
  page_id?: string;
  title?: string;
  position?: number;
  learning_objectives?: string[];
};
export type BookEditProposal = {
  id: string;
  book_id: string;
  page_id: string;
  expected_revision: number;
  applied_revision?: number | null;
  status: string;
  source_turn_id?: string;
  diff: string;
  edit: { action: string; title?: string };
};

export function bookEditsPath(bookId: string, pageId?: string) {
  return `/api/books/${encodeURIComponent(bookId)}/edits` +
    (pageId ? `?page_id=${encodeURIComponent(pageId)}` : "");
}

export function bookEditRequest(
  action: BookStructureAction,
  chapterId: string,
  pageId: string,
  title: string,
  position: string,
  learningObjectives: string,
): BookEditInput {
  const edit: BookEditInput = { action };
  const adding = action.startsWith("add_");
  const needsChapter = action !== "add_chapter" && (action.endsWith("_chapter") || action === "add_page" || action === "move_page");
  const needsPage = action.endsWith("_page") && !adding;
  const needsTitle = adding || action.startsWith("rename_");
  const needsPosition = adding || action.startsWith("move_");
  if (needsChapter) {
    if (!chapterId) throw Error("请先选择章节。");
    edit.chapter_id = chapterId;
  }
  if (needsPage) {
    if (!pageId) throw Error("请先选择小节。");
    edit.page_id = pageId;
  }
  if (needsTitle) {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 300) throw Error("请输入 1 到 300 字的名称。");
    edit.title = cleanTitle;
  }
  if (needsPosition) {
    const entered = position.trim();
    const value = Number(entered);
    if (!/^\d+$/.test(entered) || value < 1 || value > 10001) {
      throw Error("位置请填写 1 到 10001 之间的整数。");
    }
    edit.position = value - 1;
  }
  if (adding) {
    const objectives = learningObjectives.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    if (objectives.length > 30) throw Error("学习目标最多填写 30 项。");
    if (objectives.length) edit.learning_objectives = objectives;
  }
  return edit;
}

export function bookEditDecision(proposal: BookEditProposal, revision: number) {
  if (!Number.isInteger(revision) || revision < 1) return;
  if (proposal.status === "proposed" && proposal.expected_revision === revision) return "apply";
  if (proposal.status === "applied" && proposal.applied_revision === revision) return "undo";
}

export function canGenerateOpenedBookPage(
  bookStatus: string,
  editable: boolean,
  page: { status: string; blocks: unknown[] },
) {
  return editable && ["ready", "compiling", "partial"].includes(bookStatus) &&
    page.status === "pending" && page.blocks.length === 0;
}
