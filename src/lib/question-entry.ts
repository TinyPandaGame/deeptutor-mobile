import type { Question, TutorClient } from "./client.ts";

export type NewQuestionEntry = {
  id: string;
  question: string;
  user_answer: string;
  correct_answer: string;
  explanation: string;
  session_id: string;
  turn_id: string;
  options: Record<string, string>;
};
export type QuestionImageCopy = {
  id: string;
  base64: string;
  filename: string;
  mime_type: string;
};

export function questionEntryPayload(
  value: NewQuestionEntry,
  images: QuestionImageCopy[] = [],
) {
  if (!value.id || !value.question.trim()) throw Error("请先校对并填写题目。");
  return {
    origin_type: value.session_id ? "conversation" : "external_import",
    origin_ref: value.session_id || value.id,
    session_id: value.session_id,
    question_id: value.id,
    turn_id: value.turn_id,
    options: value.options,
    question: value.question.trim(),
    user_answer: value.user_answer,
    correct_answer: value.correct_answer,
    explanation: value.explanation,
    ...(images.length ? { user_answer_images: images } : {}),
    source: "import",
    is_correct: false,
  };
}

export async function saveQuestionEntry(
  api: Pick<TutorClient, "json" | "assertOpen">,
  value: NewQuestionEntry,
  images: QuestionImageCopy[] = [],
) {
  api.assertOpen();
  const saved = await api.json<Question>(
    "/api/question-notebook/entries/upsert",
    questionEntryPayload(value, images),
  );
  api.assertOpen();
  if (
    !saved?.id ||
    saved.question_id !== value.id ||
    saved.question !== value.question.trim()
  )
    throw Error("服务器尚未确认保存，请保留本页并重试。");
  if (
    images.length &&
    (saved.user_answer_images?.length !== images.length ||
      saved.user_answer_images.some(
        (image) => !image.url?.startsWith("/") || image.url.startsWith("//"),
      ))
  )
    throw Error(
      "文字已保存，但图片未完整保存。请保留本页并重试，不要重复新建题目。",
    );
  return saved;
}
