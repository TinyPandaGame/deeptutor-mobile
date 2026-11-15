import { PrivateImage } from "../../components/PrivateImage";
import { QuestionImage } from "../../components/QuestionImage";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../lib/auth";
import { Question } from "../../lib/client";
import { questionDraft } from "../../lib/drafts";
import { useResource } from "../../lib/resources";
import { Editor, confirmDelete, Prose } from "../../features/common";
import { questionUpdate } from "../../lib/learning-records";
import { copyQuestionImages } from "../../lib/question-images";
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
  const [id] = useState(
    () => `mobile_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );
  async function save() {
    if (!api || busy || !question.trim()) return;
    setBusy(true);
    try {
      const images = draft?.images?.length
        ? await copyQuestionImages(api, draft.images, id)
        : undefined;
      const saved = await api.json<Question>(
        "/api/question-notebook/entries/upsert",
        {
          origin_type: draft?.session_id ? "conversation" : "external_import",
          origin_ref: draft?.session_id || id,
          session_id: draft?.session_id || "",
          question_id: id,
          question: question.trim(),
          user_answer: answer,
          correct_answer: correct,
          explanation,
          ...(images ? { user_answer_images: images } : {}),
          source: "import",
          is_correct: false,
        },
      );
      if (
        draft?.images?.length &&
        saved.user_answer_images?.length !== draft.images.length
      )
        throw new Error(
          "文字已保存，但图片未完整保存。请保留本页并重试，不要重复新建题目。",
        );
      router.replace("/(tabs)/mistakes");
    } catch (e) {
      Alert.alert("保存未确认", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Heading title="记录一道错题" sub="校对后再保存，方便以后回顾" back />
      <View style={{ gap: 18 }}>
        {draft?.images?.length ? (
          <>
            <Text style={s.muted}>
              原图会一起保存。请对照识别结果校对题目；看不清的地方可手动补充。
            </Text>
            {draft.images.map((image, i) =>
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
        />
        <Field
          label="我的作答"
          value={answer}
          onChangeText={setAnswer}
          multiline
          placeholder="当时是怎么答的？（可选）"
        />
        <Field
          label="正确答案"
          value={correct}
          onChangeText={setCorrect}
          placeholder="校对后填写（可选）"
        />
        <Field
          label="讲解与笔记"
          value={explanation}
          onChangeText={setExplanation}
          multiline
          placeholder="记下关键的一步（可选）"
        />
        <Button
          title="保存到我的错题本"
          busy={busy}
          disabled={!question.trim()}
          onPress={() => void save()}
        />
      </View>
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
