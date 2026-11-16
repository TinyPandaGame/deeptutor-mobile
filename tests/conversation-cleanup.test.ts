import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationDeletionTargets, deleteConversationPermanently, verifyConversationsDeleted, retryConversationCleanup } from '../src/lib/delete-conversation.ts';
import { ComposerDraftStore } from '../src/lib/composer-drafts.ts';
import { ApiError } from '../src/lib/client.ts';

test('deletion discovers descendants across pages, deduplicates cycles and excludes unrelated chats', async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ id: `other${i}`, preferences: {} }));
  const second = [{ id: 'child', preferences: { parent_session_id: 'root' } }, { id: 'nested', preferences: { parent_session_id: 'child' } }, { id: 'root', preferences: { parent_session_id: 'nested' } }];
  const paths: string[] = [];
  const api = { assertOpen() {}, request: async <T>(path: string) => { paths.push(path); return { sessions: paths.length === 1 ? first : second } as T; } };
  assert.deepEqual(await conversationDeletionTargets(api, 'root'), ['root', 'child', 'nested']);
  assert.deepEqual(paths, ['/api/sessions?limit=100&offset=0', '/api/sessions?limit=100&offset=100']);
});

test('strict deletion refuses unsupported servers before any write and accepts only matching receipts', async () => {
  let writes = 0;
  for (const result of [null, {}, { permanent_delete: 1, preserves_notebook_images: false }]) {
    const api = { assertOpen() {}, request: async <T>(_p: string, init?: RequestInit): Promise<T> => {
      if (init?.method) writes++;
      if (result === null) throw new ApiError('missing', 404);
      return result as T;
    } };
    await assert.rejects(deleteConversationPermanently(api, 'root'));
  }
  assert.equal(writes, 0);
  const calls: string[] = [];
  const api = { assertOpen() {}, request: async <T>(path: string, init?: RequestInit) => {
    calls.push(path);
    if (path.endsWith('/capabilities')) return { permanent_delete: 1, preserves_notebook_images: true } as T;
    if (path.includes('?limit')) return { sessions: [{ id: 'child', preferences: { parent_session_id: 'root' } }] } as T;
    assert.equal(init?.method, 'DELETE'); writes++;
    return { deleted: true, session_id: 'root', deleted_session_ids: ['root', 'child', 'late-child'], cleanup_complete: false } as T;
  } };
  assert.deepEqual(await deleteConversationPermanently(api, 'root'), { ids: ['root', 'child', 'late-child'], cleanupComplete: false });
  assert.equal(writes, 1);
});

test('post-delete verification distinguishes missing real records from network/permission errors', async () => {
  await verifyConversationsDeleted({ assertOpen() {}, request: async () => { throw new ApiError('gone', 404); } }, ['root', 'child']);
  for (const code of [401, 500]) await assert.rejects(verifyConversationsDeleted({ assertOpen() {}, request: async () => { throw new ApiError('failed', code); } }, ['root']));
  await assert.rejects(verifyConversationsDeleted({ assertOpen() {}, request: async <T>() => ({ id: 'root' }) as T }, ['root']), /仍能读取/);
  await assert.rejects(retryConversationCleanup({ assertOpen() {}, json: async <T>() => ({ cleaned: true, session_ids: ['wrong'] }) as T }, ['root']), /尚未确认/);
});

test('deleted drafts and queued late writes cannot resurrect chat photos; other accounts and notes survive', async () => {
  let content: string | null = null;
  const store = new ComposerDraftStore({ read: async () => content, write: async next => { content = next; } });
  const draft = { text: 'unsubmitted', attachments: [{ filename: 'fixture', base64: 'AQID', mime_type: 'image/png' }] };
  for (const route of ['root', 'child', 'keep']) await store.save('alice:math', route, draft);
  await store.save('alice:math', 'new', { ...draft, context: { selection_tutor_context: { parent_session_id: 'child' } } });
  await store.save('bob:math', 'root', draft); await store.save('alice:chinese', 'root', draft);
  const staleWrite = store.save('alice:math', 'child', draft);
  const cleanup = store.removeConversations('alice:math', ['root', 'child']);
  await staleWrite; await cleanup;
  await store.save('alice:math', 'root', draft);
  for (const route of ['root', 'child', 'new']) assert.equal(await store.read('alice:math', route), undefined);
  for (const [scope, route] of [['alice:math', 'keep'], ['bob:math', 'root'], ['alice:chinese', 'root']]) assert.equal((await store.read(scope, route))?.text, 'unsubmitted');
});


test('deletion notifications invalidate every mounted copy for the current identity only', async () => {
  const { subscribeConversationDeletion, notifyConversationDeletion } = await import('../src/lib/conversation-lifecycle.ts');
  const { TutorClient } = await import('../src/lib/client.ts');
  const { connection } = await import('../src/lib/connection.ts');
  const api = new TutorClient(connection('https://fixture.example.com', 'server'));
  const other = new TutorClient(connection('https://fixture.example.com', 'server'));
  const events: string[][] = [];
  const stop = subscribeConversationDeletion(api, ids => events.push(ids));
  subscribeConversationDeletion(other, () => { throw Error('wrong identity'); });
  notifyConversationDeletion(api, ['chat', 'child']); assert.deepEqual(events, [['chat', 'child']]);
  stop(); notifyConversationDeletion(api, ['later']); assert.equal(events.length, 1);
});
