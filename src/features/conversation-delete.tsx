import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../lib/auth';
import { deleteConversationPermanently, retryConversationCleanup, verifyConversationsDeleted } from '../lib/delete-conversation';
import { clearConversationFiles } from '../lib/temporary-files';
import { clearConversationDrafts } from '../lib/drafts';
import { composerDrafts } from '../lib/native-composer-drafts';
import { conversationTitle } from '../lib/conversation';
import { Button } from '../ui';
import { notifyConversationDeletion } from '../lib/conversation-lifecycle';
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
    Alert.alert('删除对话？', `将删除“${conversationTitle(title)}”及它的单独追问，并停止正在生成的回答，同时清除本机对应草稿和缓存。已收进错题本的题目会保留。此操作不能撤销。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除对话', style: 'destructive', onPress: () => {
        if (api.isClosed || !scope.begin(opened)) return;
        setState({ scope, id });
        void (async () => {
          let confirmed = false;
          try {
            const result = await deleteConversationPermanently(api, id);
            const targets = result.ids;
            confirmed = true;
            notifyConversationDeletion(api, targets);
            // Clean independently of view lifetime once the server acknowledges.
            // Tombstones stop late draft/download callbacks recreating records.
            const cleanup = async () => {
              api.assertOpen();
              clearConversationDrafts(api, targets);
              const results = await Promise.allSettled([
                composerDrafts.removeConversations(api.scope, targets),
                Promise.resolve().then(() => clearConversationFiles(api, targets)),
                verifyConversationsDeleted(api, targets),
                result.cleanupComplete ? Promise.resolve() : retryConversationCleanup(api, targets).then(() => { result.cleanupComplete = true; }),
              ]);
              const failure = results.find(r => r.status === 'rejected');
              if (failure?.status === 'rejected') throw failure.reason;
            };
            const retryCleanup = () => {
              if (api.isClosed) return;
              void cleanup().then(() => {
                if (!api.isClosed) Alert.alert('清理完成', '聊天记录和本机缓存已清理，错题本中的题目保留。');
              }).catch(e => {
                if (!api.isClosed) Alert.alert('清理还未完成', e instanceof Error ? e.message : '请重试。', [
                  { text: '稍后', style: 'cancel' }, { text: '重试清理', onPress: retryCleanup },
                ]);
              });
            };
            let cleanupError: unknown;
            try { await cleanup(); } catch (e) { cleanupError = e; }
            if (!scope.active(opened) || api.isClosed) return;
            await onDeleted(id);
            if (cleanupError && !api.isClosed) Alert.alert('删除后的清理未完成',
              cleanupError instanceof Error ? cleanupError.message : '请重试清理。', [
                { text: '稍后', style: 'cancel' }, { text: '重试清理', onPress: retryCleanup },
              ]);
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
