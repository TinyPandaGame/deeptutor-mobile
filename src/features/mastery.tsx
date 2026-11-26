import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../lib/auth";
import { useResource } from "../lib/resources";
import { Button, C, Field, Heading, Page, Row, Section, s } from "../ui";
import {
  Actions,
  Editor,
  FormModal,
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
import { Content, Data, array, object, string } from "./content";
import { ModelPicker } from './model-picker';
import { ReadAloud } from './read-aloud';
import { masteryStart } from '../lib/mastery-start';
import type { ModelSelection } from '../lib/models';
import { loadPracticeSources, practiceSearch, practiceTopicSources, PRACTICE_SOURCE_LIMIT, type PracticeSource } from "../lib/mastery-practice";
import { documentPreview } from "../lib/learning-records";
type Topic = {
  path_id: string;
  name: string;
  metadata: { goal: string; description: string };
  map: Data;
  next: Data;
  reviews: unknown;
  session_count: number;
};
export function Mastery({ id = "" }: { id?: string }) {
  const { api } = useAuth();
  const list = useResource<{ topics: Topic[] }>("/api/mastery-paths/topics");
  const r = useResource<Topic>(
    id ? `/api/mastery-paths/topics/${enc(id)}` : null,
  );
  const sessions = useResource<{
    sessions: { session_id?: string; id?: string; title: string }[];
  }>(id ? `/api/mastery-paths/topics/${enc(id)}/sessions` : null);
  const board = useResource<Data>(
    id ? `/api/mastery-paths/progress/${enc(id)}/board` : null,
  );
  const [editor, setEditor] = useState("");
  const [pending, setPending] = useState<{ mode: string; text: string } | null>(null);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const action = useAction();
  const t = r.data;
  function start(mode: string) {
    setPending({ mode, text: mode === "outline"
          ? "请先了解我的基础，和我一起规划这个学习目标。"
          : mode === "review"
            ? "请根据当前复习安排带我复习。"
            : "请从当前最适合的知识点开始引导我学习。" });
  }
  return (
    <Page>
      <Heading
        title={t?.name || "精通学习"}
        back
        sub="定一个目标，逐步理解、练习和复习"
        right={<Refresh onPress={id ? r.reload : list.reload} />}
      />
      <ResourceState
        resource={id ? r : list}
        empty={!id && !list.data?.topics.length}
      />
      {!id ? (
        <>
          <Button title="新建学习目标" onPress={() => setEditor("create")} />
          {list.data?.topics.map((t) => (
            <Row
              key={t.path_id}
              title={t.name}
              detail={t.metadata.goal}
              onPress={() => feature("mastery", t.path_id)}
            />
          ))}
        </>
      ) : t ? (
        <>
          <Prose text={t.metadata.goal} />
          <ReadAloud text={t.metadata.goal} conversation={`mastery:${id}`} />
          <Actions>
            <Button title="继续学习" onPress={() => start("study")} />
            <Button
              title="安排复习"
              secondary
              onPress={() => start("review")}
            />
            <Button
              title="讨论学习路线"
              secondary
              onPress={() => start("outline")}
            />
          </Actions>
          <Section title="接下来学什么" />
          <Text style={s.text}>
            {string(t.next.knowledge_point_name) ||
              (Number(object(t.map.counts).total)
                ? "当前没有待学知识点，可开始复习。"
                : "先和老师讨论学习路线，确定要掌握的知识点。")}
          </Text>
          <Section title="学习地图" />
          <Text style={s.text}>
            已掌握 {String(object(t.map.counts).mastered || 0)} /{" "}
            {String(object(t.map.counts).total || 0)} 个知识点
          </Text>
          <ResourceState resource={board} />
          {array(object(board.data).modules).map((m, i) => {
            const module = object(m);
            return (
              <View key={string(module.id) || i} style={s.card}>
                <Text style={s.h2}>{string(module.name)}</Text>
                {array(module.cards).map((x, j) => {
                  const k = object(x);
                  return (
                    <Row
                      key={string(k.id) || j}
                      title={string(k.name)}
                      detail={`掌握程度 ${Math.round(Number(k.mastery_level || 0) * 100)}%`}
                      onPress={() =>
                        setPending({ mode: 'study', text: `请帮我学习：${string(k.name)}` })
                      }
                    />
                  );
                })}
              </View>
            );
          })}
          <Section title="复习安排" />
          <Content value={t.reviews} />
          <Section title="之前的学习" />
          {sessions.data?.sessions?.map((x, i) => (
            <Row
              key={x.session_id || x.id || i}
              title={x.title || "学习记录"}
              onPress={() =>
                router.push({
                  pathname: "/chat/[id]",
                  params: { id: x.session_id || x.id || "new" },
                })
              }
            />
          ))}
          <Actions>
            <Button
              title="修改目标名称"
              secondary
              onPress={() => setEditor("rename")}
            />
            <SmallAction
              title="删除学习目标"
              onPress={() =>
                confirmDelete("学习目标及其进度", async () => {
                  await api?.request(`/api/mastery-paths/progress/${enc(id)}`, {
                    method: "DELETE",
                  });
                  router.back();
                })
              }
            />
          </Actions>
        </>
      ) : null}
      {action.error ? (
        <Text style={{ color: C.danger }}>{action.error}</Text>
      ) : null}
      {pending && <ModelPicker title="选择本次学习模型" sub="在讨论路线、学习或复习开始前选择；稍后仍可在对话中切换。"
        value={model} onClose={() => setPending(null)} onChange={choice => {
          const task = pending; setModel(choice);
          void action.run(async () => {
            if (!api) return;
            const context = await masteryStart(api, id, task.mode, choice);
            ask(api, task.text, context);
          });
        }} />}
      {editor === "create" ? <CreateMasteryTopic key={api?.scope} onClose={() => setEditor("")} /> : null}
      {editor === "rename" ? (
        <Editor
          title="修改目标名称"
          fields={[{ key: "name", label: "目标名称", value: t?.name, required: true }]}
          onClose={() => setEditor("")}
          onSave={async (v) => {
            if (!api) return;
            await api.json(`/api/mastery-paths/progress/${enc(id)}`, v, "PATCH");
            await r.reload();
          }}
        />
      ) : null}
    </Page>
  );
}

function CreateMasteryTopic({ onClose }: { onClose: () => void }) {
  const { api } = useAuth();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<PracticeSource[]>([]);
  const action = useAction();
  const close = () => { if (!action.busy) onClose(); };
  const toggle = (source: PracticeSource) => {
    if (action.busy) return;
    setSelected(current => current.some(item => item.id === source.id)
      ? current.filter(item => item.id !== source.id)
      : current.length < PRACTICE_SOURCE_LIMIT ? [...current, source] : current);
  };

  return <FormModal onClose={close}><Page>
    <Heading title="新建学习目标" right={<Button title="取消" compact secondary disabled={action.busy} onPress={close} />} />
    <View style={{ gap: 14 }}>
      <Field label="目标名称" value={name} onChangeText={setName} maxLength={120} editable={!action.busy} />
      <Field label="希望掌握什么，当前学到哪里" value={goal} onChangeText={setGoal} maxLength={2000} multiline editable={!action.busy} />
      <Button title={choosing ? "收起题库" : "从题库选题（可选）"} secondary disabled={action.busy} onPress={() => setChoosing(value => !value)} />
      {selected.length ? <>
        <Text style={s.muted}>已选择 {selected.length} / {PRACTICE_SOURCE_LIMIT} 道题</Text>
        {selected.map(item => <Row key={item.id} title={documentPreview(item.question) || "题目"} suffix="移除" onPress={() => toggle(item)} />)}
      </> : null}
      {choosing ? <PracticeSourcePicker selected={selected} onToggle={toggle} /> : null}
      {action.error ? <Text style={{ color: C.danger }}>{action.error}</Text> : null}
      <Button title="保存" busy={action.busy} disabled={!name.trim() || !goal.trim()} onPress={() => {
        void action.run(async () => {
          if (!api) return;
          const topic = await api.json<Topic>("/api/mastery-paths/topics", {
            name: name.trim(),
            goal: goal.trim(),
            sources: practiceTopicSources(selected),
          });
          api.assertOpen();
          onClose();
          feature("mastery", topic.path_id);
        });
      }} />
    </View>
  </Page></FormModal>;
}

function PracticeSourcePicker({ selected, onToggle }: {
  selected: PracticeSource[];
  onToggle: (source: PracticeSource) => void;
}) {
  const { api } = useAuth();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", page: 0 });
  const [data, setData] = useState<Awaited<ReturnType<typeof loadPracticeSources>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const legacy = useRef(false);
  const term = practiceSearch(search);
  const pending = term !== query.search;
  const changePage = (page: number) => {
    setLoading(true);
    setData(null);
    setError("");
    setQuery(previous => ({ ...previous, page }));
  };
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setLoading(true);
      setData(null);
      setError("");
      setQuery({ search: term, page: 0 });
    }, 280);
    return () => clearTimeout(timer);
  }, [pending, term]);
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void loadPracticeSources(api, query.search, query.page, controller.signal, legacy.current)
      .then(result => {
        if (controller.signal.aborted || api.isClosed) return;
        legacy.current = result.useLegacy;
        setData(result);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted && !api.isClosed) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted && !api.isClosed) setLoading(false);
      });
    return () => controller.abort();
  }, [api, query, retry]);

  const visibleData = pending ? null : data;
  const restart = () => { setError(""); setLoading(true); setRetry(count => count + 1); };
  return <View style={[s.card, { gap: 8 }]}>
    <Field label="搜索题目" value={search} onChangeText={setSearch} maxLength={200} />
    <ResourceState resource={{ data: visibleData, loading: pending || loading, error: pending ? "" : error, reload: restart }} />
    {visibleData && !error ? <>
      {!visibleData.items.length ? <Text style={s.muted}>这一页没有可选择的题目。</Text> : null}
      {visibleData.items.map(item => {
        const checked = selected.some(source => source.id === item.id);
        if (!checked && selected.length >= PRACTICE_SOURCE_LIMIT) {
          return <Text key={item.id} numberOfLines={2} style={s.muted}>{documentPreview(item.question)}</Text>;
        }
        return <Row key={item.id} title={documentPreview(item.question) || "题目"} suffix={checked ? "已选" : "选择"} onPress={() => onToggle(item)} />;
      })}
      {query.page > 0 || visibleData.hasMore ? <>
        <Text style={s.muted}>第 {query.page + 1} 页 · 共 {visibleData.total} 道题</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Button title="上一页" compact secondary disabled={query.page === 0 || loading} onPress={() => changePage(query.page - 1)} />
          <Button title="下一页" compact secondary disabled={!visibleData.hasMore || loading} onPress={() => changePage(query.page + 1)} />
        </View>
      </> : null}
    </> : null}
  </View>;
}
