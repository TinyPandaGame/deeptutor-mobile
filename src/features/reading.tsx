import { useState } from "react";
import { ReadAloud } from './read-aloud';
import { Alert, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../lib/auth";
import { useResource, useJobPolling } from "../lib/resources";
import { Button, C, Field, Heading, Page, Row, Section, s } from "../ui";
import {
  Actions,
  Chips,
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
import { Pdf } from "./pdf";
import { ExportFile } from "./export";
import { Content } from "./content";
import { materialText } from "../lib/learning-records";
type Material = {
  material_id: string;
  title: string;
  filename: string;
  unit_count: number;
  unit: string;
  render_mode: string;
  has_raw_view?: boolean;
  revision: number;
  status?: string;
  error_detail?: string;
};
type Workspace = {
  workspace_id: string;
  title: string;
  description: string;
  active_material_id: string;
  tabs: { material: Material; tab_order: number }[];
};
type Annotation = {
  annotation_id: string;
  locator: number;
  kind: "highlight" | "underline" | "note" | "citation";
  color: string;
  quote: string;
  note: string;
};
type Bookmark = { bookmark_id: string; locator: number; label: string };
const base = "/api/reading";
export function Reading({
  id = "",
  material = "",
}: {
  id?: string;
  material?: string;
}) {
  if (material) return <Reader key={material} id={material} workspace={id} />;
  if (id) return <Collection key={id} id={id} />;
  return <Library />;
}
function Library() {
  const { api } = useAuth();
  const groups = useResource<{ workspaces: Workspace[] }>(base + "/workspaces");
  const materials = useResource<{ materials: Material[] }>(
    base + "/library/materials",
  );
  const [tab, setTab] = useState("groups");
  useJobPolling(
    materials.reload,
    !!materials.data?.materials.some(
      (m) => m.status === "queued" || m.status === "processing",
    ),
  );
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState("");
  const action = useAction();
  return (
    <Page>
      <Heading
        title="阅读与教材"
        sub="把教材带在身边，读到哪里就问到哪里"
        back
        right={
          <Refresh
            onPress={() => {
              void groups.reload();
              void materials.reload();
            }}
          />
        }
      />
      <Actions>
        <Button
          title="添加教材或文档"
          icon="add-outline"
          onPress={() => router.push("/add-material")}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <SmallAction title="新建资料组" onPress={() => setEditor("group")} />
          <SmallAction title="导入网页链接" onPress={() => setEditor("url")} />
        </View>
      </Actions>
      <Chips
        value={tab}
        onChange={setTab}
        items={[
          { value: "groups", label: "资料组" },
          { value: "materials", label: "全部资料" },
        ]}
      />
      <Field label="搜索资料" value={search} onChangeText={setSearch} />
      <Section title={tab === "groups" ? "我的资料组" : "我的教材"} />
      <ResourceState
        resource={tab === "groups" ? groups : materials}
        empty={
          tab === "groups"
            ? !groups.data?.workspaces.length
            : !materials.data?.materials.length
        }
      />
      {tab === "groups"
        ? groups.data?.workspaces
            .filter((g) => g.title.includes(search))
            .map((g) => (
              <Row
                key={g.workspace_id}
                title={g.title}
                detail={`${g.tabs?.length || 0} 份资料 · ${g.description || "一起阅读、讨论和整理"}`}
                icon="albums-outline"
                onPress={() => feature("reading", g.workspace_id)}
              />
            ))
        : materials.data?.materials
            .filter((m) => (m.title || m.filename).includes(search))
            .map((m) => (
              <Row
                key={m.material_id}
                title={m.title || m.filename}
                detail={
                  m.status && m.status !== "ready"
                    ? {
                        queued: "等待解析",
                        processing: "正在解析",
                        failed: "解析失败，点击重试",
                      }[m.status] || "正在处理"
                    : `${m.unit_count || 0} 个阅读单元`
                }
                onPress={() => {
                  if (m.status === "failed")
                    Alert.alert(
                      "资料解析未完成",
                      "重试会继续处理原文件，不会重复上传。",
                      [
                        { text: "取消", style: "cancel" },
                        {
                          text: "重试",
                          onPress: () =>
                            void action.run(async () => {
                              await api?.json(
                                base +
                                  "/materials/" +
                                  enc(m.material_id) +
                                  "/retry",
                                {},
                              );
                              await materials.reload();
                            }),
                        },
                      ],
                    );
                  else if (m.status && m.status !== "ready")
                    Alert.alert("资料正在整理", "稍后刷新资料列表查看进度。");
                  else feature("reading", "", { material: m.material_id });
                }}
              />
            ))}
      {action.error ? (
        <Text style={{ color: C.danger }}>{action.error}</Text>
      ) : null}
      {editor ? (
        <Editor
          title={editor === "group" ? "新建资料组" : "导入网页"}
          fields={
            editor === "group"
              ? [
                  { key: "title", label: "资料组名称", required: true },
                  { key: "description", label: "说明", multiline: true },
                ]
              : [
                  {
                    key: "urls",
                    label: "网页地址（每行一个）",
                    multiline: true,
                    required: true,
                  },
                ]
          }
          onClose={() => setEditor("")}
          onSave={async (v) => {
            if (!api) return;
            if (editor === "group") {
              const r = await api.json<{ workspace: Workspace }>(
                base + "/workspaces",
                v,
              );
              setEditor("");
              feature("reading", r.workspace.workspace_id);
            } else {
              const urls = v.urls.split(/\s+/).filter(Boolean);
              if (urls.some((u) => !/^https?:\/\//i.test(u)))
                throw new Error("请输入完整的 http 或 https 地址。");
              await api.json(base + "/library/import-urls", { urls });
              Alert.alert("已开始导入", "资料解析完成后会出现在资料库里。");
              await materials.reload();
            }
          }}
        />
      ) : null}
    </Page>
  );
}
function Collection({ id }: { id: string }) {
  const { api } = useAuth();
  const path = base + "/workspaces/" + enc(id);
  const r = useResource<{
    workspace: Workspace;
    sessions: { session_id: string; title: string }[];
  }>(path);
  const library = useResource<Material[]>(base + "/materials");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [organized, setOrganized] = useState("");
  const [capture, setCapture] = useState(false);
  const notebooks = useResource<{ notebooks: { id: string; name: string }[] }>(
    "/api/notebooks",
  );
  const action = useAction();
  const w = r.data?.workspace;
  return (
    <Page>
      <Heading
        title={w?.title || "资料组"}
        back
        right={<Refresh onPress={r.reload} />}
      />
      <ResourceState resource={r} />
      {w ? (
        <>
          <Text style={s.muted}>
            {w.description || "这个资料组中的内容可以一起阅读和提问。"}
          </Text>
          <Actions>
            <Button title="加入已有资料" onPress={() => setAdding((v) => !v)} />
            <Button
              title="新建阅读对话"
              busy={action.busy}
              secondary
              onPress={() =>
                void action.run(async () => {
                  if (!api) return;
                  const created = await api.json<{
                    session: { session_id: string };
                  }>(path + "/sessions", {
                    title: "阅读讨论",
                    active_material_id: w.active_material_id,
                  });
                  router.push({
                    pathname: "/chat/[id]",
                    params: { id: created.session.session_id },
                  });
                })
              }
            />
          </Actions>
          {adding ? (
            <View style={s.card}>
              <Text style={s.h2}>选择要加入的资料</Text>
              {library.data
                ?.filter(
                  (m) =>
                    !w.tabs.some(
                      (t) => t.material.material_id === m.material_id,
                    ),
                )
                .map((m) => (
                  <Row
                    key={m.material_id}
                    title={m.title || m.filename}
                    onPress={() =>
                      void action.run(async () => {
                        await api?.json(path + "/materials", {
                          material_id: m.material_id,
                          make_active: !w.active_material_id,
                        });
                        setAdding(false);
                        await r.reload();
                      })
                    }
                  />
                ))}
              <SmallAction
                title="上传新资料"
                onPress={() =>
                  router.push({
                    pathname: "/add-material",
                    params: { workspace: id },
                  })
                }
              />
            </View>
          ) : null}
          <Section title="资料" />
          {w.tabs.map((t, index) => (
            <View key={t.material.material_id}>
              <Row
                title={t.material.title || t.material.filename}
                detail={
                  t.material.material_id === w.active_material_id
                    ? "当前阅读"
                    : "点击阅读"
                }
                onPress={() => {
                  void api?.json(
                    path + `/materials/${enc(t.material.material_id)}/active`,
                    {},
                    "PUT",
                  );
                  feature("reading", id, { material: t.material.material_id });
                }}
              />
              <View
                style={{ flexDirection: "row", justifyContent: "flex-end" }}
              >
                {index > 0 ? (
                  <SmallAction
                    title="上移"
                    onPress={() =>
                      void action.run(async () => {
                        const ids = w.tabs.map((x) => x.material.material_id);
                        [ids[index - 1], ids[index]] = [
                          ids[index],
                          ids[index - 1],
                        ];
                        await api?.json(
                          path + "/materials/order",
                          { material_ids: ids },
                          "PUT",
                        );
                        await r.reload();
                      })
                    }
                  />
                ) : null}
                <SmallAction
                  title="移出资料组"
                  onPress={() =>
                    Alert.alert(
                      "移出这份资料？",
                      "原始资料仍会保留在资料库。",
                      [
                        { text: "取消", style: "cancel" },
                        {
                          text: "移出",
                          onPress: () =>
                            void action.run(async () => {
                              await api?.request(
                                path +
                                  "/materials/" +
                                  enc(t.material.material_id),
                                { method: "DELETE" },
                              );
                              await r.reload();
                            }),
                        },
                      ],
                    )
                  }
                />
              </View>
            </View>
          ))}
          <Section title="阅读对话" />
          {r.data?.sessions?.map((t) => (
            <Row
              key={t.session_id}
              title={t.title || "阅读讨论"}
              icon="chatbubble-outline"
              onPress={() =>
                router.push({
                  pathname: "/chat/[id]",
                  params: { id: t.session_id },
                })
              }
            />
          ))}
          <Actions>
            <Button
              title="修改资料组"
              secondary
              onPress={() => setEditing(true)}
            />
            <Button
              title="整理阅读笔记"
              secondary
              busy={action.busy}
              onPress={() =>
                void action.run(async () => {
                  const out = await api?.json<{ notes: { markdown: string } }>(
                    path + "/notes/organize",
                    { material_ids: [] },
                  );
                  setOrganized(
                    out?.notes.markdown || "暂时没有可整理的阅读笔记。",
                  );
                })
              }
            />
            <SmallAction
              title="删除资料组"
              onPress={() =>
                confirmDelete("资料组", async () => {
                  await api?.request(path, { method: "DELETE" });
                  router.back();
                })
              }
            />
          </Actions>
          {organized ? (
            <View style={[s.card, { gap: 12 }]}>
              <Section title="整理后的阅读笔记" />
              <Prose text={organized} />
              <ReadAloud text={organized} conversation={`reading:${id}`} />
              <Button title="保存到笔记本" onPress={() => setCapture(true)} />
              <SmallAction title="收起" onPress={() => setOrganized("")} />
            </View>
          ) : null}
        </>
      ) : null}
      {action.error ? (
        <Text style={{ color: C.danger }}>{action.error}</Text>
      ) : null}
      {capture ? (
        <Editor
          title="保存阅读笔记"
          fields={[
            {
              key: "notebook",
              label: "目标笔记本",
              value: notebooks.data?.notebooks[0]?.id || "",
              required: true,
              options:
                notebooks.data?.notebooks.map((n) => ({
                  value: n.id,
                  label: n.name,
                })) || [],
            },
            { key: "title", label: "笔记标题", value: w?.title || "阅读笔记" },
          ]}
          onClose={() => setCapture(false)}
          onSave={async (v) => {
            await api?.json(path + "/notebook", {
              notebook_ids: [v.notebook],
              material_ids: [],
              title: v.title,
              summary: "阅读批注与笔记",
            });
            Alert.alert("已保存", "可以到笔记与收藏中继续整理。");
          }}
        />
      ) : null}
      {editing && w ? (
        <Editor
          title="编辑资料组"
          fields={[
            { key: "title", label: "名称", value: w.title, required: true },
            {
              key: "description",
              label: "说明",
              value: w.description,
              multiline: true,
            },
          ]}
          onClose={() => setEditing(false)}
          onSave={async (v) => {
            await api?.json(path, v, "PATCH");
            await r.reload();
          }}
        />
      ) : null}
    </Page>
  );
}
function Reader({ id, workspace }: { id: string; workspace: string }) {
  const { api } = useAuth();
  const path = base + "/materials/" + enc(id);
  const r = useResource<Material>(path);
  const pos = useResource<{ locator: number }>(path + "/position");
  const [selectedPage, setPage] = useState<number | null>(null);
  const page = selectedPage ?? Math.max(1, pos.data?.locator || 1);
  const [mode, setMode] = useState("page");
  const [panel, setPanel] = useState("read");
  const media = useResource<{ name: string; locator: number; mime?: string }[]>(
    path + "/media",
  );
  const [editor, setEditor] = useState<
    Annotation | "new" | "bookmark" | "jump" | null
  >(null);
  const unit = useResource<{ text: string }>(path + `/units/${page}`);
  const notes = useResource<Annotation[]>(path + "/annotations");
  const marks = useResource<{ bookmarks: Bookmark[] }>(path + "/bookmarks");
  const action = useAction();
  const m = r.data;
  function go(n: number) {
    if (!m) return;
    const next = Math.max(1, Math.min(m.unit_count || 1, n));
    setPage(next);
    void action.run(async () => {
      await api?.json(
        path + "/position",
        { locator: next, percentage: next / (m.unit_count || 1) },
        "PUT",
      );
    });
  }
  function question(quote = "", locator = page) {
    if (!api || !m) return;
    ask(
      api,
      quote
        ? `请帮我理解这段内容：\n${quote}`
        : `请讲解第 ${page} 页的重点，先了解我哪里不懂。`,
      {
        capability: "immersive_reading",
        workspace_mode: "immersive_reading",
        reading_material_id: id,
        reading_material_revision: m.revision || 1,
        ...(workspace ? { reading_workspace_id: workspace } : {}),
        reading_viewport: { locator, selection: quote || undefined },
        reading_references: [
          { material_id: id, revision: m.revision || 1, locators: [locator] },
        ],
      },
    );
  }
  return (
    <Page>
      <Heading title={m?.title || m?.filename || "阅读教材"} back />
      <ResourceState resource={r} />
      {m ? (
        <>
          {m.has_raw_view ? (
            <ExportFile
              path={path + "/raw"}
              filename={m.filename || "学习资料.pdf"}
              mime={
                m.filename?.toLowerCase().endsWith(".pdf")
                  ? "application/pdf"
                  : "application/octet-stream"
              }
              title="保存原文件"
            />
          ) : (
            <ExportFile
              load={(client, signal) =>
                materialText(client, path, m.unit_count, m.revision, signal)
              }
              filename={`${(m.filename || m.title || "学习资料").replace(/\.[^.]+$/, "")}.txt`}
              mime="text/plain"
              title="导出全文文本"
            />
          )}
          <SmallAction
            title="删除这份资料"
            onPress={() =>
              confirmDelete("这份资料及其阅读批注", async () => {
                await api?.request(path, { method: "DELETE" });
                router.back();
              })
            }
          />
          <Chips
            items={[
              { value: "read", label: "阅读" },
              { value: "notes", label: `批注 ${notes.data?.length || 0}` },
              {
                value: "marks",
                label: `书签 ${marks.data?.bookmarks.length || 0}`,
              },
            ]}
            value={panel}
            onChange={setPanel}
          />
          {panel === "read" ? (
            <>
              {m.has_raw_view && ["audio", "video"].includes(m.render_mode) ? (
                <Content
                  value={
                    m.render_mode === "audio"
                      ? { audio_url: path + "/raw" }
                      : { video_url: path + "/raw" }
                  }
                />
              ) : null}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <SmallAction title="上一页" onPress={() => go(page - 1)} />
                <SmallAction
                  title={`${page} / ${m.unit_count || 1}`}
                  onPress={() => setEditor("jump")}
                />
                <SmallAction title="下一页" onPress={() => go(page + 1)} />
              </View>
              {m.render_mode === "pdf" ? (
                <Chips
                  value={mode}
                  onChange={setMode}
                  items={[
                    { value: "page", label: "教材原页" },
                    { value: "text", label: "文字阅读" },
                  ]}
                />
              ) : null}
              {m.render_mode === "pdf" && mode === "page" ? (
                <Pdf materialId={id} page={page} />
              ) : (
                <View style={s.card}>
                  <ResourceState resource={unit} />
                  <Prose text={unit.data?.text} />
                  <ReadAloud text={unit.data?.text || ''} conversation={`reading:${workspace}:${id}`} />
                  {media.data
                    ?.filter((image) => image.locator === page)
                    .map((image) => (
                      <Content
                        key={image.name}
                        value={{
                          image_url: path + "/media/" + enc(image.name),
                        }}
                      />
                    ))}
                </View>
              )}
              <Actions>
                <Button
                  title="问一问这一页"
                  onPress={() => question()}
                  icon="chatbubble-outline"
                />
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-around",
                  }}
                >
                  <SmallAction
                    title="添加批注"
                    onPress={() => setEditor("new")}
                  />
                  <SmallAction
                    title="加书签"
                    onPress={() => setEditor("bookmark")}
                  />
                </View>
              </Actions>
            </>
          ) : panel === "notes" ? (
            <>
              <Actions>
                <Button title="添加批注" onPress={() => setEditor("new")} />
              </Actions>
              <ResourceState resource={notes} empty={!notes.data?.length} />
              {notes.data?.map((n) => (
                <View
                  key={n.annotation_id}
                  style={[s.card, { marginBottom: 12 }]}
                >
                  <SmallAction
                    title={`第 ${n.locator} 页`}
                    onPress={() => {
                      go(n.locator);
                      setPanel("read");
                    }}
                  />
                  <Prose text={n.quote} />
                  <Prose text={n.note} />
                  <ReadAloud text={[n.quote, n.note].filter(Boolean).join('\n')} conversation={`reading:${workspace}:${id}`} />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <SmallAction
                      title="讲解这段"
                      onPress={() => question(n.quote, n.locator)}
                    />
                    <SmallAction title="编辑" onPress={() => setEditor(n)} />
                    <SmallAction
                      title="删除"
                      onPress={() =>
                        confirmDelete("批注", async () => {
                          await api?.request(
                            path + "/annotations/" + enc(n.annotation_id),
                            { method: "DELETE" },
                          );
                          await notes.reload();
                        })
                      }
                    />
                  </View>
                </View>
              ))}
            </>
          ) : (
            <>
              <Actions>
                <Button
                  title="为当前页加书签"
                  onPress={() => setEditor("bookmark")}
                />
              </Actions>
              <ResourceState
                resource={marks}
                empty={!marks.data?.bookmarks.length}
              />
              {marks.data?.bookmarks.map((b) => (
                <View key={b.bookmark_id}>
                  <Row
                    title={b.label || `第 ${b.locator} 页`}
                    onPress={() => {
                      go(b.locator);
                      setPanel("read");
                    }}
                  />
                  <SmallAction
                    title="移除书签"
                    onPress={() =>
                      void action.run(async () => {
                        await api?.request(
                          path + "/bookmarks/" + enc(b.bookmark_id),
                          { method: "DELETE" },
                        );
                        await marks.reload();
                      })
                    }
                  />
                </View>
              ))}
            </>
          )}
          {action.error ? (
            <Text style={{ color: C.danger }}>{action.error}</Text>
          ) : null}
        </>
      ) : null}
      {editor ? (
        <Editor
          title={
            editor === "jump"
              ? "跳转页码"
              : editor === "bookmark"
                ? "添加书签"
                : "阅读批注"
          }
          fields={
            editor === "jump"
              ? [
                  {
                    key: "page",
                    label: "页码",
                    value: String(page),
                    required: true,
                    number: true,
                  },
                ]
              : editor === "bookmark"
                ? [{ key: "label", label: "书签名称", value: `第 ${page} 页` }]
                : [
                    {
                      key: "kind",
                      label: "批注类型",
                      value: typeof editor === "object" ? editor.kind : "note",
                      options: [
                        { value: "note", label: "笔记" },
                        { value: "highlight", label: "高亮" },
                        { value: "underline", label: "划线" },
                        { value: "citation", label: "引用" },
                      ],
                    },
                    {
                      key: "color",
                      label: "标记颜色",
                      value:
                        typeof editor === "object" ? editor.color : "yellow",
                      options: [
                        { value: "yellow", label: "黄色" },
                        { value: "green", label: "绿色" },
                        { value: "blue", label: "蓝色" },
                        { value: "pink", label: "粉色" },
                      ],
                    },
                    {
                      key: "quote",
                      label: "引用原文（可粘贴选中的文字）",
                      value: typeof editor === "object" ? editor.quote : "",
                      multiline: true,
                    },
                    {
                      key: "note",
                      label: "我的想法",
                      value: typeof editor === "object" ? editor.note : "",
                      multiline: true,
                    },
                  ]
          }
          onClose={() => setEditor(null)}
          onSave={async (v) => {
            if (!api) return;
            if (editor === "jump") {
              const n = Number(v.page);
              if (!Number.isInteger(n) || n < 1 || n > (m?.unit_count || 1))
                throw new Error("请输入有效页码。");
              go(n);
            } else if (editor === "bookmark") {
              await api.json(path + "/bookmarks", {
                locator: page,
                label: v.label,
              });
              await marks.reload();
            } else {
              if (!v.quote.trim() && !v.note.trim())
                throw new Error("请填写原文或想法。");
              const previous = typeof editor === "object" ? editor : {};
              await api.json(
                path + "/annotations",
                {
                  ...previous,
                  locator: typeof editor === "object" ? editor.locator : page,
                  kind: v.kind,
                  color: v.color,
                  quote: v.quote,
                  note: v.note,
                },
                "PUT",
              );
              await notes.reload();
            }
          }}
        />
      ) : null}
    </Page>
  );
}
