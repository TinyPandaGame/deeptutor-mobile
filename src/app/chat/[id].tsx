import { ownTemporaryFile } from "../../lib/temporary-files";
import { pickQuestionPhoto } from "../../lib/pick-photo";
import { isImageAttachment, outgoingAttachments } from "../../lib/chat-attachments";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import { useAuth } from "../../lib/auth";
import {
  Session,
  TurnEvent,
  ChatAttachment,
  streamText,
} from "../../lib/client";
import {
  PHOTO_QUESTION_PROMPT,
  photoQuestionDraft,
} from "../../lib/photo-question";
import { PrivateImage } from "../../components/PrivateImage";
import { QuestionImage } from "../../components/QuestionImage";
import { Photo, photoDraft, questionDraft, chatDraft } from "../../lib/drafts";
import { Button, C, Empty, Field, Heading, Icon, Page, s } from "../../ui";

import {
  CapabilityOptions,
  ChatOptions,
  defaultOptions,
  capabilityLabels,
  personaLabels,
} from "../../features/capabilities";
import { Content, Data, object, array, string } from "../../features/content";
import {
  dialogueParts,
  conversationTitle,
  visibleMessage,
  cancelledTurn,
} from "../../lib/conversation";
import { Chips, Editor, Prose, SmallAction, ask } from "../../features/common";
import { ReadAloud } from '../../features/read-aloud';
import { GeneratedFile } from "../../features/generated-file";
import { ChatThreads, ThreadSourceEditor } from "../../features/chat-threads";
import { tutorSource, threadSource, visibleBranch, type SourceContext } from "../../lib/chat-actions";
import { useComposerDraft } from "../../lib/use-composer-draft";
import { mergeChatOptions } from "../../lib/learning-options";
import { ModelPicker } from "../../features/model-picker";
import { loadModelOptions, resolveTurnModel, selection, selectedModel, type ModelSelection, type ModelOptions } from "../../lib/models";
type Message = {
  id: string;
  role: string;
  content: string;
  events?: TurnEvent[];
  attachments?: ChatAttachment[];
  parent_message_id?: number | null;
};

function displayBody(message: Message) {
  const result = [...(message.events || [])]
    .reverse()
    .find((e) => e.type === "result");
  const meta = object(result?.metadata);
  const code = string(object(meta.code).content);
  // A visualization result streams its source as a code fence. Its artifact
  // below is the actual result; avoid displaying that source a second time.
  return code &&
    message.content.trim().startsWith("```") &&
    message.content.includes(code)
    ? ""
    : message.content;
}

const NativeSocket = WebSocket as unknown as {
  new (
    url: string,
    protocols: null,
    options: { headers: Record<string, string> },
  ): WebSocket;
};
export default function ChatRoute() {
  const { id, questionId } = useLocalSearchParams<{
    id: string;
    questionId?: string;
  }>();
  const { api } = useAuth();
  return <Chat key={`${api?.scope}:${id}`} id={id} questionId={questionId} />;
}
function Chat({ id, questionId }: { id: string; questionId?: string }) {
  const { api } = useAuth();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [branches, setBranches] = useState<Record<string, number>>({});
  const [initialDraft] = useState(() =>
    api ? chatDraft.take(api) : undefined,
  );
  const [context, setContext] = useState<Record<string, unknown>>(
    initialDraft?.context || {},
  );
  const [options, setOptions] = useState<ChatOptions>(
    () =>
      mergeChatOptions(defaultOptions(String(initialDraft?.context.capability || "chat")), initialDraft?.context || {}),
  );
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelChoice, setModelChoice] = useState<ModelSelection | null>(() => selection(initialDraft?.context.llm_selection));
  const [models, setModels] = useState<ModelOptions | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (api) void loadModelOptions(api).then(value => { if (active) setModels(value); }).catch(() => { if (active) setModels(null); });
    return () => { active = false; };
  }, [api]));
  const [waiting, setWaiting] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const replyPending = useRef(false);
  const [waitingCard, setWaitingCard] = useState<Data | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [traceOpen, setTraceOpen] = useState(false);
  const [sessionId, setSessionId] = useState(id === "new" ? "" : id);
  const sid = useRef(id === "new" ? "" : id);
  const [rawTitle, setTitle] = useState("问一问 DeepTutor");
  const title = conversationTitle(rawTitle);
  const [rename, setRename] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [initialPhoto] = useState(() =>
    api ? photoDraft.peek(api) : undefined,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(
    initialPhoto
      ? PHOTO_QUESTION_PROMPT
      : initialDraft?.content
        ? initialDraft.content
        : questionId
          ? "请引导我重新理解这道错题。先让我想一想，不要直接给出答案。"
          : "",
  );
  const [photo, setPhoto] = useState<Photo | undefined>(initialPhoto);
  const [document, setDocument] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const cancellation = useRef({ requested: false, sent: false, turnId: "" });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const turn = useRef("");
  const sending = useRef(false);
  const waitingRef = useRef(false);
  const alive = useRef(true);
  const scroll = useRef<ScrollView>(null);
  const followOutput = useRef(true);
  const draftContext = useMemo(() => ({ ...context, ...options, llm_selection: modelChoice }), [context, options, modelChoice]);
  const draft = useComposerDraft(api, sessionId || id, !!(initialDraft || initialPhoto || questionId), { text, photo, document, context: draftContext }, value => {
    setText(value.text); setPhoto(value.photo); setDocument(value.document);
    if (id === "new") {
      setContext(value.context);
      setOptions(mergeChatOptions(defaultOptions(String(value.context.capability || "chat")), value.context));
      setModelChoice(selection(value.context.llm_selection));
    }
  });
  const source = context.selection_tutor_context as SourceContext | undefined;
  async function choosePhoto(camera: boolean) {
    if (!api || picking || sending.current) return;
    setPicking(true);
    try {
      const selected = await pickQuestionPhoto(api, camera);
      if (selected && alive.current) {
        draft.edited();
        setPhoto(selected);
        if (!text.trim()) setText(PHOTO_QUESTION_PROMPT);
      }
    } catch (e) { if (alive.current) Alert.alert("未能取得照片", (e as Error).message); }
    finally { if (alive.current) setPicking(false); }
  }
  async function startThread(message: Message) {
    if (!api || !sid.current || busy) return;
    try {
      const parent = await api.request<Session>(`/api/sessions/${encodeURIComponent(sid.current)}`);
      ask(api, "请帮我进一步理解这条内容。", { selection_tutor_context: threadSource(parent, message.id), llm_selection: modelChoice });
    } catch (e) { Alert.alert("暂时无法追问", (e as Error).message); }
  }
  function stopTurn() {
    const cancel = cancellation.current;
    cancel.requested = true;
    setStopping(true);
    setStatus("正在停止…");
    if (
      cancel.turnId &&
      !cancel.sent &&
      socket.current?.readyState === WebSocket.OPEN
    ) {
      cancel.sent = true;
      socket.current.send(
        JSON.stringify({
          type: "cancel_turn",
          protocol_version: "2.0",
          turn_id: cancel.turnId,
          command_id: `cancel_${Date.now()}`,
        }),
      );
    }
  }
  async function chooseDocument() {
    if (picking || sending.current) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "text/plain",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      if ((file.size || new File(file.uri).size) > 10 * 1024 * 1024)
        throw new Error(
          "对话附件不能超过 10 MB，较大的教材请在资料页分章节添加。",
        );
      if (!/\.(pdf|docx|txt)$/i.test(file.name))
        throw new Error("请选择 PDF、DOCX 或 TXT 文件。");
      if (!api) return;
      file.uri = await ownTemporaryFile(api, file.uri, file.name);
      setDocument(file);
    } catch (e) {
      Alert.alert("未能添加附件", (e as Error).message);
    } finally {
      setPicking(false);
    }
  }
  async function send(override?: string, extra: Data = {}, resumeId = "") {
    if (!api) return;
    if (waitingRef.current && !resumeId) {
      if (replyPending.current) return;
      if (socket.current?.readyState !== WebSocket.OPEN) {
        setError("连接已断开，请点恢复进度后继续作答。");
        return;
      }
      const content = override || text.trim();
      const entries = Object.entries(answers)
        .filter(([, v]) => v.trim())
        .map(([questionId, text]) => ({ questionId, text }));
      if (!content && !entries.length) return;
      replyPending.current = true;
      setReplyBusy(true);
      socket.current.send(
        JSON.stringify({
          protocol_version: "2.0",
          type: "submit_user_reply",
          turn_id: turn.current,
          command_id: `reply_${Date.now()}`,
          ...(content ? { text: content } : {}),
          ...(entries.length ? { answers: entries } : {}),
        }),
      );
      setStatus("正在提交回答…");
      return;
    }
    if (sending.current || (!resumeId && !(override || text).trim())) return;
    sending.current = true;
    cancellation.current = { requested: false, sent: false, turnId: resumeId };
    setStopping(false);
    setBusy(true);
    setError("");
    setNotice("");
    setStatus("正在连接…");
    const prompt = (override || text).trim();
    const image = resumeId || Object.hasOwn(extra, "attachments") ? undefined : photo;
    const attached = resumeId || Object.hasOwn(extra, "attachments") ? null : document;
    const submission = `mobile_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const reply = submission + "_reply";
    let resolveAdmission: (accepted: boolean) => void = () => {};
    const admission = new Promise<boolean>(resolve => { resolveAdmission = resolve; });
    try {
      // Validate/renew before opening WS; failed connections never silently re-submit a turn.
      await api.ensureSession();
      const currentModels = resumeId ? null : await loadModelOptions(api);
      const turnModel = currentModels ? resolveTurnModel(currentModels, modelChoice) : undefined;
      if (currentModels && alive.current) setModels(currentModels);
      const filePayload = attached
        ? {
            type: attached.name.toLowerCase().endsWith(".pdf") ? "pdf" : "file",
            filename: attached.name,
            mime_type: attached.mimeType || "application/octet-stream",
            base64: await new File(attached.uri).base64(),
          }
        : undefined;
      if (!alive.current) return;
      socket.current?.close();
      api.assertOpen();
      const transport = api.socketOptions();
      const ws = new NativeSocket(transport.url, null, {
        headers: transport.headers,
      });
      api.onClose(() => ws.close());
      socket.current = ws;
      let terminal = false;
      let opened = false;
      let response = "";
      let lastSeq = 0;
      let eventTrace: TurnEvent[] = [];
      let admitted = false;
      const finish = (msg = "") => {
        if (!admitted && !resumeId) {
          resolveAdmission(false);
          if (alive.current) setMessages(v => v.filter(m => m.id !== submission && m.id !== reply));
        }
        if (socket.current !== ws || !alive.current) return;
        terminal = true;
        replyPending.current = false;
        setReplyBusy(false);
        sending.current = false;
        setBusy(false);
        setStopping(false);
        setStatus("");
        if (msg) setError(msg);
      };
      const timeout = setTimeout(() => {
        if (!opened) {
          finish("连接超时，内容尚未提交，可以重试。");
          ws.close();
        }
      }, 20000);
      ws.onopen = () => {
        clearTimeout(timeout);
        if (!alive.current || socket.current !== ws) {
          ws.close();
          return;
        }
        opened = true;
        if (cancellation.current.requested && !resumeId) {
          finish();
          ws.close();
          return;
        }
        if (resumeId) {
          turn.current = resumeId;
          setStatus("正在恢复进度…");
          ws.send(
            JSON.stringify({
              type: "subscribe_turn",
              protocol_version: "2.0",
              turn_id: resumeId,
              after_seq: 0,
            }),
          );
          setMessages((v) => [
            ...v,
            { id: reply, role: "assistant", content: "" },
          ]);
          return;
        }
        setStatus("DeepTutor 正在思考…");
        followOutput.current = true;
        setMessages((v) => [
          ...v,
          {
            id: submission,
            role: "user",
            content:
              prompt +
              (image ? "\n[已附题目照片]" : "") +
              (attached ? `\n[附件：${attached.name}]` : ""),
            attachments: outgoingAttachments(image, filePayload, Array.isArray(extra.attachments) ? extra.attachments as ChatAttachment[] : []),
          },
          { id: reply, role: "assistant", content: "" },
        ]);
        ws.send(
          JSON.stringify({
            protocol_version: "2.0",
            type: "start_turn",
            content: prompt,
            ...context,
            ...options,
            ...extra,
            llm_selection: turnModel,
            ...(api.workspaceId ? { workspace_id: api.workspaceId } : {}),
            client_submission_id: submission,
            ...(sid.current ? { session_id: sid.current } : {}),
            reply_language_override: "zh",
            question_notebook_references: questionId
              ? [Number(questionId)]
              : [],
            attachments: outgoingAttachments(image, filePayload, Array.isArray(extra.attachments) ? extra.attachments as ChatAttachment[] : []),
          }),
        );
      };
      ws.onmessage = (ev) => {
        if (!alive.current || socket.current !== ws) return;
        let event: TurnEvent;
        try {
          event = JSON.parse(String(ev.data));
        } catch {
          finish("服务返回了无法识别的内容，请恢复进度后重试。");
          return;
        }
        if (event.type === "command_ack") {
          replyPending.current = false;
          setReplyBusy(false);
          const ack = event as TurnEvent & {
            accepted: boolean;
            command_type: string;
            message?: string;
          };
          if (!ack.accepted) {
            if (ack.command_type === "cancel_turn") {
              setStopping(false);
              setNotice("这次讲解已结束，可以查看已有内容或继续提问。");
              return;
            }
            setError(ack.message || "这次操作未被接受，请刷新进度。");
            return;
          }
          if (ack.command_type === "cancel_turn")
            setStatus("已请求停止，正在保存进度…");
          if (ack.command_type === "submit_user_reply") {
            waitingRef.current = false;
            setWaiting(false);
            setWaitingCard(null);
            setAnswers({});
            setText("");
            setStatus("正在继续讲解…");
          }
          return;
        }
        if (event.type === "protocol_error") {
          finish(
            string((event as unknown as Data).message) ||
              "请求未被服务接受，请检查学习设置。",
          );
          ws.close();
          return;
        }
        if (event.seq && event.seq <= lastSeq) return;
        if (event.seq) lastSeq = event.seq;
        if (event.session_id) {
          // Admission is now confirmed. A failed connection before this point
          // keeps both text and attachments available for review and retry.
          if (!resumeId && !admitted && event.type !== "error") {
            admitted = true;
            resolveAdmission(true);
            // Editing a historical message must not erase an unrelated unsent draft.
            if (override === undefined) {
              setText(""); setPhoto(undefined); setDocument(null);
              void draft.clear().catch(e => setNotice(`已提交，但草稿清理失败：${e.message}`));
            }
          }
          sid.current = event.session_id;
          setSessionId(event.session_id);
        }
        if (event.turn_id) {
          turn.current = event.turn_id;
          cancellation.current.turnId = event.turn_id;
          if (cancellation.current.requested) stopTurn();
        }
        if (!["content", "thinking"].includes(event.type)) {
          eventTrace = [...eventTrace, event];
          setMessages((v) =>
            v.map((m) => (m.id === reply ? { ...m, events: eventTrace } : m)),
          );
        }
        const meta = object(event.metadata);
        const tool = object(meta.tool_metadata);
        const asked = object(tool.ask_user || meta.ask_user);
        if (Object.keys(asked).length && asked.kind !== "mastery_question") {
          setWaitingCard(asked);
          setWaiting(true);
          waitingRef.current = true;
          setStatus("等你回答后继续");
        }
        if (meta.ask_user_resolved) {
          setWaitingCard(null);
          setWaiting(false);
          waitingRef.current = false;
        }

        if (
          event.type === "session_meta" &&
          typeof event.metadata?.title === "string"
        )
          setTitle(event.metadata.title);
        if (event.type === "content" || event.type === "result") {
          response = streamText(event, response);
          setStatus("正在讲解…");
          setMessages((v) =>
            v.map((m) => (m.id === reply ? { ...m, content: response } : m)),
          );
        }
        if (event.type === "tool_call") setStatus("正在查找资料和整理思路…");
        if (event.type === "wait_for_input") {
          setWaiting(true);
          waitingRef.current = true;
          setStatus("等你回答后继续");
          if (event.content)
            setWaitingCard((v) => v || { question: event.content });
        }
        if (event.type === "error") {
          if (cancelledTurn(event)) {
            finish();
            setError("");
            setNotice("已停止生成，可以继续提问。");
            setWaiting(false);
            waitingRef.current = false;
            setWaitingCard(null);
          } else
            finish(event.content || "这次讲解未完成，请查看学习进度后重试。");
        }
        if (event.type === "done") {
          finish();
          setWaiting(false);
          waitingRef.current = false;
          setWaitingCard(null);
          ws.close();
          if (sid.current)
            void api
              .request<Session>(
                `/api/sessions/${encodeURIComponent(sid.current)}`,
              )
              .then((r) => {
                if (alive.current) {
                  setMessages(r.messages || []);
                  setTitle(r.title || title);
                  setBranches(object(r.preferences?.selected_branches) as Record<string, number>);
                }
              })
              .catch(() => {});
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        if (terminal || api.isClosed) return;
        finish(
          opened
            ? "连接中断，请恢复进度确认已保存的结果，避免重复提交。"
            : "连接未建立，内容尚未提交，请重试。",
        );
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        if (!terminal) finish("连接已断开，请恢复进度查看已保存的结果。");
      };
      return resumeId ? true : await admission;
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        sending.current = false;
        setBusy(false);
        setStopping(false);
        setStatus("");
      }
      return false;
    }
  }
  useEffect(() => {
    alive.current = true;
    if (api) photoDraft.take(api);
    if (api && id !== "new")
      void api
        .request<Session>(`/api/sessions/${encodeURIComponent(id)}`)
        .then((r) => {
          if (alive.current) {
            setMessages(r.messages || []);
            setTitle(r.title || "学习对话");
            const prefs = r.preferences || {};
            setBranches(object(prefs.selected_branches) as Record<string, number>);
            setModelChoice(selection(prefs.llm_selection));
            setOptions((o) => ({
              ...o,
              ...(typeof prefs.capability === "string"
                ? { capability: prefs.capability }
                : {}),
              ...(typeof prefs.persona === "string"
                ? { persona: prefs.persona }
                : {}),
              ...(prefs.config ? { config: object(prefs.config) } : {}),
              ...(Array.isArray(prefs.knowledge_bases)
                ? { knowledge_bases: prefs.knowledge_bases as string[] }
                : {}),
            }));
            const allowed = [
              "reading_material_id",
              "reading_material_revision",
              "reading_workspace_id",
              "reading_viewport",
              "workspace_mode",
              "mastery_path_id",
              "mastery_session_mode",
              "note_document_id",
              "knowledge_bases",
              "book_references",
              "notebook_references",
            ];
            setContext(
              { ...Object.fromEntries(
                allowed
                  .filter((k) => prefs[k] !== undefined)
                  .map((k) => [k, prefs[k]]),
              ), ...(tutorSource(prefs) ? { selection_tutor_context: tutorSource(prefs) } : {}) },
            );
            if (
              r.active_turn &&
              ["queued", "running", "waiting_input", "recovering"].includes(
                r.active_turn.status,
              )
            ) {
              void send(undefined, {}, r.active_turn.id);
            }
          }
        })
        .catch((e) => {
          if (alive.current) setError(e.message);
        });
    return () => {
      alive.current = false;
      socket.current?.close();
      socket.current = null;
    };
    // The transport is initialized once per authenticated client and route. Its
    // mutable socket/turn refs own recovery; composer edits must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id]);
  async function restoreProgress() {
    if (!api || !sid.current) return;
    try {
      const r = await api.request<Session>(
        `/api/sessions/${encodeURIComponent(sid.current)}`,
      );
      setMessages(r.messages || []);
      setError("");
      setTitle(r.title || "学习对话");
      sending.current = false;
      setBusy(false);
      socket.current?.close();
      if (
        r.active_turn &&
        ["queued", "running", "waiting_input", "recovering"].includes(
          r.active_turn.status,
        )
      )
        await send(undefined, {}, r.active_turn.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function saveQuestion(messageId?: string) {
    if (api) {
      try {
        questionDraft.set(
          api,
          photoQuestionDraft(messages, sid.current, messageId),
        );
        router.push("/question/new");
      } catch (e) {
        Alert.alert("还不能记录", (e as Error).message);
      }
    }
  }
  return (
    <Page scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        automaticOffset
        enabled={!rename}
      >
        <View style={{ paddingHorizontal: 18 }}>
          <Heading
            title={sessionId ? title : "问一问"}
            compact
            titleLines={keyboardVisible ? 1 : undefined}
            sub={keyboardVisible ? undefined : `${personaLabels[options.persona] || options.persona} · ${capabilityLabels[options.capability] || options.capability}`}
            back
            right={
              <Pressable
                accessibilityLabel="对话菜单"
                accessibilityRole="button"
                style={s.iconButton}
                onPress={() =>
                  Alert.alert("对话操作", "", [
                    { text: "取消", style: "cancel" },
                    ...(sessionId
                      ? [
                          {
                            text: "修改标题",
                            onPress: () => {
                              setRenameText(title);
                              setRename(true);
                            },
                          },
                        ]
                      : []),
                    { text: "加入错题本", onPress: () => saveQuestion() },
                    { text: "学习方式", onPress: () => setOptionsOpen(true) },
                    {
                      text: "查看学习过程",
                      onPress: () => setTraceOpen((v) => !v),
                    },
                    { text: "恢复进度", onPress: () => void restoreProgress() },
                    ...(sessionId ? [{ text: "查看单独追问", onPress: () => setThreadsOpen(true) }] : []),
                  ])
                }
              >
                <Icon name="ellipsis-horizontal" />
              </Pressable>
            }
          />
        </View>
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 18,
            paddingTop: 0,
            gap: 16,
            paddingBottom: 30,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={() => { followOutput.current = false; }}
          onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
            followOutput.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 60;
          }}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            if (followOutput.current) scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          {source ? <View style={s.notice}>
            <Text style={s.rowTitle}>这是一段单独追问</Text>
            <Text style={s.muted}>{source.quoted_message_id == null ? "参考原对话，未绑定单条消息" : "参考原对话中的一条消息"}</Text>
            <SmallAction title="查看或更换来源" onPress={() => setSourceOpen(true)} />
            <SmallAction title="返回原对话" onPress={() => router.push({ pathname: "/chat/[id]", params: { id: source.parent_session_id } })} />
          </View> : null}
          {!messages.length && (
            <Empty
              title="今天有什么不懂的？"
              detail="可以问一道题，也可以让我帮你梳理一个知识点。"
              icon="chatbubbles-outline"
            />
          )}
          {visibleBranch(messages, branches)
            .filter((m, i) =>
              visibleMessage(m, busy && i === messages.length - 1),
            )
            .map((m, i) => (
              <View
                key={m.id || String(i)}
                style={[
                  s.card,
                  {
                    padding: 17,
                    backgroundColor: m.role === "user" ? C.pale : C.white,
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "95%",
                    width:
                      m.role === "assistant" ||
                      m.attachments?.some(isImageAttachment)
                        ? "95%"
                        : undefined,
                    minWidth: 100,
                  },
                ]}
              >
                <Text style={[s.muted, { marginBottom: 7 }]}>
                  {m.role === "user" ? "我" : "DeepTutor"}
                </Text>
                {!busy && sessionId && !String(m.id).startsWith("mobile_") ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <SmallAction title="单独追问" onPress={() => void startThread(m)} />
                  {m.role === "user" && /^\d+$/.test(String(m.id)) ? <SmallAction title="修改后再问" onPress={() => setEditingMessage(m)} /> : null}
                </View> : null}
                {!busy && Object.hasOwn(m, "parent_message_id") && messages.filter(x => (x.parent_message_id ?? null) === (m.parent_message_id ?? null)).length > 1 ? <Chips
                  value={String(m.id)}
                  items={messages.filter(x => (x.parent_message_id ?? null) === (m.parent_message_id ?? null)).map((x, index) => ({ value: String(x.id), label: `版本 ${index + 1}` }))}
                  onChange={value => {
                    const next = { ...branches, [String(m.parent_message_id ?? null)]: Number(value) };
                    void api?.json(`/api/sessions/${encodeURIComponent(sessionId)}/branch-selection`, { selected_branches: next }, "PUT").then(() => setBranches(next)).catch(e => Alert.alert("未能切换", e.message));
                  }} /> : null}
                {m.role === "user" &&
                  m.attachments
                    ?.filter(isImageAttachment)
                    .map((a, index) =>
                      a.url ? (
                        <PrivateImage key={index} path={a.url} />
                      ) : a.base64 ? (
                        <QuestionImage
                          key={index}
                          uri={`data:${a.mime_type || "image/jpeg"};base64,${a.base64}`}
                        />
                      ) : null,
                    )}
                {m.role === "user" &&
                m.attachments?.some(isImageAttachment) ? (
                  <SmallAction
                    title="记录这道拍照题"
                    onPress={() => saveQuestion(m.id)}
                  />
                ) : null}
                {m.attachments?.filter(a => a.url && (m.role === "assistant" || !isImageAttachment(a))).map((a, index) => <GeneratedFile key={index} url={a.url!} filename={a.filename} mime={a.mime_type} />)}
                {m.role === "user" ? (
                  <Prose text={m.content} />
                ) : (
                  dialogueParts(
                    displayBody(m) || (busy ? "正在思考…" : ""),
                    m.events,
                  ).map((part, index) => (
                    <View
                      key={index}
                      style={
                        part.role === "user"
                          ? {
                              backgroundColor: C.pale,
                              padding: 12,
                              borderRadius: 12,
                              marginVertical: 10,
                            }
                          : undefined
                      }
                    >
                      {part.role === "user" ? (
                        <Text style={s.label}>我的回答</Text>
                      ) : null}
                      <Prose text={part.text} streaming={busy && i === messages.length - 1} />
                      <ReadAloud text={part.text} conversation={sessionId || 'new'} disabled={busy} />
                    </View>
                  ))
                )}
                {(m.events || [])
                  .filter(
                    (e) => e.type === "tool_result" || e.type === "result",
                  )
                  .map((e, index) => {
                    const meta = object(e.metadata);
                    const tool = object(meta.tool_metadata);
                    const mastery =
                      tool.mastery_question || meta.mastery_question;
                    const grade = object(
                      tool.mastery_grade || meta.mastery_grade,
                    );
                    const payload =
                      mastery ||
                      tool.visualization ||
                      meta.visualization ||
                      tool.result ||
                      meta.result ||
                      meta.data ||
                      (e.type === "result"
                        ? { ...meta, response: undefined }
                        : undefined);
                    return (
                      <View key={index}>
                        {payload ? (
                          <Content
                            value={payload}
                            onAnswer={
                              mastery
                                ? async (q, answer) => {
                                    if (sending.current)
                                      throw new Error("请等待当前讲解完成。");
                                    await send(answer, {
                                      mastery_answer: {
                                        question_id: string(q.question_id),
                                        text: answer,
                                      },
                                    });
                                  }
                                : async (q, answer) => {
                                    if (sending.current)
                                      throw new Error("请等待当前讲解完成。");
                                    await send(
                                      `我的答案是：${answer}。请帮我检查思路并讲解。`,
                                      {
                                        capability: "deep_question",
                                        config: {},
                                        followup_question_context: q,
                                      },
                                    );
                                  }
                            }
                          />
                        ) : null}
                        {Object.keys(grade).length ? (
                          <View style={s.notice}>
                            <Text style={s.h2}>
                              {grade.is_correct === true
                                ? "理解正确"
                                : grade.is_correct === false
                                  ? "再想一想"
                                  : "需要进一步说明"}
                            </Text>
                            <Prose text={grade.feedback || grade.explanation} />
                          </View>
                        ) : null}
                        {traceOpen ? (
                          <>
                            <Text style={s.muted}>
                              {e.type === "tool_result"
                                ? "处理结果"
                                : "学习成果"}
                            </Text>
                            <Prose text={e.content} />
                          </>
                        ) : null}
                      </View>
                    );
                  })}
              </View>
            ))}
          {waitingCard ? (
            <View style={[s.card, { gap: 12 }]}>
              <Text style={s.h2}>轮到你想一想</Text>
              <Prose text={waitingCard.question} />
              {array(waitingCard.questions).map((q, i) => {
                const item = object(q);
                const key = string(item.id) || String(i);
                const choices = array(item.options);
                return (
                  <View key={key} style={{ gap: 8 }}>
                    <Prose text={item.prompt} />
                    {choices.length ? (
                      <Chips
                        value={answers[key] || ""}
                        onChange={(v) =>
                          setAnswers((a) => ({ ...a, [key]: v }))
                        }
                        items={choices.map((c, j) =>
                          typeof c === "string"
                            ? { value: c, label: c }
                            : {
                                value: string(object(c).label) || String(j),
                                label:
                                  string(object(c).label) ||
                                  string(object(c).text) ||
                                  string(object(c).body),
                              },
                        )}
                      />
                    ) : null}
                    <Field
                      label="你的想法"
                      value={answers[key] || ""}
                      onChangeText={(v) =>
                        setAnswers((a) => ({ ...a, [key]: v }))
                      }
                      multiline
                    />
                  </View>
                );
              })}
              <Button
                title="提交回答并继续"
                busy={replyBusy}
                onPress={() => void send()}
              />
            </View>
          ) : null}
          {notice ? <Text style={s.muted}>{notice}</Text> : null}
          {draft.error ? <Text style={{ color: C.danger }}>草稿：{draft.error}</Text> : null}
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{ color: C.danger, lineHeight: 22 }}
            >
              {error}
            </Text>
          ) : null}
          {error && sessionId ? (
            <Button
              title="恢复学习进度"
              secondary
              onPress={() => void restoreProgress()}
            />
          ) : null}
        </ScrollView>
        <View
          style={{
            padding: 14,
            paddingBottom: 14,
            gap: 10,
            borderTopWidth: 1,
            borderTopColor: C.line,
            backgroundColor: C.white,
          }}
        >
          {!busy && keyboardVisible ? (
            <View style={{ alignSelf: "flex-start" }}>
              <SmallAction title="学习工具" icon="options-outline" onPress={() => Keyboard.dismiss()} />
            </View>
          ) : !busy ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <SmallAction
                title="切换模型"
                icon="hardware-chip-outline"
                onPress={() => setModelOpen(true)}
              />
              <SmallAction
                title="学习方式"
                icon="options-outline"
                onPress={() => setOptionsOpen(true)}
              />
              </View>
              <Text style={s.muted}>当前模型：{selectedModel(models, modelChoice)?.model || (modelChoice ? "已选模型，请检查是否可用" : "服务默认")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <SmallAction
                title={picking ? "选择中…" : "文件"}
                icon="attach-outline"
                disabled={picking}
                onPress={() => void chooseDocument()}
              />
              <SmallAction title="拍照" icon="camera-outline" onPress={() => void choosePhoto(true)} />
              <SmallAction title="相册" icon="images-outline" onPress={() => void choosePhoto(false)} />
              </View>
            </View>
          ) : null}
          {modelOpen && <ModelPicker value={modelChoice} onChange={setModelChoice} onClose={() => setModelOpen(false)} />}
          {document ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 8,
              }}
            >
              <Text numberOfLines={2} style={[s.muted, { flex: 1 }]}>
                {document.name} · 发送后提交
              </Text>
              <SmallAction title="移除" onPress={() => setDocument(null)} />
            </View>
          ) : null}
          {photo && (
            <View
              style={{
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                paddingBottom: 10,
              }}
            >
              <Image
                source={{ uri: photo.uri }}
                style={{ width: 52, height: 52, borderRadius: 9 }}
              />
              <Text style={[s.muted, { flex: 1 }]}>照片已就绪，点击发送后开始识别</Text>
              <Pressable
                accessibilityLabel="移除照片"
                accessibilityRole="button"
                style={s.iconButton}
                onPress={() => setPhoto(undefined)}
              >
                <Icon name="close-circle-outline" />
              </Pressable>
            </View>
          )}
          {busy && (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <Text style={[s.muted, { flex: 1 }]}>
                {stopping ? "正在停止，请稍候…" : status}
              </Text>
              <SmallAction title={stopping ? "停止中" : "停止"} icon="stop-circle-outline" disabled={stopping} onPress={stopTurn} />
            </View>
          )}
          <View
            style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}
          >
            <TextInput
              accessibilityLabel="输入问题"
              placeholder="把问题告诉我…"
              value={text}
              onChangeText={value => { draft.edited(); setText(value); }}
              editable={draft.ready && (!busy || waiting)}
              multiline
              style={[
                s.input,
                { flex: 1, maxHeight: 125, backgroundColor: C.bg },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="发送问题"
              disabled={!draft.ready || (busy && !waiting) || !text.trim()}
              onPress={() => void send()}
              style={{
                backgroundColor: C.teal,
                borderRadius: 16,
                width: 50,
                height: 52,
                alignItems: "center",
                justifyContent: "center",
                opacity: (busy && !waiting) || !text.trim() ? 0.4 : 1,
              }}
            >
              <Icon name="arrow-up" color={C.white} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      {threadsOpen ? <ChatThreads sessionId={sessionId} onClose={() => setThreadsOpen(false)} /> : null}
      {sourceOpen && source ? <ThreadSourceEditor sessionId={sessionId} source={source} onClose={() => setSourceOpen(false)} onSave={value => setContext(c => ({ ...c, selection_tutor_context: value }))} /> : null}
      {editingMessage ? <Editor title="修改后再问" fields={[{ key: "content", label: "问题内容", multiline: true, required: true, value: editingMessage.content }]} onClose={() => setEditingMessage(null)} beforeFields={() => <Text style={s.muted}>会保留原来的对话版本，并使用当前选择的模型重新回答。原附件也会保留。</Text>} onSave={async values => {
        const parent = editingMessage.parent_message_id ?? null;
        const accepted = await send(values.content, { parent_message_id: parent, attachments: editingMessage.attachments || [] });
        if (!accepted) throw new Error("问题尚未提交，请检查连接后重试。修改内容已保留。");
        setBranches(old => { const next = { ...old }; delete next[String(parent)]; return next; });
      }} /> : null}
      {optionsOpen ? (
        <CapabilityOptions
          value={options}
          onChange={setOptions}
          onClose={() => setOptionsOpen(false)}
        />
      ) : null}
      {rename ? (
        <Editor
          title="修改对话标题"
          fields={[
            {
              key: "title",
              label: "对话标题",
              value: renameText,
              required: true,
            },
          ]}
          onClose={() => setRename(false)}
          onSave={async (values) => {
            if (!api || !sid.current) return;
            const title = values.title.trim().slice(0, 100);
            await api.json(
              `/api/sessions/${encodeURIComponent(sid.current)}`,
              { title },
              "PATCH",
            );
            setTitle(title);
          }}
        />
      ) : null}
    </Page>
  );
}
