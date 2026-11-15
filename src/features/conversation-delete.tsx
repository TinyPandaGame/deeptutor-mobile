import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../lib/auth';
import { deleteConversation } from '../lib/delete-conversation';
import { composerDrafts } from '../lib/native-composer-drafts';
import { conversationTitle } from '../lib/conversation';
import { Button } from '../ui';
import { ActionGate } from '../lib/action-gate';

export function useConversationDelete(onDeleted: (id: string) => void | Promise<void>) {
  const { api } = useAuth();
  const scope = useMemo(() => new ActionGate(api), [api]);
  const [state, setState] = useState({ scope, id: '' });
  const deleting = state.scope === scope ? state.id : '';
  useEffect(() => {
    scope.reset();
    return () => scope.reset();
  }, [scope]);
  function confirm(id: string, title: string) {
    if (!api || api.isClosed || scope.busy() || !id || id === 'new') return;
    const opened = scope.token();
    Alert.alert('删除对话？', `将删除“${conversationTitle(title)}”及它的单独追问，并停止正在生成的回答。请先保存需要的文字和图片。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除对话', style: 'destructive', onPress: () => {
        if (api.isClosed || !scope.begin(opened)) return;
        setState({ scope, id });
        void (async () => {
          let confirmed = false;
          try {
            await deleteConversation(api, id);
            confirmed = true;
            if (!scope.active(opened)) return;
            // Only remove this account/workspace's unsent draft after acknowledgement.
            let draftError = false;
            try { await composerDrafts.save(api.scope, id, { text: '', attachments: [] }); } catch { draftError = true; }
            if (!scope.active(opened) || api.isClosed) return;
            await onDeleted(id);
            if (draftError && !api.isClosed) Alert.alert('对话已删除', '本机草稿暂未清理完成，请重新打开应用后核对。');
          } catch (e) {
            if (scope.active(opened) && !api.isClosed)
              Alert.alert(confirmed ? '对话已删除' : '删除尚未确认', confirmed ? '请返回对话列表刷新。本机草稿如仍显示，请重新打开应用后核对。' : e instanceof Error ? e.message : '请刷新后核对，再重试。');
          } finally {
            if (scope.active(opened)) { scope.finish(opened); setState({ scope, id: '' }); }
          }
        })();
      } },
    ]);
  }
  return { deleting, confirm, isDeleting: () => scope.busy() };
}

export function DeleteConversationButton({ id, title, onDeleted }: { id: string; title: string; onDeleted: () => void | Promise<void> }) {
  const action = useConversationDelete(onDeleted);
  return <Button title="删除对话" icon="trash-outline" compact secondary danger busy={!!action.deleting}
    onPress={() => action.confirm(id, title)} />;
}
