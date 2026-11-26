import { ApiError, type TutorClient } from "./client.ts";

export const PRACTICE_SOURCE_LIMIT = 16;
export const PRACTICE_SOURCE_PAGE_SIZE = 12;

export type PracticeSource = { id: number; question: string };
type RawPracticeSource = PracticeSource & { available?: boolean; unreadable?: boolean };
type PracticePage = {
  items: RawPracticeSource[];
  total?: number;
  has_more?: boolean;
};
type PracticeClient = Pick<TutorClient, "request">;

export function practiceSearch(value: string) {
  return value.trim().slice(0, 200);
}

export async function loadPracticeSources(
  api: PracticeClient,
  search: string,
  page: number,
  signal: AbortSignal,
  useLegacy = false,
) {
  const offset = page * PRACTICE_SOURCE_PAGE_SIZE;
  const params = new URLSearchParams({
    search: practiceSearch(search),
    offset: String(offset),
    limit: String(PRACTICE_SOURCE_PAGE_SIZE),
  });
  let response: PracticePage | undefined;
  if (!useLegacy) {
    try {
      response = await api.request<PracticePage>(`/api/dashboard/source-library/practice?${params}`, { signal });
      // v1.7.2 returns an unsliced index and ignores the search parameters.
      if (response?.total === undefined && Array.isArray(response?.items)) useLegacy = true;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      useLegacy = true;
    }
  }
  if (useLegacy) {
    if (signal.aborted) throw new Error("已取消题库读取。");
    response = await api.request<PracticePage>(`/api/question-notebook/entries?${params}`, { signal });
  }
  const total = response?.total;
  if (!response || !Array.isArray(response.items) || typeof total !== "number" ||
      !Number.isSafeInteger(total) || total < 0) {
    throw new Error("题库列表格式不兼容。");
  }
  return {
    items: response.items.filter(item => item && Number.isSafeInteger(item.id) &&
      typeof item.question === "string" && item.question.trim() &&
      item.available !== false && !item.unreadable),
    total,
    hasMore: typeof response.has_more === "boolean" ? response.has_more : offset + response.items.length < total,
    useLegacy,
  };
}

export function practiceTopicSources(items: PracticeSource[]) {
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  if (unique.length > PRACTICE_SOURCE_LIMIT) throw new Error(`最多可以选择 ${PRACTICE_SOURCE_LIMIT} 道题。`);
  return unique.map(item => ({
    kind: "question_bank" as const,
    source_id: String(item.id),
    label: Array.from(item.question.trim().replace(/\s+/g, " ")).slice(0, 200).join(""),
    excerpt: Array.from(item.question.trim()).slice(0, 4000).join(""),
  }));
}
