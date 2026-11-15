import assert from 'node:assert/strict';
import test from 'node:test';
import { clipboardText, copyImageData, imageDataUri, MAX_COPY_IMAGE_BYTES, checkImageSize } from '../src/lib/copy-content.ts';
import { deleteConversation } from '../src/lib/delete-conversation.ts';
import { TutorClient } from '../src/lib/client.ts';
import { connection } from '../src/lib/connection.ts';
import { ComposerDraftStore } from '../src/lib/composer-drafts.ts';
import { ActionGate } from '../src/lib/action-gate.ts';

test('copy/delete action gate rejects repeat taps and confirmations from a closed view', () => {
  const gate = new ActionGate('account');
  const opened = gate.token();
  assert.equal(gate.begin(opened), true); assert.equal(gate.begin(opened), false);
  gate.reset(); assert.equal(gate.active(opened), false); assert.equal(gate.begin(opened), false);
  const fresh = gate.token(); assert.equal(gate.begin(fresh), true);
  gate.finish(opened); assert.equal(gate.busy(), true);
  gate.finish(fresh); assert.equal(gate.busy(), false);
});

test('copying text removes presentation markup, preserves Chinese paragraphs, literal symbols and code', () => {
  const result = clipboardText('## 一起学习\n\n**第一步**：算一算。\n- 苹果有 3 个。\n\n价格 $5，标签 #学习，比例 50%。\n```txt\n# code $x$\n  保留缩进\n```');
  assert.equal(result, '一起学习\n\n第一步：算一算。\n\n• 苹果有 3 个。\n\n价格 $5，标签 #学习，比例 50%。\n\n# code $x$\n  保留缩进');
  assert.equal(clipboardText('| 项目 | 数量 |\n| --- | --- |\n| 苹果 | 3 |'), '项目：苹果\n数量：3');
  assert.equal(clipboardText(''), '');
});
test('copying elementary formulas preserves grouping, fractions and unsupported notation', () => {
  assert.equal(clipboardText(String.raw`计算：$3\times 4=12$，$x^{2}$ 和 $\frac{1+2}{3+4}$。`), '计算：3× 4=12，x² 和 (1+2)/(3+4)。');
  assert.equal(clipboardText(String.raw`$\frac{\frac{1}{2}}{3}$`), '((1)/(2))/(3)');
  assert.equal(clipboardText(String.raw`$\sqrt{9}=3$，$x^{23}$，$\unknown{x}$`), String.raw`√(9)=3，x^{23}，\unknown{x}`);
  assert.equal(clipboardText(String.raw`$x^{2x}+x^{3+1}$`), String.raw`x^{2x}+x^{3+1}`);
});
test('image copying writes image bytes, not a file path or server URL', async () => {
  // Synthetic bytes exercise transport only; they are not rendered or decoded.
  const writes: string[] = [];
  let reads = 0;
  const port = { assertActive() {}, read: async (uri: string) => { reads++; assert.equal(uri, 'file:///private/fixture.png'); return 'AQIDBA=='; }, write: async (value: string) => { writes.push(value); } };
  await copyImageData('data:image/png;base64,AQIDBA==', port);
  assert.equal(reads, 0);
  await copyImageData('file:///private/fixture.png', port);
  assert.equal(reads, 1); assert.deepEqual(writes, ['AQIDBA==', 'AQIDBA==']);
  await assert.rejects(copyImageData('https://learning.example.com/private.png', port), /加载完成/);
  assert.equal(writes.length, 2); assert.equal(reads, 1);
});
test('image copy rejects malformed, empty or oversized data and propagates clipboard failures', async () => {
  for (const uri of ['data:image/png;base64,', 'data:image/png;base64,?', 'data:text/plain;base64,AQID', 'data:image/png;base64,A']) assert.throws(() => imageDataUri(uri));
  assert.throws(() => checkImageSize(MAX_COPY_IMAGE_BYTES + 1), /较大/);
  assert.throws(() => checkImageSize(0)); assert.throws(() => checkImageSize(NaN));
  await assert.rejects(copyImageData('data:image/png;base64,AQID', { assertActive() {}, read: async () => '', write: async () => { throw Error('clipboard unavailable'); } }), /clipboard unavailable/);
});
test('account or view change during an image read prevents clipboard publication', async () => {
  let active = true, written = false;
  await assert.rejects(copyImageData('file:///private/fixture.png', {
    assertActive() { if (!active) throw Error('retired account'); },
    read: async () => { active = false; return 'AQIDBA=='; },
    write: async () => { written = true; },
  }), /retired account/);
  assert.equal(written, false);
});

function client(fetcher: typeof fetch) {
  const api = new TutorClient(connection('https://learning.example.com', 'server'), null, fetcher);
  api.user = { user_id: 'fixture-user', username: 'fixture-user', role: 'user' };
  api.token = 'fixture-token'; api.workspaceId = 'fixture-workspace';
  return api;
}
const status = () => Response.json({ enabled: true, authenticated: true, user_id: 'fixture-user' });
test('conversation deletion sends one authenticated DELETE with current workspace and waits for matching acknowledgement', async () => {
  let writes = 0;
  const id = '学习 对话';
  const api = client(async (url, init) => {
    if (String(url).endsWith('/api/auth/status')) return status();
    writes++;
    assert.equal(String(url), `https://learning.example.com/api/sessions/${encodeURIComponent(id)}`);
    assert.equal(init?.method, 'DELETE');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token');
    assert.equal(new Headers(init?.headers).get('X-DeepTutor-Workspace'), 'fixture-workspace');
    return Response.json({ deleted: true, session_id: id });
  });
  await deleteConversation(api, id); assert.equal(writes, 1);
  for (const invalid of ['', ' ', 'new']) await assert.rejects(deleteConversation(api, invalid));
  api.close(); await assert.rejects(deleteConversation(api, id)); assert.equal(writes, 1);
});
test('wrong or missing acknowledgement never confirms a conversation deletion', async () => {
  for (const result of [{}, { deleted: false, session_id: 'chat' }, { deleted: true, session_id: 'different' }]) {
    const api = client(async url => String(url).endsWith('/api/auth/status') ? status() : Response.json(result));
    await assert.rejects(deleteConversation(api, 'chat'), /尚未确认/);
  }
});
test('busy, missing, forbidden and network-failed deletes stay failed and are never retried silently', async () => {
  for (const code of [409, 404, 403, 500, 0]) {
    let writes = 0;
    const api = client(async url => {
      if (String(url).endsWith('/api/auth/status')) return status();
      writes++; if (!code) throw Error('network unavailable');
      return Response.json({ detail: 'fixture failure' }, { status: code });
    });
    if (code === 409) await assert.rejects(deleteConversation(api, 'chat'), /处理中/);
    else await assert.rejects(deleteConversation(api, 'chat'));
    assert.equal(writes, 1);
  }
});
test('acknowledged draft removal preserves another conversation, account and workspace', async () => {
  let saved: string | null = null;
  const drafts = new ComposerDraftStore({ read: async () => saved, write: async value => { saved = value; } });
  const scopes = ['service:a:user:one:workspace:math', 'service:a:user:two:workspace:math', 'service:a:user:one:workspace:chinese'];
  for (const scope of scopes) await drafts.save(scope, 'chat', { text: scope, attachments: [] });
  await drafts.save(scopes[0], 'keep', { text: 'retained', attachments: [] });
  await drafts.save(scopes[0], 'chat', { text: '', attachments: [] });
  assert.equal(await drafts.read(scopes[0], 'chat'), undefined);
  assert.equal((await drafts.read(scopes[0], 'keep'))?.text, 'retained');
  for (const scope of scopes.slice(1)) assert.equal((await drafts.read(scope, 'chat'))?.text, scope);
});
