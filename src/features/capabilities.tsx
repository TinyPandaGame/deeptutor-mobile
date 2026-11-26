import { useState } from "react";
import { Text, View } from "react-native";
import { useResource } from "../lib/resources";
import { useAuth } from "../lib/auth";
import { useComposerDraft } from "../lib/use-composer-draft";
import { mergeChatOptions, type Capability, type ChatOptions, type KnowledgeBase, type Persona } from "../lib/learning-options";
import { explanationPresets } from "../lib/study-presets";
import { Button, Field, Heading, Page, Row, Section, s } from "../ui";
import {
  Actions,
  Chips,
  FormModal,
  PresetField,
  ResourceState,
  ask,
  feature,
} from "./common";
export const capabilityLabels: Record<string, string> = {
  chat: "聊天与提问",
  ask_questions: "互动问答",
  deep_solve: "解题讲解",
  deep_question: "练习与出题",
  deep_research: "深入研究",
  immersive_reading: "阅读讲解",
  mastery_path: "精通学习",
  audio_overview: "音频导读",
  video_lesson: "视频课程",
  math_animator: "数学动画",
  visualize: "可视化讲解",
};
export const personaLabels: Record<string, string> = {
  teacher: "教学模式",
  peer: "学习搭子",
  "research-assistant": "研究助手",
};
const defaults: Record<string, Record<string, unknown>> = {
  deep_research: { mode: "report", depth: "standard" },
  deep_question: {
    mode: "custom",
    num_questions: 3,
    difficulty: "medium",
    question_types: [],
  },
  math_animator: { quality: "medium", output_mode: "video" },
  visualize: { render_mode: "auto", quality: "medium" },
  audio_overview: { target_minutes: 5 },
};
export const defaultOptions = (capability = "chat"): ChatOptions => ({
  capability,
  persona: "teacher",
  config: { ...defaults[capability] },
});
function NoOptions({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={[s.notice, { gap: 12 }]}>
      <Text style={s.muted}>{message}</Text>
      <Button title="重新加载" secondary onPress={retry} />
    </View>
  );
}
export function CapabilityOptions({
  value,
  onChange,
  onClose,
  allowWorkspaceDefault = true,
}: {
  value: ChatOptions;
  onChange: (o: ChatOptions) => void;
  onClose: () => void;
  allowWorkspaceDefault?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const r = useResource<{ capabilities: Capability[] }>(
    "/api/capabilities/registered",
  );
  const personas = useResource<{ personas: Persona[] }>("/api/personas");
  const kb = useResource<KnowledgeBase[]>("/api/knowledge-bases");
  const available = r.data?.capabilities.filter((c) => c.available) || [];
  const canSave =
    !r.loading &&
    !r.error &&
    !personas.loading &&
    !personas.error &&
    available.some((c) => c.id === draft.capability) &&
    !!personas.data?.personas.some((p) => p.name === draft.persona);
  function cfg(key: string, v: unknown) {
    setDraft((d) => ({ ...d, config: { ...d.config, [key]: v } }));
  }
  const choice = (key: string, label: string, items: string[][]) => (
    <View>
      <Text style={s.label}>{label}</Text>
      <Chips
        value={String(draft.config[key] || "")}
        onChange={(v) =>
          cfg(key, key === "enable_visual_review" ? v === "true" : v)
        }
        items={items.map(([value, label]) => ({ value, label }))}
      />
    </View>
  );
  return (
    <FormModal onClose={onClose}>
      <Page>
        <Heading
          title="这次怎么学"
          right={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button title="取消" compact secondary onPress={onClose} />
              <Button
                title="完成"
                compact
                icon="checkmark-outline"
                disabled={!canSave}
                onPress={() => {
                  onChange(draft);
                  onClose();
                }}
              />
            </View>
          }
        />
        <Section title="交流方式" />
        <ResourceState resource={personas} />
        <Chips
          value={draft.persona}
          onChange={(persona) => setDraft((d) => ({ ...d, persona }))}
          items={(personas.data?.personas || []).map((p) => ({
            value: p.name,
            label: personaLabels[p.name] || p.name,
          }))}
        />
        <Text style={s.muted}>{draft.persona === "teacher" ? "拆解知识点，一步一步理解。" : draft.persona === "peer" ? "一起思考、互相提问，像学习伙伴一样交流。" : "围绕问题查找线索、深入分析。"}</Text>
        {!personas.loading &&
        !personas.error &&
        !personas.data?.personas.length ? (
          <NoOptions
            message="当前服务尚未提供交流方式，请检查服务连接或稍后重试。"
            retry={personas.reload}
          />
        ) : null}
        <Section title="学习能力" />
        <ResourceState resource={r} />
        <Chips
          value={draft.capability}
          onChange={(capability) =>
            setDraft((d) => ({
              ...defaultOptions(capability),
              persona: d.persona,
              knowledge_bases: d.knowledge_bases,
            }))
          }
          items={available.map((c) => ({
            value: c.id,
            label: capabilityLabels[c.id] || c.id,
          }))}
        />
        {!r.loading && !r.error && !available.length ? (
          <NoOptions
            message="当前服务没有可用的学习能力，请检查服务连接及配置。"
            retry={r.reload}
          />
        ) : null}
        {!!available.length &&
        !!personas.data?.personas.length &&
        !r.loading &&
        !personas.loading &&
        !r.error &&
        !personas.error &&
        !canSave ? (
          <Text style={s.muted}>
            原来的选项已不可用，请重新选择交流方式和学习能力。
          </Text>
        ) : null}
        {draft.capability === "deep_question" ? (
          <View style={{ gap: 15 }}>
            {choice("mode", "出题方式", [
              ["custom", "按要求出题"],
              ["mimic", "参考试卷出相似题"],
            ])}
            {draft.config.mode === "mimic" ? (
              <Text style={s.muted}>
                在对话中添加 PDF 试卷，说明需要练习的题型。文件发送后才交给
                DeepTutor 解析。
              </Text>
            ) : null}
            <Text style={s.label}>出题数量</Text>
            <Chips items={[3, 5, 10].map(n => ({ value: String(n), label: `${n} 道` }))}
              value={String(draft.config.num_questions || 3)} onChange={v => setDraft(d => ({ ...d, config: { ...d.config, num_questions: Number(v), max_questions: Number(v) } }))} />
            <Field
              label="出题数量（1–50）"
              keyboardType="numeric"
              value={String(draft.config.num_questions || 3)}
              onChangeText={(v) =>
                setDraft((d) => ({
                  ...d,
                  config: {
                    ...d.config,
                    num_questions: Math.min(50, Math.max(1, Number(v) || 1)),
                    max_questions: Math.min(50, Math.max(1, Number(v) || 1)),
                  },
                }))
              }
            />
            {choice("difficulty", "难度", [
              ["auto", "自动选择"],
              ["easy", "基础"],
              ["medium", "适中"],
              ["hard", "挑战"],
            ])}
            <Text style={s.muted}>
              题型、学科、年级和教材范围可在问题中说明。
            </Text>
          </View>
        ) : null}
        {draft.capability === "deep_research" ? (
          <>
            {choice("mode", "研究成果", [
              ["notes", "学习笔记"],
              ["report", "研究报告"],
              ["comparison", "比较分析"],
              ["learning_path", "学习路线"],
            ])}
            {choice("depth", "深入程度", [
              ["quick", "快速"],
              ["standard", "标准"],
              ["deep", "深入"],
            ])}
          </>
        ) : null}
        {["visualize", "math_animator"].includes(draft.capability) ? (
          <>
            {draft.capability === "visualize"
              ? choice("render_mode", "图示类型", [
                  ["auto", "自动选择"],
                  ["svg", "图形示意"],
                  ["chartjs", "统计图表"],
                  ["mermaid", "流程关系图"],
                  ["mindmap", "思维导图"],
                  ["html", "互动演示"],
                ])
              : null}
            {choice("quality", "清晰度", [
              ["low", "快速"],
              ["medium", "标准"],
              ["high", "高清"],
            ])}
            {draft.capability === "math_animator"
              ? choice("output_mode", "呈现方式", [
                  ["video", "动画"],
                  ["image", "图片"],
                ])
              : null}
            <PresetField
              label="风格与讲解要求"
              presets={explanationPresets}
              value={String(draft.config.style_hint || "")}
              onChange={(v) => cfg("style_hint", v)}
            />
            {choice("enable_visual_review", "检查生成画面", [
              ["false", "关闭"],
              ["true", "开启"],
            ])}
          </>
        ) : null}
        {draft.capability === "audio_overview" ? (
          <View style={{ gap: 10 }}>
          <Text style={s.label}>导读时长</Text>
          <Chips items={[3, 5, 10, 15].map(n => ({ value: String(n), label: `${n} 分钟` }))}
            value={String(draft.config.target_minutes || 5)} onChange={v => cfg("target_minutes", Number(v))} />
          <Field
            label="时长（1–15 分钟）"
            keyboardType="numeric"
            value={String(draft.config.target_minutes || 5)}
            onChangeText={(v) =>
              cfg("target_minutes", Math.min(15, Math.max(1, Number(v) || 1)))
            }
          />
          </View>
        ) : null}
        <Section title="参考知识库" />
        <Text style={s.muted}>可选择多份教材作为提问依据。</Text>
        {allowWorkspaceDefault || draft.knowledge_bases === undefined ? (
          <Row title="跟随工作区" detail="由学习服务为此对话选择可用资料"
            suffix={draft.knowledge_bases === undefined ? "已选" : "选择"}
            onPress={() => setDraft(d => ({ ...d, knowledge_bases: undefined }))} />
        ) : null}
        <Row title="不参考知识库" suffix={draft.knowledge_bases?.length === 0 ? "已选" : "选择"}
          onPress={() => setDraft(d => ({ ...d, knowledge_bases: [] }))} />
        <ResourceState resource={kb} />
        {!kb.loading && !kb.error && !kb.data?.length ? (
          <Text style={[s.muted, { marginVertical: 12 }]}>
            当前学习空间还没有知识库，可以先不选。建立知识库并添加教材后，就能在这里选择。
          </Text>
        ) : null}
        {kb.data?.map((k) => (
          <Row
            key={k.id || k.name}
            title={k.name}
            suffix={
              draft.knowledge_bases?.includes(k.id || k.name) ? "已选" : "选择"
            }
            onPress={() =>
              setDraft((d) => {
                const selected = d.knowledge_bases || [];
                const id = k.id || k.name;
                return { ...d, knowledge_bases: selected.includes(id)
                  ? selected.filter(x => x !== id)
                  : [...selected, id] };
              })
            }
          />
        ))}
      </Page>
    </FormModal>
  );
}
export function Explore({ capability = "" }: { capability?: string }) {
  const { api } = useAuth();
  const [options, setOptions] = useState(() =>
    defaultOptions(capability || "chat"),
  );
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState("");
  const draft = useComposerDraft(api, `create:${capability || "chat"}`, false, { text: prompt, document: null, context: options }, value => {
    setPrompt(value.text);
    setOptions(mergeChatOptions(defaultOptions(capability || "chat"), value.context));
  });
  const r = useResource<{ capabilities: Capability[] }>(
    "/api/capabilities/registered",
  );
  return (
    <Page>
      <Heading
        title={capabilityLabels[capability] || "探索学习"}
        back
        sub="选好学习方式，把目标告诉 DeepTutor"
      />
      <Field
        label="今天想学什么"
        value={prompt}
        onChangeText={text => { draft.edited(); setPrompt(text); }}
        editable={draft.ready}
        multiline
        placeholder="例如：四年级数学，小数的意义，先出 3 道基础题看看我掌握得怎样。"
      />
      <Actions>
        <Button
          title={`${personaLabels[options.persona] || options.persona} · ${capabilityLabels[options.capability] || options.capability}`}
          secondary
          onPress={() => setShow(true)}
        />
        <Button
          title="开始学习"
          disabled={!draft.ready || !prompt.trim()}
          onPress={() => api && ask(api, prompt, options)}
        />
      </Actions>
      {draft.error ? <Text style={s.muted}>草稿：{draft.error}</Text> : null}
      <ResourceState resource={r} />
      <Section title="更多学习方式" />
      {!r.loading &&
      !r.error &&
      !r.data?.capabilities.some((c) => c.available) ? (
        <NoOptions
          message="当前服务没有可用的学习能力，请检查服务连接及配置。"
          retry={r.reload}
        />
      ) : null}
      {r.data?.capabilities
        .filter((c) => c.available)
        .map((c) => (
          <Row
            key={c.id}
            title={capabilityLabels[c.id] || c.id}
            onPress={() => {
              setOptions(defaultOptions(c.id));
              setShow(true);
            }}
          />
        ))}
      <Section title="学习设置" />
      <Row title="学习工作区" onPress={() => feature("workspaces")} />
      {show ? (
        <CapabilityOptions
          value={options}
          onChange={setOptions}
          onClose={() => setShow(false)}
        />
      ) : null}
    </Page>
  );
}
