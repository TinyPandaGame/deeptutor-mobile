import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { ApiError, type TutorClient } from "../lib/client";
import {
  readingHintExcerpts, requestReadingQuizHelp, startReadingQuiz, submitReadingQuizAnswer,
  type ReadingQuizHelp, type ReadingQuizQuestion,
} from "../lib/reading-quiz";
import { Button, C, Empty, Heading, Icon, Page, Section, s } from "../ui";
import { FormModal, Prose } from "./common";

type Graded = { selected: number; correct: boolean };

function newRequestId() {
  return `mobile:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function ReadingQuiz({ materialId, locator, unitText, guidance }: {
  materialId: string; locator: number; unitText: string; guidance: boolean;
}) {
  const { api } = useAuth();
  const [questions, setQuestions] = useState<ReadingQuizQuestion[]>([]);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [graded, setGraded] = useState<Record<string, Graded>>({});
  const [hints, setHints] = useState<Record<string, ReadingQuizHelp>>({});
  const [stars, setStars] = useState<number>();
  const [hintQuestion, setHintQuestion] = useState<ReadingQuizQuestion>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const pieces = readingHintExcerpts(unitText);

  useEffect(() => () => pending.current?.abort(), [api]);

  function requestId(key: string) {
    const saved = requestIds.current.get(key);
    if (saved) return saved;
    const id = newRequestId();
    requestIds.current.set(key, id);
    return id;
  }

  function run(key: string, perform: (client: TutorClient, signal: AbortSignal) => Promise<void>) {
    if (!api || pending.current || api.isClosed) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(key);
    setError("");
    void perform(api, controller.signal).catch(e => {
      if (controller.signal.aborted || api.isClosed) return;
      const conflict = e instanceof ApiError && e.status === 409;
      setError(conflict
        ? key.startsWith("guide:") ? "暂未取得提示，请稍后重试。题目若已更新，请重新出题。" : "这组题可能已更新，请重新出题。"
        : (e as Error).message);
    }).finally(() => {
      if (pending.current !== controller) return;
      pending.current = null;
      if (!api.isClosed) setBusy("");
    });
  }

  function generate() {
    run("start", async (client, signal) => {
      const result = await startReadingQuiz(client, materialId, locator, signal);
      if (signal.aborted || client.isClosed) return;
      setQuestions(result.questions);
      setChoices({});
      setGraded({});
      setHints({});
      setStars(undefined);
      requestIds.current.clear();
    });
  }

  function answer(question: ReadingQuizQuestion, selected: number) {
    const key = JSON.stringify(["answer", question.id, selected]);
    run(question.id, async (client, signal) => {
      const result = await submitReadingQuizAnswer(client, materialId, locator, question, selected, requestId(key), signal);
      if (signal.aborted || client.isClosed) return;
      setGraded(old => ({ ...old, [question.id]: { selected, correct: result.correct } }));
      if (result.stars !== undefined) setStars(result.stars);
    });
  }

  function hint(question: ReadingQuizQuestion, excerpt: string) {
    setHintQuestion(undefined);
    const key = JSON.stringify(["guide", question.id, excerpt]);
    run(`guide:${question.id}`, async (client, signal) => {
      const result = await requestReadingQuizHelp(client, materialId, locator, question, excerpt, requestId(key), signal);
      if (signal.aborted || client.isClosed) return;
      setHints(old => ({ ...old, [question.id]: result }));
    });
  }

  if (!unitText.trim()) {
    return <Empty title="这一页暂时不能出题" detail="翻到有可读文字的页面再试。" icon="book-outline" />;
  }
  return (
    <View style={{ gap: 14 }}>
      <Section title={`第 ${locator} 页测验`} />
      <Button title={busy === "start" ? "正在出题…" : questions.length ? "重新出题" : "根据本页出题"}
        busy={busy === "start"} disabled={!!busy} icon="create-outline" onPress={generate} />
      {questions.map((question, index) => {
        const selected = choices[question.id];
        const result = graded[question.id];
        const help = hints[question.id];
        const canPick = !busy && question.canAnswer && !result?.correct;
        return <View key={question.id} style={[s.card, { gap: 10 }]}>
          <Text style={s.label}>第 {index + 1} 题</Text>
          <Prose text={question.prompt} />
          {question.choices.map((choice, choiceIndex) => (
            <Pressable key={choiceIndex} accessibilityRole="radio"
              accessibilityState={{ checked: selected === choiceIndex, disabled: !canPick }}
              disabled={!canPick} onPress={() => setChoices(old => ({ ...old, [question.id]: choiceIndex }))}
              style={[s.secondary, { borderRadius: 10, padding: 12, flexDirection: "row", gap: 10 },
                selected === choiceIndex && { backgroundColor: C.pale, borderColor: C.teal }]}>
              <Icon name={selected === choiceIndex ? "radio-button-on-outline" : "radio-button-off-outline"} color={C.teal} />
              <Text style={[s.text, { flex: 1 }]}>{choice}</Text>
            </Pressable>
          ))}
          {question.canAnswer ? <Button title="提交答案" compact
            busy={busy === question.id} disabled={!!busy || selected === undefined || result?.selected === selected || !!result?.correct}
            onPress={() => answer(question, selected)} /> :
            <Text style={s.muted}>这道题暂时不能提交。</Text>}
          {result ? <Text accessibilityLiveRegion="polite" style={{ color: result.correct ? C.teal : C.danger }}>
            {result.correct ? "答对了" : "这次没答对，可以再选一个答案。"}
          </Text> : null}
          {guidance && question.questionHelp && pieces.length > 0 && !result?.correct ? (
            <Button title={help ? "换一段原文找提示" : "看本题提示"} secondary compact icon="bulb-outline"
              busy={busy === `guide:${question.id}`} disabled={!!busy}
              onPress={() => setHintQuestion(question)} />
          ) : null}
          {help ? <View style={{ backgroundColor: C.pale, padding: 12, borderRadius: 12, gap: 5 }}>
            <Text style={s.label}>{help.title || "阅读提示"}</Text>
            <Prose text={help.message} />
            <Prose text={help.payload?.summary} />
            {Array.isArray(help.payload?.steps) ? help.payload.steps.map((step, n) => (
              <Prose key={n} text={typeof step === "string" ? step : step?.text || step?.body} />
            )) : null}
            <Text style={s.muted}>本题已记录 {help.count} 次提示</Text>
          </View> : null}
        </View>;
      })}
      {typeof stars === "number" ? <Text style={s.label}>本页测验获得 {stars} 颗星</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: C.danger }}>{error}</Text> : null}
      {hintQuestion ? <FormModal onClose={() => setHintQuestion(undefined)}>
        <Page>
          <Heading title="选择相关原文" right={<Button title="取消" secondary compact onPress={() => setHintQuestion(undefined)} />} />
          {pieces.map((excerpt, index) => <Button key={index} title={excerpt} secondary
            onPress={() => hint(hintQuestion, excerpt)} />)}
        </Page>
      </FormModal> : null}
    </View>
  );
}
