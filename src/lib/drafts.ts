import type { TutorClient, ChatAttachment } from "./client";
export type Photo = { uri: string; base64: string; filename: string };
export type QuestionDraft = {
  question: string;
  explanation: string;
  correct_answer?: string;
  user_answer?: string;
  session_id?: string;
  turn_id?: string;
  question_id?: string;
  options?: Record<string, string>;
  images?: ChatAttachment[];
};
const photos = new WeakMap<TutorClient, Photo>();
const questions = new WeakMap<TutorClient, QuestionDraft>();
type ChatDraft = { content: string; context: Record<string, unknown> };
const chats = new WeakMap<TutorClient, ChatDraft>();
export const chatDraft = {
  set: (api: TutorClient, value: ChatDraft) => { api.assertOpen(); chats.set(api, value); api.onClose(() => chats.delete(api)); },
  take: (api: TutorClient) => { api.assertOpen(); const value = chats.get(api); chats.delete(api); return value; },
};
export const photoDraft = {
  peek: (api: TutorClient) => photos.get(api),
  set: (api: TutorClient, value: Photo) => { api.assertOpen(); photos.set(api, value); api.onClose(() => photos.delete(api)); },
  take: (api: TutorClient) => {
    const value = photos.get(api);
    photos.delete(api);
    return value;
  },
};
export const questionDraft = {
  set: (api: TutorClient, value: QuestionDraft) => { api.assertOpen(); questions.set(api, value); api.onClose(() => questions.delete(api)); },
  take: (api: TutorClient) => {
    const value = questions.get(api);
    questions.delete(api);
    return value;
  },
};

export function clearConversationDrafts(api: TutorClient, ids: string[]) {
  const deleted = new Set(ids);
  if (deleted.has(questions.get(api)?.session_id || '')) questions.delete(api);
  const source = chats.get(api)?.context.selection_tutor_context as { parent_session_id?: string } | undefined;
  if (deleted.has(source?.parent_session_id || '')) chats.delete(api);
}
