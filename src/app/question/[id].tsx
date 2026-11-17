import { PrivateImage } from "../../components/PrivateImage";
import { QuestionImage } from "../../components/QuestionImage";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../lib/auth";
import { type ChatAttachment, type Question } from "../../lib/client";
import { questionDraft, type Photo } from "../../lib/drafts";
import { pickQuestionPhoto } from "../../lib/pick-photo";
import {
  recognizeQuestion,
  type RecognitionResult,
} from "../../lib/question-recognition";
import type { ModelSelection } from "../../lib/models";
import type { JudgeSocket } from "../../lib/quiz-judge";
import { ModelPicker } from "../../features/model-picker";
import { useResource } from "../../lib/resources";
import { Editor, confirmDelete, Prose } from "../../features/common";
import { questionUpdate } from "../../lib/learning-records";
import { copyQuestionImages } from "../../lib/question-images";
import { saveQuestionEntry } from "../../lib/question-entry";
import {
  Button,
  C,
  Failure,
  Field,
  Heading,
  Icon,
  Loading,
  Page,
  Section,
  s,
} from "../../ui";
function NewQuestion() {
  const { api } = useAuth();
  const [draft] = useState(() => (api ? questionDraft.take(api) : undefined));
  const [question, setQuestion] = useState(draft?.question || "");
  const [answer, setAnswer] = useState(draft?.user_answer || "");
  const [correct, setCorrect] = useState(draft?.correct_answer || "");
  const [explanation, setExplanation] = useState(draft?.explanation || "");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [photo, setPhoto] = useState<Photo>();
  const [images, setImages] = useState(draft?.images || []);
  const [source, setSource] = useState({
    session_id: draft?.session_id || "",
    turn_id: draft?.turn_id || "",
  });
  const [options, setOptions] = useState(draft?.options || {});
  const [candidate, setCandidate] = useState<RecognitionResult>();
  const [uncertainties, setUncertainties] = useState<string[]>([]);
  const [recognitionError, setRecognitionError] = useState("");
  const [recognitionSession, setRecognitionSession] = useState("");
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [modelPicker, setModelPicker] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  const [id] = useState(
    () =>
      draft?.question_id ||
      `mobile_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );
  const attachment = (value: Photo): ChatAttachment => ({
    type: "image",
    base64: value.base64,
    filename: value.filename,
    mime_type: "image/jpeg",
  });
  function applyRecognition(result: RecognitionResult, value: Photo) {
    setQuestion(result.question);
    setAnswer(result.user_answer);
    setCorrect("");
    setExplanation("");
    setOptions({});
    setImages([attachment(value)]);
    setSource(result);
    setUncertainties(result.uncertainties);
    setCandidate(undefined);
    setPhoto(undefined);
  }
  async function extract(value: Photo) {
    if (!api) return;
    const controller = new AbortController();
    abort.current = controller;
    setRecognitionError("");
    setCandidate(undefined);
    setRecognitionSession("");
    try {
      const NativeSocket = WebSocket as unknown as new (
        url: string,
        protocols: null,
        opts: { headers: Record<string, string> },
      ) => JudgeSocket;
      const result = await recognizeQuestion(
        api,
        attachment(value),
        model,
        (url, headers) => new NativeSocket(url, null, { headers }),
        controller.signal,
        (session) => {
          if (alive.current && !api.isClosed) setRecognitionSession(session);
        },
      );
      if (!alive.current || api.isClosed || controller.signal.aborted) return;
      if (!result.question) {
        setUncertainties(result.uncertainties);
        setRecognitionError(
          "没能提取到完整题目。请检查照片是否清晰、是否只包含一道题，或更换识图模型后重试。",
        );
      } else if (
        question.trim() ||
        answer.trim() ||
        correct.trim() ||
        explanation.trim() ||
        images.length
      ) {
        setCandidate(result);
      } else applyRecognition(result, value);
    } catch (e) {
      if (alive.current && !api.isClosed)
        setRecognitionError((e as Error).message);
    } finally {
      abort.current = null;
    }
  }
  async function pick(camera: boolean) {
    if (!api || running.current || busy) return;
    running.current = true;
    setWorking(true);
    try {
      const selected = await pickQuestionPhoto(api, camera);
      if (!selected || !alive.current || api.isClosed) return;
      setPhoto(selected);
      setCandidate(undefined);
      setUncertainties([]);
      await extract(selected);
    } catch (e) {
      if (alive.current && !api.isClosed)
        setRecognitionError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setWorking(false);
    }
  }
  async function retry() {
    if (!photo || running.current || busy) return;
    running.current = true;
    setWorking(true);
    try {
      await extract(photo);
    } finally {
      running.current = false;
      if (alive.current) setWorking(false);
    }
  }
  async function save() {
    if (!api || running.current || busy || photo || !question.trim()) return;
    running.current = true;
    setBusy(true);
    try {
      const copies = images.length
        ? await copyQuestionImages(api, images, id)
        : undefined;
      await saveQuestionEntry(
        api,
        {
          id,
          ...source,
          options,
          question,
          user_answer: answer,
          correct_answer: correct,
          explanation,
        },
        copies,
      );
      if (alive.current && !api.isClosed) router.replace("/(tabs)/mistakes");
    } catch (e) {
      if (alive.current && !api.isClosed)
        Alert.alert("保存未确认", (e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
      running.current = false;
    }
  }
  return (
    <Page>
      <Heading title="记录一道错题" sub="校对后再保存，方便以后回顾" back />
      <View style={{ gap: 18 }}>
        <View style={[s.card, { gap: 12 }]}>
          <Text style={s.rowTitle}>拍一下，不用抄题</Text>
          <Text style={s.muted}>
            一次拍一道题，裁剪后自动提取。确认前不会收进错题本。
          </Text>
          <Button
            title="拍照提取题目"
            icon="camera-outline"
            disabled={working || busy}
            onPress={() => void pick(true)}
          />
          <Button
            title="从相册选题目"
            icon="images-outline"
            secondary
            disabled={working || busy}
            onPress={() => void pick(false)}
          />
          <Button
            title={model ? "更换识图模型" : "识图模型：跟随当前默认"}
            icon="hardware-chip-outline"
            secondary
            disabled={working || busy}
            onPress={() => setModelPicker(true)}
          />
        </View>
        {photo && <QuestionImage uri={photo.uri} />}
        {working && (
          <View style={{ gap: 10 }}>
            <Text style={s.muted}>正在提取题目和已有作答，请稍等…</Text>
            <Button
              title="停止识别"
              secondary
              onPress={() => abort.current?.abort()}
            />
          </View>
        )}
        {!!recognitionError && (
          <Text accessibilityRole="alert" style={{ color: C.danger }}>
            {recognitionError}
          </Text>
        )}
        {(candidate?.uncertainties || uncertainties).map((text, i) => (
          <Text key={i} style={s.muted}>
            需校对：{text}
          </Text>
        ))}
        {candidate && photo && (
          <View style={[s.card, { gap: 12 }]}>
            <Text style={s.rowTitle}>提取好了，请确认替换</Text>
            <Text selectable style={s.text}>
              {candidate.question}
            </Text>
            <Text selectable style={s.muted}>
              我的作答：{candidate.user_answer || "照片中未识别到作答"}
            </Text>
            <Text style={s.muted}>
              下面已有内容尚未改动。使用新题目时，会清空原来的正确答案和讲解，避免混到另一道题。
            </Text>
            <Button
              title="使用这道题和原图"
              onPress={() => applyRecognition(candidate, photo)}
            />
          </View>
        )}
        {photo && !working && (
          <View style={{ gap: 10 }}>
            <Button
              title="重新识别这张照片"
              secondary
              onPress={() => void retry()}
            />
            <Button
              title="保留这张照片，手动校对"
              secondary
              onPress={() => {
                setImages([attachment(photo)]);
                setSource({ session_id: "", turn_id: "" });
                setPhoto(undefined);
                setCandidate(undefined);
                setRecognitionError("");
              }}
            />
            <Button
              title="取消这张照片，保留原内容"
              secondary
              onPress={() => {
                setPhoto(undefined);
                setCandidate(undefined);
                setRecognitionError("");
                setUncertainties([]);
              }}
            />
          </View>
        )}
        {!!recognitionSession && !working && (
          <Button
            title="查看这次识别记录"
            secondary
            onPress={() =>
              router.push({
                pathname: "/chat/[id]",
                params: { id: recognitionSession },
              })
            }
          />
        )}
        {!photo && images.length ? (
          <>
            <Text style={s.muted}>
              原图会一起保存。请对照识别结果校对题目；看不清的地方可手动补充。
            </Text>
            {images.map((image, i) =>
              image.url ? (
                <PrivateImage key={i} path={image.url} />
              ) : image.base64 ? (
                <QuestionImage
                  key={i}
                  uri={`data:${image.mime_type || "image/jpeg"};base64,${image.base64}`}
                />
              ) : null,
            )}
          </>
        ) : null}
        <Field
          label="题目"
          value={question}
          onChangeText={setQuestion}
          multiline
          placeholder="输入或校对完整题干"
          editable={!working && !busy}
        />
        <Field
          label="我的作答"
          value={answer}
          onChangeText={setAnswer}
          multiline
          placeholder="当时是怎么答的？（可选）"
          editable={!working && !busy}
        />
        <Field
          label="正确答案"
          value={correct}
          onChangeText={setCorrect}
          placeholder="校对后填写（可选）"
          editable={!working && !busy}
        />
        <Field
          label="讲解与笔记"
          value={explanation}
          onChangeText={setExplanation}
          multiline
          placeholder="记下关键的一步（可选）"
          editable={!working && !busy}
        />
        <Button
          title="保存到我的错题本"
          busy={busy}
          disabled={!question.trim() || working || !!photo}
          onPress={() => void save()}
        />
      </View>
      {modelPicker && (
        <ModelPicker
          value={model}
          onChange={setModel}
          onClose={() => setModelPicker(false)}
          title="选择识图模型"
          sub="需要支持图片输入的模型，仅用于这次提取，不改变聊天默认设置"
        />
      )}
    </Page>
  );
}
function QuestionDetail({ id }: { id: string }) {
  const { api } = useAuth();
  const r = useResource<Question>(
    `/api/question-notebook/entries/${encodeURIComponent(id)}`,
  );
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const q = r.data;
  async function update(value: object) {
    if (!api || busy) return;
    setBusy(true);
    try {
      await api.json(
        `/api/question-notebook/entries/${encodeURIComponent(id)}`,
        value,
        "PATCH",
      );
      await r.reload();
    } catch (e) {
      Alert.alert("未能保存", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Heading
        title="回顾这道题"
        sub="先独立思考，再对照答案"
        back
        right={
          q ? (
            <Pressable
              accessibilityLabel={q.bookmarked ? "取消收藏" : "收藏错题"}
              disabled={busy}
              onPress={() => void update({ bookmarked: !q.bookmarked })}
              style={s.iconButton}
            >
              <Icon
                name={q.bookmarked ? "star" : "star-outline"}
                color={C.orange}
              />
            </Pressable>
          ) : undefined
        }
      />
      {r.error ? (
        <Failure message={r.error} retry={r.reload} />
      ) : !q ? (
        <Loading />
      ) : (
        <>
          <View style={[s.card, { gap: 16 }]}>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {q.categories?.map((c) => (
                <Text style={s.tag} key={c.id}>
                  {c.name}
                </Text>
              ))}
            </View>
            <Prose text={q.question} />
            {Object.entries(q.options || {}).map(([key, value]) => (
              <Text key={key} style={s.text}>
                {key}. {value}
              </Text>
            ))}
          </View>
          {q.user_answer ? (
            <>
              <Section title="当时的作答" />
              <View style={s.card}>
                <Text selectable style={s.text}>
                  {q.user_answer}
                </Text>
              </View>
            </>
          ) : null}
          {q.user_answer_images
            ?.filter((v) => v.url.startsWith("/") && !v.url.startsWith("//"))
            .map((v) => (
              <PrivateImage key={v.url} path={v.url} />
            ))}
          <View style={{ marginTop: 22 }}>
            <Button
              title={show ? "收起答案与讲解" : "想好了，查看答案与讲解"}
              secondary
              onPress={() => setShow(!show)}
            />
          </View>
          {show && (
            <>
              <Section title="答案与讲解" />
              <View style={[s.card, { gap: 15 }]}>
                <Prose
                  text={q.correct_answer || "这道题还没有保存标准答案。"}
                />
                <Prose
                  text={q.explanation || "可以请 DeepTutor 帮你重新讲解。"}
                />
              </View>
            </>
          )}
          <View style={{ gap: 12, marginTop: 20 }}>
            <Button
              title="请 DeepTutor 再讲一遍"
              icon="chatbubble-ellipses-outline"
              onPress={() =>
                router.push({
                  pathname: "/chat/[id]",
                  params: { id: "new", questionId: id },
                })
              }
            />
            <Button
              title={q.resolved ? "重新标为待回顾" : "我已回顾这道题"}
              secondary
              busy={busy}
              onPress={() => void update({ resolved: !q.resolved })}
            />
            <Button
              title="编辑题目与笔记"
              secondary
              disabled={busy}
              onPress={() => setEditing(true)}
            />
            <Button
              title="删除这道题"
              secondary
              disabled={busy}
              onPress={() =>
                confirmDelete("这道题", async () => {
                  if (!api) return;
                  await api.request(
                    `/api/question-notebook/entries/${encodeURIComponent(id)}`,
                    { method: "DELETE" },
                  );
                  router.replace("/(tabs)/mistakes");
                })
              }
            />
          </View>
        </>
      )}
      {editing && q ? (
        <Editor
          title="编辑题目与笔记"
          fields={[
            {
              key: "question",
              label: "题目",
              value: q.question,
              multiline: true,
              required: true,
            },
            {
              key: "user_answer",
              label: "我的作答",
              value: q.user_answer,
              multiline: true,
            },
            {
              key: "correct_answer",
              label: "正确答案",
              value: q.correct_answer,
              multiline: true,
            },
            {
              key: "explanation",
              label: "讲解与笔记",
              value: q.explanation,
              multiline: true,
            },
          ]}
          onClose={() => setEditing(false)}
          onSave={async (values) => {
            if (!api) return;
            await api.json(
              "/api/question-notebook/entries/upsert",
              questionUpdate(q, values),
            );
            await r.reload();
          }}
        />
      ) : null}
    </Page>
  );
}
export default function QuestionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return id === "new" ? <NewQuestion /> : <QuestionDetail id={id} />;
}
