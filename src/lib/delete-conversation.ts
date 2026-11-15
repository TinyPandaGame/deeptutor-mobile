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
