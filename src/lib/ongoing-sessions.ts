import type { TutorClient } from "./client.ts";

const activeLabels = {
  queued: "排队中",
  running: "正在生成",
  waiting_input: "等你回答",
  recovering: "正在恢复",
};
const finishedLabels = {
  completed: "已完成",
  cancelled: "已停止",
  failed: "未完成",
};
const pageSize = 200;
const pageOverlap = 20;

type SessionSummary = {
  id: string;
  title: string;
  status?: string;
  active_turn_id?: string;
};

type TaskRow = { id: string; title: string; label: string };
export type TaskOverview = { active: TaskRow[]; recent: TaskRow[] };

export async function loadTaskOverview(
  api: Pick<TutorClient, "request">,
  signal: AbortSignal,
): Promise<TaskOverview> {
  const summaries = new Map<string, SessionSummary>();
  const getPage = async (offset: number) => {
    const result = await api.request<{ sessions: SessionSummary[] }>(
      `/api/sessions?limit=${pageSize}&offset=${offset}`,
      { signal },
    );
    if (!Array.isArray(result?.sessions)) throw Error("学习服务没有返回任务列表。");
    return result.sessions.filter(session => session.id);
  };
  let firstPage = await getPage(0);
  for (const session of firstPage) summaries.set(session.id, session);
  const needsHeadRefresh = firstPage.length === pageSize;
  // The upstream list is ordered by recent activity. Overlap pages across
  // ordinary shifts and recheck the head for work started during the scan.
  let page = firstPage;
  for (let offset = pageSize - pageOverlap; page.length === pageSize && !signal.aborted; offset += pageSize - pageOverlap) {
    page = await getPage(offset);
    const previousCount = summaries.size;
    for (const session of page) summaries.set(session.id, session);
    if (summaries.size === previousCount) break;
  }
  if (needsHeadRefresh && !signal.aborted) firstPage = await getPage(0);

  const active: TaskRow[] = [];
  const waiting: TaskRow[] = [];
  const recent: TaskRow[] = [];
  const seen = new Set<string>();
  for (const session of [...firstPage, ...summaries.values()]) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    const status = session.status || "";
    if (session.active_turn_id || Object.hasOwn(activeLabels, status)) {
      const label = Object.hasOwn(activeLabels, status)
        ? activeLabels[status as keyof typeof activeLabels]
        : activeLabels.running;
      const target = status === "waiting_input" ? waiting : active;
      target.push({ id: session.id, title: session.title, label });
    } else if (recent.length < 6 && Object.hasOwn(finishedLabels, status)) {
      recent.push({
        id: session.id,
        title: session.title,
        label: finishedLabels[status as keyof typeof finishedLabels],
      });
    }
  }
  return { active: [...waiting, ...active], recent };
}
