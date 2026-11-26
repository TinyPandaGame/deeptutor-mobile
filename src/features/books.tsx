import { useCallback, useRef, useState } from "react";
import { ExportFile } from "./export";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "../lib/auth";
import { useResource, useJobPolling } from "../lib/resources";
import { Button, C, Heading, Page, Row, Section, s } from "../ui";
import { gradePresets } from "../lib/study-presets";
import {
  Actions,
  Editor,
  Prose,
  Refresh,
  ResourceState,
  SmallAction,
  ask,
  confirmDelete,
  enc,
  feature,
  useAction,
} from "./common";
import { Content, Data, string, array, object } from "./content";
import { BookEdits } from "./book-edits";
import { bookEditsPath, canGenerateOpenedBookPage, type BookEditProposal } from "../lib/book-edits";
const blockNames: Record<string, string> = {
  text: "正文",
  callout: "重点提示",
  quiz: "练习题",
  user_note: "我的笔记",
  figure: "图示",
  interactive: "互动演示",
  animation: "动画",
  code: "代码",
  timeline: "时间线",
  flash_cards: "记忆卡",
  deep_dive: "深入讲解",
  section: "章节正文",
  concept_graph: "知识关系图",
  diagnostic: "诊断题",
  pretest: "课前测试",
  retrieval_practice: "回忆练习",
  error_diagnosis: "错因分析",
  module_test: "章节测验",
  progress_dashboard: "学习进度",
};
type Block = {
  id: string;
  type: string;
  status: string;
  title: string;
  payload: Data;
  error?: string;
};
type BookPage = {
  id: string;
  title: string;
  status: string;
  learning_objectives: string[];
  blocks: Block[];
  chapter_id?: string;
  content_type?: string;
  parent_page_id?: string;
};
type Book = {
  id: string;
  title: string;
  description: string;
  status: string;
  revision: number;
  proposal?: Data;
  can_edit?: boolean;
  can_delete?: boolean;
  page_count: number;
  metadata?: { page_chat_sessions?: Record<string, string> };
};
const statuses: Record<string, string> = {
  draft: "方案待确认",
  spine_ready: "目录已生成",
  compiling: "正在生成内容",
  paused: "已暂停",
  ready: "可以开始阅读",
  error: "生成遇到问题",
  pending: "等待生成",
  planning: "正在规划",
  generating: "正在生成",
  partial: "部分内容已完成",
};
export function Books({ id = "", page = "" }: { id?: string; page?: string }) {
  const { api } = useAuth();
  const list = useResource<{ books: Book[]; can_create: boolean }>(
    "/api/books",
  );
  const r = useResource<{
    book: Book;
    spine: Data | null;
    pages: BookPage[];
    generation: Data;
    progress: Data;
  }>(id ? `/api/books/${enc(id)}?include_blocks=false` : null);
  const p = useResource<{ page: BookPage }>(
    id && page ? `/api/books/${enc(id)}/pages/${enc(page)}` : null,
  );
  const [editor, setEditor] = useState<string | Block>("");
  const [spineDraft, setSpineDraft] = useState<Data | null>(null);
  const [chapterEdit, setChapterEdit] = useState<Data | null>(null);
  const [blockAction, setBlockAction] = useState<{
    mode: string;
    block?: Block;
  } | null>(null);
  const blockTypes = useResource<{
    block_types: { value: string; planner_default: boolean }[];
  }>("/api/books/block-types");
  const [selectedTypes, setSelectedTypes] = useState<string[] | null>(null);
  const action = useAction();
  const b = r.data?.book;
  const current = p.data?.page;
  const edits = useResource<{ edits: BookEditProposal[] }>(
    b?.can_edit && r.data?.spine && !["draft", "spine_ready"].includes(b.status)
      ? bookEditsPath(id, page || undefined)
      : null,
  );
  const editsAvailable = Array.isArray(edits.data?.edits);
  const autoRequested = useRef(new Set<string>());
  useJobPolling(
    r.reload,
    !!b && ["compiling", "planning", "generating"].includes(b.status),
  );
  useJobPolling(
    p.reload,
    !!page &&
      !!current &&
      ["pending", "planning", "generating"].includes(current.status),
  );
  const spine = spineDraft || r.data?.spine;
  const chosenTypes =
    selectedTypes ||
    blockTypes.data?.block_types
      .filter((t) => t.planner_default)
      .map((t) => t.value) ||
    [];
  function changeChapters(chapters: unknown[]) {
    setSpineDraft({
      ...spine,
      chapters: chapters.map((x, i) => ({ ...object(x), order: i })),
    });
  }
  const { reload: reloadBook } = r;
  const { reload: reloadPage } = p;
  const { reload: reloadEdits } = edits;
  const revision = b?.revision;
  const onBookChanged = useCallback(async () => {
    const reads = [reloadBook(), reloadEdits()];
    if (page) reads.push(reloadPage());
    await Promise.all(reads);
  }, [reloadBook, reloadPage, reloadEdits, page]);
  const call = useCallback(async (operation: string, body: Data = {}) => {
    if (!api || !revision) return;
    await api.request(
      `/api/books/${operation}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: id,
          expected_revision: revision,
          ...body,
        }),
      },
      true,
      180000,
    );
    if (!api.isClosed) await onBookChanged();
  }, [api, id, revision, onBookChanged]);
  const bookStatus = b?.status || "";
  const mayAutoGenerate = editsAvailable && !!current &&
    canGenerateOpenedBookPage(bookStatus, b?.can_edit === true, current);
  useFocusEffect(
    useCallback(() => {
      if (!api || api.isClosed || !id || !page || !revision || !mayAutoGenerate || action.busy) return;
      const key = JSON.stringify([api.scope, id, page]);
      if (autoRequested.current.has(key)) return;
      autoRequested.current.add(key);
      // Opening a pending page starts generation once. The server coalesces
      // this request with a background job, and retry remains explicit.
      void action.run(() => call("compile-page", { page_id: page, force: false }));
    }, [api, id, page, revision, mayAutoGenerate, action, call]),
  );
  const bookEdits = api && b?.can_edit && editsAvailable ? (
    <BookEdits
      key={JSON.stringify([api.scope, id, page])}
      api={api}
      bookId={id}
      revision={b.revision}
      allowStructure={!page}
      locked={b.status === "compiling" || (r.data?.pages.some(pg => ["planning", "generating"].includes(pg.status)) ?? false)}
      chapters={array(r.data?.spine?.chapters).map(item => {
        const chapter = object(item);
        return {
          id: string(chapter.id),
          title: string(chapter.title),
          pageIds: array(chapter.page_ids).map(string),
          contentType: string(chapter.content_type),
        };
      })}
      pages={r.data?.pages || []}
      edits={edits.data?.edits || []}
      onChanged={onBookChanged}
    />
  ) : null;
  return (
    <Page>
      <Heading
        title={current?.title || b?.title || "学习书籍"}
        back
        right={
          <Refresh
            onPress={() => {
              void (id ? onBookChanged() : list.reload());
            }}
          />
        }
      />
      <ResourceState
        resource={id ? r : list}
        empty={!id && !list.data?.books.length}
      />
      {!id ? (
        <>
          {list.data?.can_create !== false ? (
            <Button
              title="生成一本学习书"
              onPress={() => setEditor("create")}
            />
          ) : null}
          {list.data?.books.map((b) => (
            <Row
              key={b.id}
              title={b.title || "我的学习书"}
              detail={`${statuses[b.status] || b.status} · ${b.page_count || 0} 页`}
              icon="book-outline"
              onPress={() => feature("books", b.id)}
            />
          ))}
        </>
      ) : b ? (
        <>
          <Text style={s.tag}>{statuses[b.status] || b.status}</Text>
          <Prose text={b.description} />
          {!page ? (
            <>
              <Section title="学习方案" />
              <Content value={b.proposal} />
              {b.status === "draft" && b.can_edit ? (
                <Actions>
                  <Button
                    title="确认方案，生成目录"
                    busy={action.busy}
                    onPress={() =>
                      void action.run(() => call("confirm-proposal"))
                    }
                  />
                  <Button
                    title="修改学习方案"
                    secondary
                    onPress={() => setEditor("proposal")}
                  />
                </Actions>
              ) : null}
              {r.data?.spine ? (
                <>
                  <Section title="目录" />
                  {array(spine?.chapters).map((x, index) => {
                    const chapter = object(x);
                    return (
                      <View key={string(chapter.id)} style={s.card}>
                        <Text style={s.h2}>
                          {index + 1}. {string(chapter.title)}
                        </Text>
                        <Prose text={chapter.summary} />
                        {array(chapter.learning_objectives).map((v, i) => (
                          <Prose key={i} text={`• ${String(v)}`} />
                        ))}
                        {b.status === "spine_ready" && b.can_edit ? (
                          <View
                            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                          >
                            <SmallAction
                              title="修改章节"
                              onPress={() => setChapterEdit(chapter)}
                            />
                            {index > 0 ? (
                              <SmallAction
                                title="上移"
                                onPress={() => {
                                  const a = [...array(spine?.chapters)];
                                  [a[index - 1], a[index]] = [
                                    a[index],
                                    a[index - 1],
                                  ];
                                  changeChapters(a);
                                }}
                              />
                            ) : null}
                            <SmallAction
                              title="移除章节"
                              onPress={() =>
                                changeChapters(
                                  array(spine?.chapters).filter(
                                    (_, i) => i !== index,
                                  ),
                                )
                              }
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {b.status === "spine_ready" && b.can_edit ? (
                    <>
                      <SmallAction
                        title="添加章节"
                        onPress={() =>
                          setChapterEdit({
                            id: `ch_mobile_${Date.now()}`,
                            title: "",
                            learning_objectives: [],
                            summary: "",
                            content_type: "theory",
                          })
                        }
                      />
                      <Section title="本书包含哪些内容" />
                      <Text style={s.muted}>
                        图片、音频和动画等内容还需要学习服务配置对应的生成服务。
                      </Text>
                      {blockTypes.data?.block_types.map((t) => (
                        <Row
                          key={t.value}
                          title={blockNames[t.value] || "学习内容"}
                          suffix={
                            chosenTypes.includes(t.value) ? "已选" : "选择"
                          }
                          onPress={() =>
                            setSelectedTypes(
                              chosenTypes.includes(t.value)
                                ? chosenTypes.filter((x) => x !== t.value)
                                : [...chosenTypes, t.value],
                            )
                          }
                        />
                      ))}
                      <Button
                        title="确认目录，开始生成"
                        busy={action.busy}
                        disabled={
                          !array(spine?.chapters).length || !chosenTypes.length
                        }
                        onPress={() =>
                          void action.run(() =>
                            call("confirm-spine", {
                              auto_compile: true,
                              spine,
                              block_types: chosenTypes,
                            }),
                          )
                        }
                      />
                    </>
                  ) : null}
                </>
              ) : null}
              {bookEdits}
              <Section title="章节与内容" />
              {r.data?.pages.map((pg) => (
                <Row
                  key={pg.id}
                  title={pg.title}
                  detail={statuses[pg.status] || pg.status}
                  onPress={() => {
                    void api?.json("/api/books/progress/visit", {
                      book_id: id,
                      page_id: pg.id,
                    });
                    feature("books", id, { page: pg.id });
                  }}
                />
              ))}
            </>
          ) : (
            <>
              <ResourceState resource={p} />
              {current?.learning_objectives.map((g, i) => (
                <Text key={i} style={s.muted}>
                  • {g}
                </Text>
              ))}
              <Actions>
                <Button
                  title="讲解这一章"
                  onPress={() =>
                    api &&
                    ask(api, "请引导我理解这一章的内容。", {
                      book_references: [{ book_id: id, page_ids: [page] }],
                    })
                  }
                />
                {b.metadata?.page_chat_sessions?.[page] ? (
                  <Button title="继续本节对话" secondary onPress={() => router.push({
                    pathname: "/chat/[id]",
                    params: { id: b.metadata?.page_chat_sessions?.[page] || "" },
                  })} />
                ) : null}
                {editsAvailable && current && b.can_edit ? (
                  <Button title="请 AI 提议补充这一节" secondary onPress={() => {
                    if (api) ask(api, "请为这一节提出一条补充建议，生成修改预览，等我确认后再应用。", {
                      book_references: [{ book_id: id, page_ids: [page] }],
                    });
                  }} />
                ) : null}
                <Button
                  title="收藏 / 取消收藏"
                  secondary
                  busy={action.busy}
                  onPress={() =>
                    void action.run(() =>
                      call("progress/bookmark", { page_id: page }),
                    )
                  }
                />
              </Actions>
              {bookEdits}
              {current?.blocks.map((block) => (
                <View
                  key={block.id}
                  style={[s.card, { marginVertical: 8, gap: 12 }]}
                >
                  <Text style={s.h2}>{block.title}</Text>
                  {block.status !== "ready" ? (
                    <Text style={s.muted}>
                      {statuses[block.status] || block.status}
                    </Text>
                  ) : null}
                  <Content
                    value={block.payload}
                    onAnswer={async (q, answer) => {
                      await call("quiz-attempt", {
                        page_id: page,
                        block_id: block.id,
                        question_id: string(q.question_id),
                        user_answer: answer,
                        submission_id: `mobile_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                      });
                    }}
                  />
                  {block.error ? (
                    <Text style={{ color: C.danger }}>{block.error}</Text>
                  ) : null}
                  {b.can_edit ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      <SmallAction
                        title="重新生成"
                        onPress={() =>
                          void action.run(() =>
                            call("regenerate-block", {
                              page_id: page,
                              block_id: block.id,
                            }),
                          )
                        }
                      />
                      {["text", "user_note", "callout"].includes(block.type) ? (
                        <SmallAction
                          title="编辑"
                          onPress={() => setEditor(block)}
                        />
                      ) : null}
                      <SmallAction
                        title="删除内容块"
                        onPress={() =>
                          confirmDelete("这一内容块", () =>
                            call("delete-block", {
                              page_id: page,
                              block_id: block.id,
                            }),
                          )
                        }
                      />
                      <SmallAction
                        title="调整顺序"
                        onPress={() => setBlockAction({ mode: "move", block })}
                      />
                      <SmallAction
                        title="更换类型"
                        onPress={() => setBlockAction({ mode: "type", block })}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
              {b.can_edit ? (
                <Actions>
                  <Button
                    title="添加学习内容"
                    secondary
                    onPress={() => setBlockAction({ mode: "insert" })}
                  />
                  <Button
                    title="添加我的笔记"
                    secondary
                    onPress={() => setEditor("note")}
                  />
                  <Button
                    title="补充讲解"
                    secondary
                    onPress={() => setEditor("supplement")}
                  />
                  <Button
                    title="深入学习一个问题"
                    secondary
                    onPress={() => setEditor("deep-dive")}
                  />
                  <Button
                    title="生成 / 重试本章"
                    secondary
                    busy={action.busy}
                    onPress={() =>
                      void action.run(() =>
                        call("compile-page", { page_id: page }),
                      )
                    }
                  />
                </Actions>
              ) : null}
            </>
          )}
          <ExportFile
            path={`/api/books/${enc(id)}/export`}
            filename={`${b.title}.md`}
            mime="text/markdown"
          />
          {b.can_edit ? (
            <Actions>
              {b.status === "compiling" ? (
                <Button
                  title="暂停生成"
                  secondary
                  busy={action.busy}
                  onPress={() => void action.run(() => call("pause"))}
                />
              ) : b.status === "paused" || b.status === "error" ? (
                <Button
                  title="继续生成"
                  busy={action.busy}
                  onPress={() => void action.run(() => call("resume"))}
                />
              ) : null}
              {b.can_delete ? (
                <SmallAction
                  title="删除学习书籍"
                  onPress={() =>
                    confirmDelete("这本书", async () => {
                      await api?.request(`/api/books/${enc(id)}`, {
                        method: "DELETE",
                      });
                      router.back();
                    })
                  }
                />
              ) : null}
            </Actions>
          ) : null}
        </>
      ) : null}
      {action.error ? (
        <Text style={{ color: C.danger }}>{action.error}</Text>
      ) : null}
      {chapterEdit ? (
        <Editor
          title="编辑章节"
          fields={[
            {
              key: "title",
              label: "章节名称",
              value: string(chapterEdit.title),
              required: true,
            },
            {
              key: "summary",
              label: "本章讲什么",
              value: string(chapterEdit.summary),
              multiline: true,
            },
            {
              key: "objectives",
              label: "学习目标（每行一项）",
              value: array(chapterEdit.learning_objectives).join("\n"),
              multiline: true,
            },
          ]}
          onClose={() => setChapterEdit(null)}
          onSave={async (v) => {
            const next = {
              ...chapterEdit,
              title: v.title,
              summary: v.summary,
              learning_objectives: v.objectives.split("\n").filter(Boolean),
            };
            const exists = array(spine?.chapters).some(
              (x) => object(x).id === chapterEdit.id,
            );
            changeChapters(
              exists
                ? array(spine?.chapters).map((x) =>
                    object(x).id === chapterEdit.id ? next : x,
                  )
                : [...array(spine?.chapters), next],
            );
          }}
        />
      ) : null}
      {blockAction ? (
        <Editor
          title={
            blockAction.mode === "move"
              ? "调整内容顺序"
              : blockAction.mode === "type"
                ? "更换内容类型"
                : "添加学习内容"
          }
          fields={
            blockAction.mode === "move"
              ? [
                  {
                    key: "position",
                    label: "移动到第几项",
                    value: String(
                      (current?.blocks.findIndex(
                        (b) => b.id === blockAction.block?.id,
                      ) || 0) + 1,
                    ),
                    number: true,
                    required: true,
                  },
                ]
              : [
                  {
                    key: "type",
                    label: "内容类型",
                    value: blockAction.block?.type || "text",
                    options: Object.entries(blockNames).map(
                      ([value, label]) => ({ value, label }),
                    ),
                  },
                  { key: "instruction", label: "生成要求", multiline: true },
                ]
          }
          onClose={() => setBlockAction(null)}
          onSave={async (v) => {
            if (blockAction.mode === "move")
              await call("move-block", {
                page_id: page,
                block_id: blockAction.block?.id,
                new_position: Math.max(
                  0,
                  Math.min(
                    (current?.blocks.length || 1) - 1,
                    Number(v.position) - 1,
                  ),
                ),
              });
            else if (blockAction.mode === "type")
              await call("change-block-type", {
                page_id: page,
                block_id: blockAction.block?.id,
                new_type: v.type,
                params_override: { instruction: v.instruction },
              });
            else
              await call("insert-block", {
                page_id: page,
                block_type: v.type,
                params: { instruction: v.instruction },
                compile_now: true,
              });
          }}
        />
      ) : null}
      {editor ? (
        <Editor
          title={
            typeof editor === "object"
              ? "编辑内容"
              : editor === "create"
                ? "生成学习书"
                : editor === "proposal"
                  ? "修改学习方案"
                  : editor === "note"
                    ? "我的笔记"
                    : "想进一步了解什么"
          }
          fields={
            editor === "create"
              ? [
                  {
                    key: "user_intent",
                    label: "学习目标、年级和范围",
                    multiline: true,
                    required: true,
                  },
                ]
              : editor === "proposal"
                ? [
                    {
                      key: "title",
                      label: "书名",
                      value: string(b?.proposal?.title),
                      required: true,
                    },
                    {
                      key: "description",
                      label: "内容简介",
                      value: string(b?.proposal?.description),
                      multiline: true,
                    },
                    {
                      key: "scope",
                      label: "学习范围",
                      value: string(b?.proposal?.scope),
                      multiline: true,
                    },
                    {
                      key: "target_level",
                      label: "适合年级",
                      presets: gradePresets,
                      value: string(b?.proposal?.target_level),
                    },
                  ]
                : typeof editor === "object"
                  ? [
                      { key: "title", label: "标题", value: editor.title },
                      {
                        key: "body",
                        label: "内容",
                        value: string(editor.payload.body),
                        multiline: true,
                      },
                    ]
                  : [
                      {
                        key: "topic",
                        label: editor === "note" ? "笔记内容" : "问题或主题",
                        multiline: true,
                        required: true,
                      },
                    ]
          }
          onClose={() => setEditor("")}
          onSave={async (v) => {
            if (!api) return;
            if (editor === "create") {
              const created = await api.request<{ book: Book }>(
                "/api/books",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ...v,
                    language: "zh",
                    fallback_language: "zh",
                    depth: "standard",
                  }),
                },
                true,
                180000,
              );
              feature("books", created.book.id);
            } else if (editor === "proposal") {
              await call("confirm-proposal", {
                proposal: { ...b?.proposal, ...v },
              });
            } else if (typeof editor === "object") {
              await call("update-block", {
                page_id: page,
                block_id: editor.id,
                ...v,
              });
            } else if (editor === "note") {
              await call("insert-block", {
                page_id: page,
                block_type: "user_note",
                params: { body: v.topic },
                compile_now: true,
              });
            } else {
              await call(editor, {
                page_id: page,
                parent_page_id: page,
                topic: v.topic,
              });
            }
          }}
        />
      ) : null}
    </Page>
  );
}
