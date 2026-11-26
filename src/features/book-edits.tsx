import { useState } from "react";
import { Text, View } from "react-native";
import { Button, C, Field, Heading, Page, Row, Section, s } from "../ui";
import { ApiError, type TutorClient } from "../lib/client";
import {
  bookEditDecision,
  bookEditRequest,
  bookEditsPath,
  bookStructureActions,
  type BookEditInput,
  type BookEditProposal,
  type BookStructureAction,
} from "../lib/book-edits";
import { Actions, Chips, FormModal, useAction } from "./common";

type ChapterTarget = {
  id: string;
  title: string;
  pageIds: string[];
  contentType: string;
};
type PageTarget = {
  id: string;
  title: string;
  chapter_id?: string;
  content_type?: string;
  parent_page_id?: string;
};

type BookEditsProps = {
  api: TutorClient;
  bookId: string;
  revision: number;
  chapters: ChapterTarget[];
  pages: PageTarget[];
  edits: BookEditProposal[];
  locked: boolean;
  allowStructure: boolean;
  onChanged: () => Promise<void>;
};

function editLabel(edit: BookEditProposal) {
  const name = edit.edit.action;
  const fallback = Object.hasOwn(bookStructureActions, name)
    ? bookStructureActions[name as BookStructureAction]
    : "补充书页内容";
  return edit.edit.title || fallback;
}

export function BookEdits({ api, bookId, revision, chapters, pages, edits, locked, allowStructure, onChanged }: BookEditsProps) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<BookEditProposal | null>(null);
  const action = useAction();
  const endpoint = bookEditsPath(bookId);
  const visible = edits.filter(edit => edit.status === "proposed" || bookEditDecision(edit, revision) === "undo");
  const decision = selected ? bookEditDecision(selected, revision) : undefined;
  const close = () => {
    if (!action.busy) {
      setSelected(null);
      setCreating(false);
    }
  };
  function preview(edit: BookEditInput) {
    void action.run(async () => {
      const proposal = await api.json<BookEditProposal>(`${endpoint}/preview`, edit);
      if (api.isClosed) return;
      setSelected(proposal);
      setCreating(false);
      await onChanged();
    });
  }
  function commit() {
    if (!selected || !decision || locked || api.isClosed || selected.book_id !== bookId) return;
    void action.run(async () => {
      try {
        await api.json(`${endpoint}/${encodeURIComponent(selected.id)}/${decision}`, { expected_revision: revision });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        if (!api.isClosed) await onChanged();
        throw Error("书籍内容或生成状态已变化，请刷新后重新预览。");
      }
      if (api.isClosed) return;
      setSelected(null);
      await onChanged();
    });
  }
  return (
    <>
      {allowStructure ? (
        <Button title="编辑章节与小节" secondary disabled={locked} onPress={() => setCreating(true)} />
      ) : null}
      {locked && (allowStructure || visible.length > 0) ? (
        <Text style={s.muted}>暂停生成后可编辑目录和应用建议。</Text>
      ) : null}
      {visible.length ? (
        <View style={{ gap: 8 }}>
          <Section title="书籍修改" />
          {visible.map(edit => (
            <Row
              key={edit.id}
              title={editLabel(edit)}
              detail={bookEditDecision(edit, revision) === "undo" ? "已应用 · 可以撤销"
                : edit.expected_revision !== revision ? "书籍已更新 · 需重新预览"
                : edit.source_turn_id ? "来自本书对话 · 待确认" : "待确认"}
              icon="create-outline"
              onPress={() => setSelected(edit)}
            />
          ))}
        </View>
      ) : null}
      {creating || selected ? (
        <FormModal onClose={close}>
          <Page>
            <Heading
              title={selected ? "查看修改预览" : "编辑章节与小节"}
              right={<Button title="关闭" compact secondary disabled={action.busy} onPress={close} />}
            />
            {selected ? (
              <>
                <Section title={editLabel(selected)} />
                <Text style={s.muted}>「−」是移除的内容，「+」是新增的内容。</Text>
                <Text selectable style={[s.card, s.text]}>{selected.diff || "此编辑没有可展示的文本差异。"}</Text>
                {!decision ? <Text style={s.muted}>书籍已发生变化，请重新预览后再应用。</Text> : null}
                <Actions>
                  {decision ? (
                    <Button title={decision === "undo" ? "撤销这次修改" : "确认应用"} busy={action.busy}
                      disabled={locked} onPress={commit} />
                  ) : null}
                  <Button title="关闭预览" secondary disabled={action.busy} onPress={close} />
                </Actions>
              </>
            ) : (
              <BookStructureForm chapters={chapters} pages={pages} disabled={action.busy || locked} preview={preview} />
            )}
            {action.error ? <Text style={{ color: C.danger }}>{action.error}</Text> : null}
          </Page>
        </FormModal>
      ) : null}
    </>
  );
}

function BookStructureForm({ chapters, pages, disabled, preview }: {
  chapters: ChapterTarget[];
  pages: PageTarget[];
  disabled: boolean;
  preview: (input: BookEditInput) => void;
}) {
  const editableChapters = chapters.filter(chapter => chapter.id && chapter.contentType !== "overview");
  const editableChapterIds = new Set(editableChapters.map(chapter => chapter.id));
  const outlinePageIds = new Set(editableChapters.flatMap(chapter => chapter.pageIds));
  const editablePages = pages.filter(page => outlinePageIds.has(page.id) &&
    !page.parent_page_id && page.content_type !== "overview");
  const [operation, setOperation] = useState<BookStructureAction>("add_chapter");
  const [chapterId, setChapterId] = useState(editableChapters[0]?.id || "");
  const [pageId, setPageId] = useState(editablePages[0]?.id || "");
  const [title, setTitle] = useState("");
  const [goals, setGoals] = useState("");
  const [position, setPosition] = useState(String(chapters.length + 1));
  const [error, setError] = useState("");
  const add = operation.startsWith("add_");
  const rename = operation.startsWith("rename_");
  const move = operation.startsWith("move_");
  const chapter = editableChapters.find(entry => entry.id === chapterId);
  const page = editablePages.find(entry => entry.id === pageId);
  const needsChapter = operation !== "add_chapter" &&
    (operation.endsWith("_chapter") || operation === "add_page" || operation === "move_page");
  const needsPage = operation.endsWith("_page") && !add;
  function chooseOperation(value: string) {
    if (disabled) return;
    const next = value as BookStructureAction;
    setOperation(next);
    setError("");
    setTitle(next === "rename_chapter" ? chapter?.title || "" : next === "rename_page" ? page?.title || "" : "");
    setPosition(String(next.endsWith("_page") ? (chapter?.pageIds.length || 0) + 1 : chapters.length + 1));
  }
  function chooseChapter(value: string) {
    if (disabled) return;
    setChapterId(value);
    const selected = editableChapters.find(entry => entry.id === value);
    if (operation === "rename_chapter") setTitle(selected?.title || "");
    if (operation === "add_page" || operation === "move_page") setPosition(String((selected?.pageIds.length || 0) + 1));
  }
  function choosePage(value: string) {
    if (disabled) return;
    setPageId(value);
    const selected = editablePages.find(entry => entry.id === value);
    if (operation === "rename_page") setTitle(selected?.title || "");
  }
  function submit() {
    setError("");
    try {
      preview(bookEditRequest(operation, chapter?.id || "", page?.id || "", title, position, goals));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const operations = (Object.entries(bookStructureActions) as [BookStructureAction, string][])
    .filter(([name]) => name === "add_chapter" || (name === "add_page" || name.endsWith("_chapter")
      ? editableChapterIds.size > 0 : editablePages.length > 0));
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.muted}>先查看修改预览。新增的空白小节会在打开时生成。</Text>
      <Chips value={operation} items={operations.map(([value, label]) => ({ value, label }))} onChange={chooseOperation} />
      {needsPage ? (
        <View>
          <Text style={s.label}>小节</Text>
          <Chips value={pageId} items={editablePages.map(p => ({ value: p.id, label: p.title }))} onChange={choosePage} />
        </View>
      ) : null}
      {needsChapter ? (
        <View>
          <Text style={s.label}>{operation === "move_page" ? "移入章节" : "章节"}</Text>
          <Chips value={chapterId} items={editableChapters.map(ch => ({ value: ch.id, label: ch.title }))} onChange={chooseChapter} />
        </View>
      ) : null}
      {add || rename ? <Field label="名称" value={title} onChangeText={setTitle} maxLength={300} editable={!disabled} /> : null}
      {add ? <Field label="学习目标（可选，每行一项）" multiline value={goals} onChangeText={setGoals} editable={!disabled} /> : null}
      {add || move ? <Field label="新位置（从 1 开始）" value={position} onChangeText={setPosition}
        keyboardType="number-pad" maxLength={5} editable={!disabled} /> : null}
      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
      <Button title="预览修改" disabled={disabled} onPress={submit} />
    </View>
  );
}
