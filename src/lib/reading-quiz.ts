import type { TutorClient } from "./client.ts";

export type ReadingQuizQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  canAnswer: boolean;
  questionHelp: boolean;
};
export type ReadingQuizResult = { questions: ReadingQuizQuestion[] };
export type ReadingQuizVerdict = {
  question_id: string;
  is_correct: boolean;
};
export type ReadingQuizHelp = { title?: string; message?: string; payload?: Record<string, unknown>; count: number };
type QuizApi = Pick<TutorClient, "request">;
type ReadingExtension = { id?: string; actions?: { id?: string }[] };
const readingActionTimeout = 130000;

export function readingQuizSupport(extensions: ReadingExtension[] | null | undefined) {
  const provides = (id: string, action: string) => Array.isArray(extensions) && extensions.some(extension =>
    extension?.id === id && Array.isArray(extension.actions) && extension.actions.some(item => item?.id === action));
  return { quiz: provides("quiz", "start"), guidance: provides("guided_learning", "guide") };
}

function jsonBody(payload: object, signal: AbortSignal): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal };
}

function quizRoute(materialId: string) {
  return `/api/reading/materials/${encodeURIComponent(materialId)}/extensions`;
}

export async function startReadingQuiz(
  api: QuizApi, materialId: string, locator: number, signal: AbortSignal,
): Promise<ReadingQuizResult> {
  const result = await api.request<{ type: string; payload?: { questions?: unknown[] } }>(
    quizRoute(materialId) + "/quiz/actions/start",
    jsonBody({ locator, locale: "zh" }, signal), true, readingActionTimeout,
  );
  if (result?.type !== "quiz" || !Array.isArray(result.payload?.questions)) {
    throw Error("服务没有返回本页的测验题。");
  }
  const questions = result.payload.questions.flatMap(value => {
    const question = value as { id?: unknown; prompt?: unknown; choices?: unknown; can_answer?: unknown; correct_choice_index?: unknown } | null;
    if (!question?.id || typeof question.id !== "string" || typeof question.prompt !== "string" ||
        !Array.isArray(question.choices) || !question.choices.length ||
        question.choices.some(choice => typeof choice !== "string")) return [];
    const oldIndex = question.correct_choice_index;
    // Older releases expose the answer index. Use it only to determine
    // whether to offer submission, and never keep it in the displayed card.
    const legacyAnswerable = typeof oldIndex === "number" && Number.isInteger(oldIndex) &&
      oldIndex >= 0 && oldIndex < question.choices.length;
    return [{
      id: question.id,
      prompt: question.prompt,
      choices: question.choices as string[],
      canAnswer: typeof question.can_answer === "boolean" ? question.can_answer : legacyAnswerable,
      questionHelp: question.can_answer === true,
    }];
  });
  if (!questions.length || new Set(questions.map(question => question.id)).size !== questions.length) {
    throw Error("服务返回的测验题无法识别，请重新生成。");
  }
  return { questions };
}

export async function submitReadingQuizAnswer(
  api: QuizApi, materialId: string, locator: number, question: ReadingQuizQuestion,
  selectedIndex: number, submissionId: string, signal: AbortSignal,
): Promise<{ correct: boolean; stars?: number }> {
  if (!question.canAnswer || !Number.isInteger(selectedIndex) || selectedIndex < 0 ||
      selectedIndex >= question.choices.length) throw Error("请选择本题提供的答案。");
  const result = await api.request<{ answers?: ReadingQuizVerdict[]; reward?: { stars?: number } }>(
    quizRoute(materialId) + "/quiz/answers",
    jsonBody({ locator, submission_id: submissionId, answers: [{ question_id: question.id, selected_index: selectedIndex }] }, signal),
    true,
  );
  const verdict = result?.answers?.find(item => item.question_id === question.id);
  if (typeof verdict?.is_correct !== "boolean") throw Error("服务未返回这道题的判题结果。");
  return { correct: verdict.is_correct, stars: result.reward?.stars };
}

/** Show selectable excerpts that remain literal matches after server whitespace normalization. */
export function readingHintExcerpts(raw: string): string[] {
  const paragraphs = raw.trim().split(/\n\s*\n/);
  const excerpts: string[] = [];
  for (const paragraph of paragraphs) {
    const characters = Array.from(paragraph.replace(/\s+/g, " ").trim());
    for (let start = 0; start < characters.length && excerpts.length < 8; start += 280) {
      const excerpt = characters.slice(start, start + 280).join("").trim();
      if (excerpt) excerpts.push(excerpt);
    }
    if (excerpts.length >= 8) break;
  }
  return excerpts;
}

export async function requestReadingQuizHelp(
  api: QuizApi, materialId: string, locator: number, question: ReadingQuizQuestion,
  selection: string, requestId: string, signal: AbortSignal,
): Promise<ReadingQuizHelp> {
  if (!question.questionHelp || !selection.trim()) throw Error("请先选择这道题的原文片段。");
  const result = await api.request<{
    type: string; title?: string; message?: string; payload?: Record<string, unknown>;
    quiz_help?: { question_id: string; hints_used: number };
  }>(
    quizRoute(materialId) + "/guided_learning/actions/guide",
    jsonBody({ locator, locale: "zh", selection, question_id: question.id, help_request_id: requestId }, signal),
    true, readingActionTimeout,
  );
  const receipt = result?.quiz_help;
  if (receipt?.question_id !== question.id || !Number.isInteger(receipt.hints_used) || receipt.hints_used < 1) {
    throw Error("服务没有记录这道题的提示，可稍后重试。");
  }
  return { title: result.title, message: result.message, payload: result.payload, count: receipt.hints_used };
}
