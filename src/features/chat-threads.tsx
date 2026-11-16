import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../lib/auth";
import { useResource } from "../lib/resources";
import type { Session } from "../lib/client";
import { threadSource, visibleBranch, type SourceContext } from "../lib/chat-actions";
import { compactConversationTitle } from "../lib/conversation";
import { Button, C, Heading, Page, Row, Section, s } from "../ui";
import { FormModal, ResourceState, enc, useAction } from "./common";

export function ChatThreads({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const r = useResource<{ threads: Session[] }>(`/api/sessions/${enc(sessionId)}/threads`);
  return <FormModal onClose={onClose}><Page>
    <Heading title="单独追问" right={<Button title="关闭" secondary onPress={onClose} />} />
    <ResourceState resource={r} empty={!r.data?.threads.length} />
    {r.data?.threads.filter(t => !t.preferences?.archived).map(t => <Row key={t.id} title={compactConversationTitle(t.title || "继续追问")} detail={t.preferences?.tutor_source_message_id ? "已关联原消息" : "围绕整段对话"} onPress={() => { onClose(); router.push({ pathname: "/chat/[id]", params: { id: t.id } }); }} />)}
  </Page></FormModal>;
}
export function ThreadSourceEditor({ sessionId, source, onSave, onClose }: { sessionId: string; source: SourceContext; onSave: (value: SourceContext) => void; onClose: () => void }) {
  const { api } = useAuth();
  const r = useResource<Session>(`/api/sessions/${enc(source.parent_session_id)}`);
  const [selected, setSelected] = useState<string | number | null>(source.quoted_message_id);
  const action = useAction();
  return <FormModal onClose={onClose}><Page>
    <Heading title="追问来源" sub="更换来源不会删除已有追问" right={<Button title="取消" secondary onPress={onClose} />} />
    <ResourceState resource={r} />
    <Row title="整段对话" detail="取消与某一条消息的关联" suffix={selected === null ? "已选" : ""} onPress={() => setSelected(null)} />
    <Section title="选择一条消息" />
    {visibleBranch(r.data?.messages || [], r.data?.preferences?.selected_branches as Record<string, number> | undefined).filter(m => m.role !== "system").map(m => <Row key={m.id} title={m.role === "user" ? "我的提问" : "DeepTutor 的回答"} detail={m.content.slice(0, 140)} suffix={String(selected) === String(m.id) ? "已选" : ""} onPress={() => setSelected(m.id)} />)}
    <View style={{ gap: 14 }}>
      {action.error ? <Text style={{ color: C.danger }}>{action.error}</Text> : null}
      <Text style={s.muted}>保存后，下一次追问会参考所选来源。</Text>
      <Button title="保存来源" disabled={!r.data || !!r.error} busy={action.busy} onPress={() => void action.run(async () => {
        if (!api || !r.data) return;
        const next = threadSource(r.data, selected);
        if (sessionId) await api.json(`/api/sessions/${enc(sessionId)}/organization`, { tutor_source_message_id: selected }, "PATCH");
        onSave(next); onClose();
      })} />
    </View>
  </Page></FormModal>;
}
