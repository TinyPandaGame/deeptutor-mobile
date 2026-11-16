import { ApiError, type TutorClient } from './client.ts';

export async function deleteConversation(api: Pick<TutorClient, 'request' | 'assertOpen'>, id: string) {
  if (!id.trim() || id === 'new') throw Error('这段对话还没有保存。');
  api.assertOpen();
  try {
    const result = await api.request<{ deleted?: boolean; session_id?: string }>(
      `/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' },
    );
    api.assertOpen();
    if (result?.deleted !== true || result.session_id !== id) throw Error('服务器尚未确认删除，请刷新列表后核对。');
  } catch (error) {
    if (error instanceof ApiError && error.status === 409)
      throw Error('对话还在处理中，暂时没能停止。请稍后重试删除。');
    throw error;
  }
}


// Read the scoped hierarchy before deletion removes the parent links. The
// server owns recursive deletion; this snapshot identifies local drafts too.
export async function conversationDeletionTargets(api: Pick<TutorClient, 'request' | 'assertOpen'>, id: string) {
  const children = new Map<string, string[]>(), seen = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    api.assertOpen();
    const page = await api.request<{ sessions: { id: string; preferences?: Record<string, unknown> }[] }>(`/api/sessions?limit=100&offset=${offset}`);
    if (!Array.isArray(page?.sessions)) throw Error('无法核对单独追问，尚未删除对话。');
    let added = 0;
    for (const row of page.sessions) {
      if (typeof row.id !== 'string') throw Error('对话列表不完整，尚未删除。');
      if (seen.has(row.id)) continue;
      seen.add(row.id); added++;
      const parent = row.preferences?.parent_session_id;
      if (typeof parent === 'string') children.set(parent, [...(children.get(parent) || []), row.id]);
    }
    if (page.sessions.length < 100) break;
    if (!added) throw Error('无法完整读取对话列表，尚未删除。');
  }
  const targets = new Set([id]);
  for (const parent of targets) for (const child of children.get(parent) || []) targets.add(child);
  return [...targets];
}

export async function verifyConversationsDeleted(api: Pick<TutorClient, 'request' | 'assertOpen'>, ids: string[]) {
  for (const id of ids) {
    api.assertOpen();
    try { await api.request(`/api/sessions/${encodeURIComponent(id)}`); }
    catch (e) { if (e instanceof ApiError && e.status === 404) continue; throw e; }
    throw Error('服务端仍能读取这段对话，删除尚未完成。');
  }
}


export async function deleteConversationPermanently(api: Pick<TutorClient, 'request' | 'assertOpen'>, id: string) {
  api.assertOpen();
  let support: { permanent_delete?: number; preserves_notebook_images?: boolean };
  try { support = await api.request('/api/mobile/conversations/capabilities'); }
  catch (e) {
    if (e instanceof ApiError && [404, 405].includes(e.status))
      throw Error('服务器尚未支持保留错题照片的彻底删除。请先更新手机端服务扩展，当前没有删除任何记录。');
    throw e;
  }
  if (support.permanent_delete !== 1 || support.preserves_notebook_images !== true)
    throw Error('服务端删除能力不匹配，当前没有删除任何记录。');
  const targets = await conversationDeletionTargets(api, id);
  const result = await api.request<{ deleted?: boolean; session_id?: string; deleted_session_ids?: string[]; cleanup_complete?: boolean }>(
    `/api/mobile/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' },
  );
  api.assertOpen();
  if (result?.deleted !== true || result.session_id !== id || !Array.isArray(result.deleted_session_ids) ||
      !result.deleted_session_ids.includes(id) || result.deleted_session_ids.some(v => typeof v !== 'string'))
    throw Error('服务端尚未确认删除，请刷新后核对。');
  return { ids: [...new Set([...targets, ...result.deleted_session_ids])], cleanupComplete: result.cleanup_complete === true };
}

export async function retryConversationCleanup(api: Pick<TutorClient, 'json' | 'assertOpen'>, ids: string[]) {
  api.assertOpen();
  // Chunk large trees to the server's validated request limit.
  for (let start = 0; start < ids.length; start += 1000) {
    const batch = ids.slice(start, start + 1000);
    const result = await api.json<{ cleaned?: boolean; session_ids?: string[] }>('/api/mobile/conversations/cleanup', { session_ids: batch });
    if (result?.cleaned !== true || !Array.isArray(result.session_ids) || result.session_ids.length !== batch.length || batch.some((v, i) => result.session_ids![i] !== v))
      throw Error('服务端附件清理尚未确认，请重试清理。');
  }
}
