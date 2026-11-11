import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../lib/auth";
import { useResource } from "../lib/resources";
import { Button, C, Heading, Page, Row, Section, s } from "../ui";
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
import { Content, Data, array, object, string } from "./content";
import { ModelPicker } from './model-picker';
import { ReadAloud } from './read-aloud';
import { masteryStart } from '../lib/mastery-start';
import type { ModelSelection } from '../lib/models';
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
      {editor ? (
        <Editor
          title={editor === "create" ? "新建学习目标" : "修改目标名称"}
          fields={
            editor === "create"
              ? [
                  { key: "name", label: "目标名称", required: true },
                  {
                    key: "goal",
                    label: "希望掌握什么，当前学到哪里",
                    required: true,
                    multiline: true,
                  },
                ]
              : [
                  {
                    key: "name",
                    label: "目标名称",
                    value: t?.name,
                    required: true,
                  },
                ]
          }
          onClose={() => setEditor("")}
          onSave={async (v) => {
            if (!api) return;
            if (editor === "create") {
              const created = await api.json<Topic>(
                "/api/mastery-paths/topics",
                v,
              );
              feature("mastery", created.path_id);
            } else {
              await api.json(
                `/api/mastery-paths/progress/${enc(id)}`,
                v,
                "PATCH",
              );
              await r.reload();
            }
          }}
        />
      ) : null}
    </Page>
  );
}
