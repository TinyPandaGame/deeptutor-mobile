import { useConversationCache } from "../lib/conversation-cache-context";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { QuestionImage } from "../components/QuestionImage";
import { Artifact } from "./artifact";
import { artifactPayload } from "../lib/artifact-payload";
import { VideoView, useVideoPlayer } from "expo-video";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { router } from "expo-router";
import { questionDraft } from "../lib/drafts";
import { useAuth } from "../lib/auth";
import { temporaryBytes } from "../lib/temporary-files";
import { Button, C, Field, s } from "../ui";
import { Chips, Prose, SmallAction } from "./common";
import { GeneratedFile } from "./generated-file";
import { useChatBubble } from "../lib/chat-bubble-context";
import { questionOptions } from "../lib/chat-study";
export type Data = Record<string, unknown>;
export function object(value: unknown): Data {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
}
export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function Video({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={{ width: "100%", height: 240 }} nativeControls contentFit="contain" />;
}
function Audio({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return <View style={{ gap: 10 }}>
    <Text style={s.muted}>{Math.floor(status.currentTime || 0)} / {Math.floor(status.duration || 0)} 秒</Text>
    <Button title={status.playing ? "暂停播放" : "播放音频"} onPress={() => status.playing ? player.pause() : player.play()} />
    <SmallAction title="从头播放" onPress={() => void player.seekTo(0)} />
  </View>;
}
function ProtectedMedia({ url, kind }: { url: string; kind: "image" | "audio" | "video" }) {
  const { api } = useAuth();
  const conversation = useConversationCache();
  const key = `${api?.scope}:${url}`;
  const [result, setResult] = useState({ key: "", uri: "", error: "" });
  useEffect(() => {
    let alive = true;
    if (api) void (async () => {
      try {
        const path = api.contentPath(url);
        const bytes = await api.download(path);
        if (!alive) return;
        const suffix = /\.([a-zA-Z0-9]{1,6})$/.exec(path.split("?")[0])?.[1] || ({ image: "jpg", audio: "mp3", video: "mp4" }[kind]);
        const uri = temporaryBytes(api, bytes, `media.${suffix}`, conversation);
        setResult({ key, uri, error: "" });
      } catch (e) { if (alive) setResult({ key, uri: "", error: (e as Error).message }); }
    })();
    return () => { alive = false; };
  }, [api, url, kind, key, conversation]);
  if (result.key !== key || !result.uri) return <Text style={s.muted}>{result.key === key && result.error || "正在读取素材…"}</Text>;
  return kind === "video" ? <Video key={result.uri} uri={result.uri} /> : kind === "audio" ? <Audio key={result.uri} uri={result.uri} /> : <QuestionImage key={result.uri} uri={result.uri} />;
}
export function QuestionCard({
  question,
  onAnswer,
  showSave = true,
  answerValue, onAnswerChange,
}: {
  question: Data;
  onAnswer?: (text: string) => Promise<void>;
  showSave?: boolean;
  answerValue?: string; onAnswerChange?: (value: string) => void;
}) {
  const bubble = useChatBubble();
  const { api } = useAuth();
  const [localAnswer, setLocalAnswer] = useState("");
  const answer = answerValue ?? localAnswer;
  const setAnswer = (value: string) => { setLocalAnswer(value); onAnswerChange?.(value); };
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = questionOptions(question.options);
  if (bubble) return <View style={{ gap: 8 }}>
    <Prose text={question.question || question.prompt} />
    {Object.entries(options).map(([label, body]) => <Text key={label} style={s.text}
      onLongPress={() => bubble(string(question.question || question.prompt))}>{label}  {String(body)}</Text>)}
  </View>;
  return (
    <View style={[s.card, { gap: 12 }]}>
      <Prose text={question.question || question.prompt} />
      {Object.keys(options).length ? (
        <Chips
          value={answer}
          onChange={setAnswer}
          items={Object.entries(options).map(([value, text]) => ({
            value,
            label: `${value}  ${String(text)}`,
          }))}
        />
      ) : null}
      <Field
        label="我的答案"
        value={answer}
        onChangeText={setAnswer}
        multiline
      />
      <Button
        title={onAnswer ? "提交答案" : "查看答案与讲解"}
        busy={busy}
        disabled={!answer.trim()}
        onPress={() => {
          if (!onAnswer) {
            setRevealed(true);
            return;
          }
          setBusy(true);
          setError("");
          void onAnswer(answer)
            .then(() => setRevealed(true))
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      />
      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
      {showSave && <SmallAction
        title="收进错题本"
        onPress={() => {
          if (api) {
            questionDraft.set(api, {
              question: string(question.question || question.prompt),
              correct_answer: string(question.correct_answer),
              explanation: string(question.explanation),
              user_answer: answer,
            });
            router.push("/question/new");
          }
        }}
      />}
      {revealed ? (
        <>
          <Prose text={question.correct_answer} />
          <Prose text={question.explanation} />
        </>
      ) : null}
    </View>
  );
}
function FlashCard({ card }: { card: Data }) {
  const [back, setBack] = useState(false);
  return (
    <View style={[s.card, { gap: 12 }]}>
      <Prose
        text={back ? card.back || card.answer : card.front || card.question}
      />
      <Button
        title={back ? "看正面" : "翻开答案"}
        secondary
        onPress={() => setBack((v) => !v)}
      />
    </View>
  );
}
export function Content({
  value,
  onAnswer,
  depth = 0,
}: {
  value: unknown;
  onAnswer?: (question: Data, text: string) => Promise<void>;
  depth?: number;
}) {
  if (depth > 8) return null;
  if (typeof value === "string") return <Prose text={value} />;
  if (Array.isArray(value))
    return (
      <View style={{ gap: 14 }}>
        {value.map((v, i) => (
          <Content key={i} value={v} onAnswer={onAnswer} depth={depth + 1} />
        ))}
      </View>
    );
  const d = object(value);
  if (!Object.keys(d).length) return null;
  const { source: codeText, kind: render, renderable } = artifactPayload(d);
  const text =
    string(d.body) ||
    string(d.markdown) ||
    string(d.text) ||
    string(d.content) ||
    string(d.summary) ||
    string(d.response) ||
    string(d.explanation);
  const media = string(d.video_url) || string(d.audio_url);
  const image = string(d.image_url);
  const fileUrl = string(d.file_url) || string(d.download_url);
  const children =
    d.subsections ||
    d.sections ||
    d.blocks ||
    d.items ||
    d.nodes ||
    d.events ||
    d.chapters ||
    d.entries ||
    d.results ||
    object(d.summary).results;
  return (
    <View style={{ gap: 12 }}>
      {d.title ? <Text style={s.h2}>{string(d.title)}</Text> : null}
      <Prose text={text} />
      {d.question || d.prompt ? (
        <QuestionCard
          question={d}
          onAnswer={onAnswer ? (t) => onAnswer(d, t) : undefined}
        />
      ) : null}
      {Array.isArray(d.questions)
        ? d.questions.map((q, i) => (
            <QuestionCard
              key={i}
              question={object(q)}
              onAnswer={onAnswer ? (t) => onAnswer(object(q), t) : undefined}
            />
          ))
        : null}
      {Array.isArray(d.cards)
        ? d.cards.map((c, i) => <FlashCard key={i} card={object(c)} />)
        : null}
      {renderable ? (
        <Artifact code={codeText} kind={render} />
      ) : codeText ? (
        <Prose text={codeText} />
      ) : null}
      {media ? (
        d.video_url ? (
          <ProtectedMedia kind="video" url={media} />
        ) : (
          <ProtectedMedia kind="audio" url={media} />
        )
      ) : null}
      {image ? (
        <ProtectedMedia kind="image" url={image} />
      ) : null}
      {fileUrl ? <GeneratedFile url={fileUrl} filename={string(d.filename) || string(d.name)} mime={string(d.mime_type) || undefined} /> : null}
      {children ? (
        <Content value={children} onAnswer={onAnswer} depth={depth + 1} />
      ) : null}
      {array(d.workspace_items).map((x, i) => {
        const item = object(x);
        const url = string(item.url);
        const mime = string(item.mime_type);
        return url && mime.startsWith("audio/") ? (
          <ProtectedMedia kind="audio" key={i} url={url} />
        ) : url && mime.startsWith("video/") ? (
          <ProtectedMedia kind="video" key={i} url={url} />
        ) : url ? <GeneratedFile key={i} url={url} filename={string(item.filename) || string(item.title)} mime={mime || undefined} /> : null;
      })}
      {d.payload ? (
        <Content value={d.payload} onAnswer={onAnswer} depth={depth + 1} />
      ) : null}
      {d.qa_pair ? (
        <Content value={d.qa_pair} onAnswer={onAnswer} depth={depth + 1} />
      ) : null}
    </View>
  );
}
