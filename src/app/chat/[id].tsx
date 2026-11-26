import { subscribeConversationDeletion } from "../../lib/conversation-lifecycle";
import { ConversationCacheContext } from "../../lib/conversation-cache-context";
import { ownTemporaryFile, assignConversationFile } from "../../lib/temporary-files";
import { pickQuestionPhoto } from "../../lib/pick-photo";
import { isImageAttachment, outgoingAttachments } from "../../lib/chat-attachments";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
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
  ApiError,
  Question,
  ChatAttachment,
  streamText,
} from "../../lib/client";
import { activeSessionTurn, messagesForTurnReplay, reachedReplayHead, type SessionTurn } from "../../lib/active-turn";
import {
  PHOTO_QUESTION_PROMPT,
  photoQuestionDraft,
} from "../../lib/photo-question";
import { PrivateImage } from "../../components/PrivateImage";
import { QuestionImage } from "../../components/QuestionImage";
import { ChatComposer } from "../../components/ChatComposer";
import { MessageActions } from "../../components/MessageActions";
import { ChatBubbleContext } from "../../lib/chat-bubble-context";
import { judgeVerdict, questionOptions, questionSubmission, recordedMasteryMistakes, saveJudgedMistake, studyQuestions, type StudyQuestion } from "../../lib/chat-study";
import { judgeQuizAnswer, type JudgeSocket } from "../../lib/quiz-judge";
import { Photo, photoDraft, questionDraft, chatDraft } from "../../lib/drafts";
import { Button, C, Empty, Field, Heading, Icon, Page, s } from "../../ui";

import {
  CapabilityOptions,
  defaultOptions,
  capabilityLabels,
  personaLabels,
} from "../../features/capabilities";
import { Content, QuestionCard, Data, object, array, string } from "../../features/content";
import {
  dialogueParts,
  conversationTitle,
  compactConversationTitle,
  visibleMessage,
  cancelledTurn,
} from "../../lib/conversation";
import { Chips, Editor, FormModal, Prose, SmallAction, ask } from "../../features/common";
import { useConversationDelete } from "../../features/conversation-delete";
import { GeneratedFile } from "../../features/generated-file";
import { ChatThreads, ThreadSourceEditor } from "../../features/chat-threads";
import { tutorSource, threadSource, visibleBranch, type SourceContext } from "../../lib/chat-actions";
import { useComposerDraft } from "../../lib/use-composer-draft";
import { mergeChatOptions, type ChatOptions } from "../../lib/learning-options";
import { ModelPicker } from "../../features/model-picker";
import { loadModelOptions, resolveTurnModel, selection, selectedModel, supportsTurnReasoning, type ModelSelection, type ModelOptions } from "../../lib/models";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [removed, setRemoved] = useState(false);
  const [messageMenu, setMessageMenu] = useState<{ message: Message; text: string } | null>(null);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [answerKey, setAnswerKey] = useState('');
  const [judging, setJudging] = useState(false);
  const [studyAnswers, setStudyAnswers] = useState<Record<string, string>>({});
  const answerAbort = useRef<AbortController | null>(null);
  const judgedAnswers = useRef(new Map<string, string>());
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
  const chatModel = selectedModel(models, modelChoice);
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
  const questions = useMemo(() => studyQuestions(visibleBranch(messages, branches)), [messages, branches]);
  const activeQuestion = questions.find(q => q.key === answerKey) || questions.at(-1);
  useEffect(() => () => answerAbort.current?.abort(), []);
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
  const syncNeeded = useRef(id !== "new");
  const initialSnapshot = useRef(id !== "new");
  const syncInFlight = useRef(false);
  const syncAbort = useRef<AbortController | null>(null);
  const syncProgress = useRef<() => Promise<void>>(async () => {});
  const lastSocketFrame = useRef(0);
  const pingSentAt = useRef(0);
  const terminalRevision = useRef(0);
  const [reconnecting, setReconnecting] = useState(id !== "new");
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
  useEffect(() => {
    if (!api) return;
    return subscribeConversationDeletion(api, ids => {
      if (!ids.includes(sid.current || id)) return;
      alive.current = false;
      answerAbort.current?.abort();
      socket.current?.close(); socket.current = null;
      judgedAnswers.current.clear();
      setMessages([]); setPhoto(undefined); setDocument(null); setText('');
      setMessageMenu(null); setAnswerOpen(false); setRecordOpen(false); setRemoved(true);
    });
  }, [api, id]);
  const source = context.selection_tutor_context as SourceContext | undefined;
  const deletion = useConversationDelete(async () => {
    alive.current = false;
    answerAbort.current?.abort();
    socket.current?.close(); socket.current = null;
    try { await draft.discard(); } finally { router.replace('/history'); }
  });
  async function choosePhoto(camera: boolean) {
    if (!api || picking || sending.current || deletion.isDeleting()) return;
    setPicking(true);
    try {
      const selected = await pickQuestionPhoto(api, camera, sid.current || id);
      if (selected && alive.current) {
        draft.edited();
        setPhoto(selected);
        if (!text.trim()) setText(PHOTO_QUESTION_PROMPT);
      }
    } catch (e) { if (alive.current) Alert.alert("未能取得照片", (e as Error).message); }
    finally { if (alive.current) setPicking(false); }
  }
  async function startThread(message: Message) {
    if (!api || !sid.current || busy || deletion.isDeleting()) return;
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
      try {
        socket.current.send(JSON.stringify({
          type: "cancel_turn",
          protocol_version: "2.0",
          turn_id: cancel.turnId,
          command_id: `cancel_${Date.now()}`,
        }));
      } catch {
        requestProgressSync();
      }
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
      file.uri = await ownTemporaryFile(api, file.uri, file.name, sid.current || id);
      setDocument(file);
    } catch (e) {
      Alert.alert("未能添加附件", (e as Error).message);
    } finally {
      setPicking(false);
    }
  }
  function requestProgressSync() {
    if (!sid.current || !alive.current || api?.isClosed) return;
    syncNeeded.current = true;
    setReconnecting(true);
  }
  async function send(override?: string, extra: Data = {}, resume?: SessionTurn) {
    if (!api || deletion.isDeleting()) return;
    const resumeId = resume?.id || "";
    if (!resumeId && (syncNeeded.current || syncInFlight.current || reconnecting)) return;
    if (waitingRef.current && !resumeId) {
      if (replyPending.current) return;
      if (socket.current?.readyState !== WebSocket.OPEN) {
        requestProgressSync();
        return;
      }
      const content = override || text.trim();
      const entries = Object.entries(answers)
        .filter(([, v]) => v.trim())
        .map(([questionId, text]) => ({ questionId, text }));
      if (!content && !entries.length) return;
      replyPending.current = true;
      setReplyBusy(true);
      try {
        socket.current.send(JSON.stringify({
          protocol_version: "2.0",
          type: "submit_user_reply",
          turn_id: turn.current,
          command_id: `reply_${Date.now()}`,
          ...(content ? { text: content } : {}),
          ...(entries.length ? { answers: entries } : {}),
        }));
        setStatus("正在提交回答…");
      } catch {
        requestProgressSync();
      }
      return;
    }
    if (sending.current || (!resumeId && !(override || text).trim())) return;
    sending.current = true;
    turn.current = resumeId;
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
      const allowReasoning = !!(currentModels && modelChoice?.reasoning_effort && await supportsTurnReasoning(api));
      const turnModel = currentModels ? resolveTurnModel(currentModels, modelChoice, allowReasoning) : undefined;
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
      const releaseSocket = api.onClose(() => ws.close());
      socket.current = ws;
      let terminal = false;
      let opened = false;
      let response = "";
      let lastSeq = 0;
      let eventTrace: TurnEvent[] = [];
      let admitted = false;
      let replaying = !!resumeId;
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
        if (!syncNeeded.current) setReconnecting(false);
        setStatus("");
        if (msg) setError(msg);
      };
      const disconnect = (msg: string) => {
        if (terminal || !alive.current || api.isClosed || socket.current !== ws) return;
        finish(sid.current ? "" : msg);
        requestProgressSync();
        if (ws.readyState < WebSocket.CLOSING) ws.close();
      };
      const sendPacket = (packet: Data) => {
        try { ws.send(JSON.stringify(packet)); }
        catch { disconnect("连接中断。请在「进行中」确认任务是否已经开始。"); }
      };
      const timeout = setTimeout(() => {
        if (!opened) {
          disconnect("连接超时，内容尚未提交，可以重试。");
        }
      }, 20000);
      let replayTimeout: ReturnType<typeof setTimeout> | undefined;
      ws.onopen = () => {
        clearTimeout(timeout);
        if (!alive.current || socket.current !== ws) {
          ws.close();
          return;
        }
        opened = true;
        lastSocketFrame.current = Date.now();
        pingSentAt.current = 0;
        if (cancellation.current.requested && !resumeId) {
          finish();
          ws.close();
          return;
        }
        if (resumeId) {
          turn.current = resumeId;
          setStatus("正在恢复进度…");
          setMessages((v) => [
            ...v,
            { id: reply, role: "assistant", content: "" },
          ]);
          replayTimeout = setTimeout(() => {
            if (replaying) disconnect("未能恢复学习进度。");
          }, 20000);
          sendPacket({
            type: "subscribe_turn",
            protocol_version: "2.0",
            turn_id: resumeId,
            after_seq: 0,
          });
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
        sendPacket({
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
          question_notebook_references: questionId ? [Number(questionId)] : [],
          attachments: outgoingAttachments(image, filePayload, Array.isArray(extra.attachments) ? extra.attachments as ChatAttachment[] : []),
        });
      };
      ws.onmessage = (ev) => {
        if (!alive.current || socket.current !== ws) return;
        lastSocketFrame.current = Date.now();
        pingSentAt.current = 0;
        let event: TurnEvent;
        try {
          event = JSON.parse(String(ev.data));
        } catch {
          finish("服务返回了无法识别的内容，请恢复进度后重试。");
          ws.close();
          return;
        }
        if (event.type === "pong") return;
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
            setAnswerOpen(false);
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
        if (replaying && resume && reachedReplayHead(resume, event, lastSeq)) {
          replaying = false;
          clearTimeout(replayTimeout);
          if (!syncNeeded.current) setReconnecting(false);
        }
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
          if (image?.uri) assignConversationFile(api, image.uri, event.session_id);
          if (attached?.uri) assignConversationFile(api, attached.uri, event.session_id);
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
        if (sid.current && (tool.mastery_grade || meta.mastery_grade) && ['tool_result', 'result'].includes(event.type)) {
          void recordedMasteryMistakes(api, sid.current, event).then(rows => {
            if (rows.length && alive.current && !api.isClosed && !deletion.isDeleting()) setNotice('答错的题已自动收进错题本。');
          }).catch(() => {
            if (alive.current && !api.isClosed) setNotice('暂时无法确认错题收录，可在底部“＋”中查看或记录。');
          });
        }
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
          if (!replaying) {
            setAnswers({});
            setAnswerOpen(false);
          }
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
          } else {
            finish(event.content || "这次讲解未完成，请查看学习进度后重试。");
            if (meta.error_code === "start_turn_rejected") requestProgressSync();
          }
        }
        if (event.type === "done") {
          terminalRevision.current++;
          finish();
          if (waitingRef.current) setAnswerOpen(false);
          setWaiting(false);
          waitingRef.current = false;
          setWaitingCard(null);
          ws.close();
          requestProgressSync();
          void syncProgress.current();
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        disconnect(
          opened
            ? "连接中断。请在「进行中」确认任务是否已经开始。"
            : "连接未建立，内容尚未提交，请重试。",
        );
      };
      ws.onclose = () => {
        releaseSocket();
        clearTimeout(timeout);
        clearTimeout(replayTimeout);
        if (!terminal) disconnect("连接已断开。请在「进行中」确认任务是否已经开始。");
      };
      return resumeId ? true : await admission;
    } catch (e) {
      if (alive.current && !api.isClosed) {
        if (resumeId && (!(e instanceof ApiError) || ![401, 403, 404].includes(e.status || 0))) {
          requestProgressSync();
        } else {
          setReconnecting(false);
          setError((e as Error).message);
        }
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
    return () => {
      alive.current = false;
      syncAbort.current?.abort();
      socket.current?.close();
      socket.current = null;
    };
  }, [api, id]);

  // Use the latest composer state only for foreground actions. The focus
  // subscription should not restart when an answer or draft changes.
  useEffect(() => { syncProgress.current = restoreProgress; });
  useFocusEffect(useCallback(() => {
    if (!api) return;
    const tick = () => {
      if (AppState.currentState === "background" || AppState.currentState === "inactive") return;
      if (syncNeeded.current) {
        void syncProgress.current();
        return;
      }
      const ws = socket.current;
      if (!sending.current || !turn.current || ws?.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (pingSentAt.current) {
        if (now - pingSentAt.current >= 10000) {
          syncNeeded.current = true;
          setReconnecting(true);
          ws.close();
          void syncProgress.current();
        }
      } else if (now - lastSocketFrame.current >= 10000) {
        pingSentAt.current = now;
        try { ws.send(JSON.stringify({ type: "ping", protocol_version: "2.0" })); }
        catch { ws.close(); }
      }
    };
    const refresh = () => {
      if (!sid.current || !alive.current || api.isClosed) return;
      syncNeeded.current = true;
      setReconnecting(true);
      tick();
    };
    refresh();
    const timer = setInterval(tick, 3500);
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
      else syncAbort.current?.abort();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      syncAbort.current?.abort();
    };
  }, [api]));

  function applyInitialPreferences(prefs: Record<string, unknown>) {
    setModelChoice(selection(prefs.llm_selection));
    setOptions(old => ({
      ...old,
      ...(typeof prefs.capability === "string" ? { capability: prefs.capability } : {}),
      ...(typeof prefs.persona === "string" ? { persona: prefs.persona } : {}),
      ...(prefs.config ? { config: object(prefs.config) } : {}),
      ...(Array.isArray(prefs.knowledge_bases) ? { knowledge_bases: prefs.knowledge_bases as string[] } : {}),
    }));
    const contextKeys = [
      "reading_material_id", "reading_material_revision", "reading_workspace_id",
      "reading_viewport", "workspace_mode", "mastery_path_id", "mastery_session_mode",
      "note_document_id", "knowledge_bases", "book_references", "notebook_references",
    ];
    const source = tutorSource(prefs);
    setContext({
      ...Object.fromEntries(contextKeys.filter(k => prefs[k] !== undefined).map(k => [k, prefs[k]])),
      ...(source ? { selection_tutor_context: source } : {}),
    });
  }
  async function restoreProgress() {
    if (!api || api.isClosed || !alive.current || !sid.current || deletion.isDeleting() ||
        syncInFlight.current || (sending.current && !turn.current)) return;
    const controller = new AbortController();
    syncAbort.current = controller;
    syncInFlight.current = true;
    const observedSocket = socket.current;
    const currentSession = sid.current;
    const revision = terminalRevision.current;
    const wasRunning = sending.current;
    const path = `/api/sessions/${encodeURIComponent(currentSession)}`;
    const readSession = () => api.request<Session>(path, { signal: controller.signal }, true, 8000);
    try {
      let r = await readSession();
      let active = activeSessionTurn(r);
      // The server reads messages before active turns. If the turn just
      // ended between those reads, repeat once to fetch the saved answer.
      if (!active && (wasRunning || r.active_turn_id) &&
          !controller.signal.aborted && revision === terminalRevision.current) {
        r = await readSession();
        active = activeSessionTurn(r);
      }
      if (controller.signal.aborted || !alive.current || api.isClosed ||
          socket.current !== observedSocket || sid.current !== currentSession ||
          terminalRevision.current !== revision) return;
      // Rebuild the in-flight answer from the event log. Keep completed
      // messages and the original user prompt from the server snapshot.
      setMessages(messagesForTurnReplay(r.messages || [], active));
      setError("");
      setTitle(r.title || "学习对话");
      const prefs = r.preferences || {};
      setBranches(object(prefs.selected_branches) as Record<string, number>);
      if (initialSnapshot.current) {
        initialSnapshot.current = false;
        applyInitialPreferences(prefs);
      }
      socket.current = null;
      observedSocket?.close();
      syncNeeded.current = false;
      sending.current = false;
      setBusy(false);
      replyPending.current = false;
      setReplyBusy(false);
      setStopping(false);
      const wasWaiting = waitingRef.current;
      waitingRef.current = false;
      setWaiting(false);
      setWaitingCard(null);
      if (active) {
        setReconnecting(true);
        await send(undefined, {}, active);
      } else {
        turn.current = "";
        setStatus("");
        setReconnecting(false);
        if (wasWaiting) setAnswerOpen(false);
      }
    } catch (e) {
      if (!controller.signal.aborted && alive.current && !api.isClosed) {
        if (e instanceof ApiError && [401, 403, 404].includes(e.status || 0)) {
          syncNeeded.current = false;
          setReconnecting(false);
          setError(e.message);
        } else {
          requestProgressSync();
        }
      }
    } finally {
      if (syncAbort.current === controller) syncAbort.current = null;
      syncInFlight.current = false;
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
  function closeAnswers() { answerAbort.current?.abort(); setAnswerOpen(false); }
  async function submitStudyAnswer(q: StudyQuestion, answer: string) {
    if (!api || !alive.current || sending.current || judging || answerAbort.current || deletion.isDeleting()) throw Error('请等待当前操作完成。');
    const controller = new AbortController(); answerAbort.current = controller;
    const assertActive = () => { api.assertOpen(); if (!alive.current || controller.signal.aborted || deletion.isDeleting()) throw Error('已取消这次操作。'); };
    setJudging(true);
    try {
      let feedback = '', collected = false;
      if (!q.mastery) {
        const key = JSON.stringify([q.key, answer]);
        feedback = judgedAnswers.current.get(key) || await judgeQuizAnswer(api, q, answer,
          (url, headers) => new NativeSocket(url, null, { headers }) as unknown as JudgeSocket, controller.signal);
        assertActive(); judgedAnswers.current.set(key, feedback);
        if (judgedAnswers.current.size > 30) judgedAnswers.current.delete(judgedAnswers.current.keys().next().value!);
        const saved = await saveJudgedMistake(api, sid.current, q, answer, feedback, judgeVerdict(feedback), assertActive);
        collected = !!saved;
      }
      assertActive(); setStudyAnswers(old => ({ ...old, [q.key]: answer }));
      const submission = questionSubmission(q, answer, feedback, judgeVerdict(feedback));
      const accepted = await send(submission.content, submission.context);
      assertActive();
      if (!accepted) throw Error('答案未能提交到对话，请重试。已经收录的错题不会重复新建。');
      setAnswerOpen(false);
      if (collected) setNotice('答错的题已自动收进错题本。');
    } finally { if (answerAbort.current === controller) answerAbort.current = null; if (alive.current) setJudging(false); }
  }
  async function recordStudyQuestion(q: StudyQuestion) {
    if (!api || deletion.isDeleting()) return;
    try {
      const questionId = string(q.data.question_id) || `mobile:${q.key}`;
      try {
        const saved = await api.request<Question>(`/api/question-notebook/entries/lookup/by-question?session_id=${encodeURIComponent(sid.current)}&question_id=${encodeURIComponent(questionId)}&turn_id=${encodeURIComponent(q.turnId)}`);
        if (!alive.current || api.isClosed) return;
        if (saved?.id) { setRecordOpen(false); router.push(`/question/${saved.id}`); return; }
      } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
      api.assertOpen(); if (!alive.current) return;
      questionDraft.set(api, { question: string(q.data.question || q.data.prompt), correct_answer: string(q.data.correct_answer),
        explanation: string(q.data.explanation), user_answer: studyAnswers[q.key] || string(q.data.user_answer),
        options: questionOptions(q.data.options), session_id: sid.current, turn_id: q.turnId, question_id: questionId });
      setRecordOpen(false); router.push('/question/new');
    } catch (e) { if (alive.current) Alert.alert('暂时不能记录', (e as Error).message); }
  }
  function openMessage(message: Message, text = message.content) {
    if (busy || judging || deletion.isDeleting()) return;
    Keyboard.dismiss(); setMessageMenu({ message, text });
  }
  if (removed) return <Page><Heading title="对话已删除" /><Empty title="聊天记录已清除" detail="已收进错题本的题目仍然保留。" /><Button title="返回历史对话" onPress={() => router.replace('/history')} /></Page>;
  return (
    <ConversationCacheContext.Provider value={sessionId || id}><Page scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        automaticOffset
        enabled={!rename}
      >
        <View style={{ paddingHorizontal: 18 }}>
          <Heading
            title={sessionId ? compactConversationTitle(title, 12) : "问一问"}
            compact
            titleLines={1}
            sub={keyboardVisible ? undefined : `${personaLabels[options.persona] || options.persona} · ${capabilityLabels[options.capability] || options.capability}`}
            back
            right={
              <Pressable
                accessibilityLabel="对话菜单"
                accessibilityRole="button"
                style={s.iconButton}
                disabled={!!deletion.deleting}
                onPress={() => { Keyboard.dismiss(); setMenuOpen(true); }}
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
              <ChatBubbleContext.Provider key={m.id || String(i)} value={text => openMessage(m, text)}>
              <Pressable
                key={m.id || String(i)}
                onLongPress={() => openMessage(m)}
                accessibilityHint="长按打开消息操作"
                style={[
                  s.card,
                  {
                    padding: 12,
                    borderRadius: 16,
                    borderTopLeftRadius: m.role === 'assistant' ? 4 : 16,
                    borderTopRightRadius: m.role === 'user' ? 4 : 16,
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
              </Pressable>
              </ChatBubbleContext.Provider>
            ))}
          {waitingCard ? <ChatBubbleContext.Provider value={() => { Keyboard.dismiss(); setAnswerOpen(true); }}>
            <View style={[s.card, { gap: 8 }]}>
              <Text style={s.h2}>轮到你想一想</Text>
              <Content value={waitingCard} />
              <Text style={s.muted}>点底部“＋ → 提交答案”继续，也可以在输入框直接回答。</Text>
            </View>
          </ChatBubbleContext.Provider> : null}
          {deletion.deleting ? <Text accessibilityLiveRegion="polite" style={s.muted}>正在删除对话…</Text> : null}
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
              onPress={() => { requestProgressSync(); void restoreProgress(); }}
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
          {modelOpen && <ModelPicker value={modelChoice} allowReasoning
            onChange={value => { draft.edited(); setModelChoice(value); }} onClose={() => setModelOpen(false)} />}
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
          {(busy || reconnecting) && (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <Text style={[s.muted, { flex: 1 }]}>
                {reconnecting ? "正在恢复学习进度…" : stopping ? "正在停止，请稍候…" : status}
              </Text>
              {busy && <SmallAction title={stopping ? "停止中" : "停止"} icon="stop-circle-outline" disabled={stopping || reconnecting} onPress={stopTurn} />}
            </View>
          )}
          <ChatComposer
            text={text}
            onChangeText={value => { draft.edited(); setText(value); }}
            editable={draft.ready && !deletion.deleting && !judging && !replyBusy && (!busy || waiting)}
            sendDisabled={!draft.ready || !!deletion.deleting || reconnecting || judging || replyBusy || (busy && !waiting) || !text.trim()}
            toolsDisabled={!draft.ready || !!deletion.deleting || reconnecting || (busy && !waiting) || picking || judging}
            keyboardVisible={keyboardVisible}
            onSend={() => void send()}
            modelLabel={chatModel?.model || (modelChoice ? "已选模型，请检查是否可用" : "服务默认")}
            tools={[
              { key: "answer", title: "提交答案", icon: "checkmark-circle-outline", disabled: !waitingCard && !questions.length, onPress: () => setAnswerOpen(true) },
              { key: "mistake", title: "收进错题本", icon: "bookmark-outline", disabled: !messages.length, onPress: () => setRecordOpen(true) },
              { key: "album", disabled: busy, title: "相册", icon: "images-outline", onPress: () => void choosePhoto(false) },
              { key: "camera", disabled: busy, title: "拍照", icon: "camera-outline", onPress: () => void choosePhoto(true) },
              { key: "file", disabled: busy, title: "文件", icon: "attach-outline", onPress: () => void chooseDocument() },
              { key: "model", disabled: busy, title: "切换模型", icon: "hardware-chip-outline", onPress: () => setModelOpen(true) },
              { key: "learning", disabled: busy, title: "学习方式", icon: "options-outline", onPress: () => setOptionsOpen(true) },
            ]}
          />
        </View>
      </KeyboardAvoidingView>
      {answerOpen ? <FormModal onClose={closeAnswers}><Page>
        <Heading title="提交答案" right={<Button title="关闭" secondary onPress={closeAnswers} />} />
        {waitingCard ? null : <>
          {questions.length > 1 && <Chips value={activeQuestion?.key || ''}
            items={questions.map((q, i) => ({ value: q.key, label: `第 ${i + 1} 题` }))} onChange={setAnswerKey} />}
          {activeQuestion ? <QuestionCard key={activeQuestion.key} question={activeQuestion.data} showSave={false} answerValue={studyAnswers[activeQuestion.key] || ""}
            onAnswerChange={value => setStudyAnswers(old => ({ ...old, [activeQuestion.key]: value }))}
            onAnswer={answer => submitStudyAnswer(activeQuestion, answer)} /> : <Text style={s.muted}>还没有可作答的题目，可以先请 DeepTutor 出一道题。</Text>}
          {judging && <Text accessibilityLiveRegion="polite" style={s.muted}>正在判题，答错的题会自动收进错题本…</Text>}
        </>}
          {waitingCard ? (
            <View style={[s.card, { gap: 12 }]}>
              <Text style={s.h2}>轮到你想一想</Text>
              <Prose text={waitingCard.question} />
              {!array(waitingCard.questions).length && <Field label="你的想法" multiline editable={!replyBusy} value={text} onChangeText={value => { draft.edited(); setText(value); }} />}
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
                          !replyPending.current && setAnswers((a) => ({ ...a, [key]: v }))
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
                      editable={!replyBusy}
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
                title="提交答案"
                busy={replyBusy}
                disabled={reconnecting || replyBusy}
                onPress={() => void send()}
              />
            </View>
          ) : null}
      </Page></FormModal> : null}
      {recordOpen ? <FormModal onClose={() => setRecordOpen(false)}><Page>
        <Heading title="收进错题本" right={<Button title="关闭" secondary onPress={() => setRecordOpen(false)} />} />
        <Text style={s.muted}>已自动收录的题会打开原记录，不会再新建一份。</Text>
        {[...questions].reverse().map(q => <Button key={q.key} secondary
          title={compactConversationTitle(string(q.data.question || q.data.prompt), 24)} onPress={() => void recordStudyQuestion(q)} />)}
        {messages.filter(m => m.role === 'user').slice().reverse().map((m, i) => <Button key={m.id} secondary
          title={`${m.attachments?.some(isImageAttachment) ? '拍照题' : '我的提问'} ${messages.filter(x => x.role === 'user').length - i}：${compactConversationTitle(m.content, 16)}`}
          onPress={() => { setRecordOpen(false); saveQuestion(m.id); }} />)}
        {!messages.length && <Text style={s.muted}>先发送题目或照片，再从这里校对记录。</Text>}
      </Page></FormModal> : null}
      {messageMenu ? <MessageActions text={messageMenu.text} conversation={sessionId} onClose={() => setMessageMenu(null)}>
        {sessionId && !String(messageMenu.message.id).startsWith('mobile_') ? <>
          <Button title="单独追问" secondary icon="chatbubbles-outline" onPress={() => { const m = messageMenu.message; setMessageMenu(null); void startThread(m); }} />
          {messageMenu.message.role === 'user' && /^\d+$/.test(String(messageMenu.message.id)) && <Button title="修改后再问" secondary icon="create-outline"
            onPress={() => { setEditingMessage(messageMenu.message); setMessageMenu(null); }} />}
        </> : null}
        {Object.hasOwn(messageMenu.message, 'parent_message_id') && messages.filter(x => (x.parent_message_id ?? null) === (messageMenu.message.parent_message_id ?? null)).length > 1 ? <View style={{ gap: 8 }}>
          <Text style={s.label}>切换对话版本</Text>
          <Chips value={String(messageMenu.message.id)} items={messages.filter(x => (x.parent_message_id ?? null) === (messageMenu.message.parent_message_id ?? null)).map((x, i) => ({ value: String(x.id), label: `版本 ${i + 1}` }))}
            onChange={value => { const next = { ...branches, [String(messageMenu.message.parent_message_id ?? null)]: Number(value) };
              void api?.json(`/api/sessions/${encodeURIComponent(sessionId)}/branch-selection`, { selected_branches: next }, 'PUT').then(() => { setBranches(next); setMessageMenu(null); }).catch(e => Alert.alert('未能切换', e.message)); }} />
        </View> : null}
      </MessageActions> : null}
      {menuOpen ? <FormModal onClose={() => setMenuOpen(false)}><Page>
        <Heading title="对话操作" right={<Button title="关闭" compact secondary onPress={() => setMenuOpen(false)} />} />
        <View style={{ gap: 12 }}>
          {sessionId ? <Button title="查看或修改标题" icon="create-outline" secondary onPress={() => { setMenuOpen(false); setRenameText(title); setRename(true); }} /> : null}
          <Button title="学习方式" icon="options-outline" secondary onPress={() => { setMenuOpen(false); setOptionsOpen(true); }} />
          <Button title={traceOpen ? "收起学习过程" : "查看学习过程"} icon="list-outline" secondary onPress={() => { setMenuOpen(false); setTraceOpen(v => !v); }} />
          <Button title="恢复进度" icon="refresh-outline" secondary onPress={() => { setMenuOpen(false); void restoreProgress(); }} />
          {sessionId ? <>
            <Button title="查看单独追问" icon="chatbubbles-outline" secondary onPress={() => { setMenuOpen(false); setThreadsOpen(true); }} />
            <Button title="删除对话" icon="trash-outline" secondary danger onPress={() => { setMenuOpen(false); deletion.confirm(sessionId, title); }} />
          </> : null}
        </View>
      </Page></FormModal> : null}
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
          allowWorkspaceDefault={!sessionId}
          onChange={value => { draft.edited(); setOptions(value); }}
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
    </Page></ConversationCacheContext.Provider>
  );
}
