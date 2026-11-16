import test from 'node:test';
import assert from 'node:assert/strict';
import { studyQuestions, questionOptions, questionSubmission, judgeVerdict, saveJudgedMistake, recordedMasteryMistakes, type StudyQuestion } from '../src/lib/chat-study.ts';
import { judgeQuizAnswer, type JudgeSocket } from '../src/lib/quiz-judge.ts';
import { TutorClient, ApiError, type TurnEvent } from '../src/lib/client.ts';
import { connection } from '../src/lib/connection.ts';
const q: StudyQuestion = { key: 'quiz:turn:one', turnId: 'turn', messageId: '2', mastery: false, interactionId: '', data: { question_id: 'one', question: '3 + 4 = ?', options: ['7', '8'], correct_answer: 'A' } };

test('question extraction supports ordinary quizzes, repeated mastery cards and grouped question identities', () => {
  const card = { type: 'tool_result', metadata: { tool_metadata: { mastery_question: { question_id: 'group', questions: [{ question_id: 'a', prompt: 'first' }, { question_id: 'b', question: 'second' }] } } } };
  const found = studyQuestions([{ id: '1', role: 'user', events: [card] }, { id: '2', role: 'assistant', events: [card, card, { type: 'result', turn_id: 'turn', metadata: { qa_pairs: [q.data] } }] }]);
  assert.equal(found.length, 3);
  assert.deepEqual(found.slice(0, 2).map(v => [v.data.question_id, v.interactionId]), [['a', 'group'], ['b', 'group']]);
  assert.deepEqual(questionSubmission(found[0], 'answer').context, { mastery_answer: { question_id: 'group', answers: { a: 'answer' } } });
  assert.equal(found[2].mastery, false);
  assert.deepEqual(questionOptions(['one', { label: 'C', body: 'three' }]), { A: 'one', C: 'three' });
});

test('automatic collection uses an explicit judge verdict, never words in ordinary prose', () => {
  for (const [text, verdict] of [['✅ 正确。很好', 'correct'], ['**❌ 不正确**', 'incorrect'], ['⚠️ 部分正确：还差一步', 'partial'], ['❌ Incorrect: try again', 'incorrect'], ['这不是一道错题', 'ungraded'], ['✅ 正确性待确认', 'ungraded'], ['请看下面\n❌ 不正确', 'ungraded']]) assert.equal(judgeVerdict(text), verdict);
});

test('wrong/partial answers upsert a stable identity with scope; correct/ungraded answers do not write', async () => {
  const writes: Record<string, unknown>[] = [];
  const api = { assertOpen() {}, json: async <T>(path: string, body: unknown) => {
    assert.equal(path, '/api/question-notebook/entries/upsert'); const data = body as Record<string, unknown>; writes.push(data);
    return { ...data, id: 3 } as T;
  } };
  for (const verdict of ['correct', 'ungraded'] as const) assert.equal(await saveJudgedMistake(api, 'chat', q, 'B', 'feedback', verdict), null);
  for (let i = 0; i < 2; i++) await saveJudgedMistake(api, 'chat', q, 'B', '❌ 不正确', 'incorrect');
  assert.deepEqual(writes[0], writes[1]); assert.equal(writes[0].origin_ref, 'chat'); assert.equal(writes[0].turn_id, 'turn'); assert.equal(writes[0].question_id, 'one'); assert.equal(writes[0].is_correct, false);
  await assert.rejects(saveJudgedMistake(api, 'chat', q, 'B', 'x', 'partial', () => { throw Error('deleted'); }), /deleted/);
  assert.equal(writes.length, 2);
  await assert.rejects(saveJudgedMistake({ assertOpen() {}, json: async <T>() => ({ id: 3, question_id: 'other' }) as T }, 'chat', q, 'B', 'x', 'incorrect'), /尚未确认/);
});

test('mastery confirms server-owned records without a second insertion or replay', async () => {
  const reads: string[] = [];
  const api = { assertOpen() {}, request: async <T>(path: string) => { reads.push(path); return { id: 4, question_id: 'wrong', is_correct: false, result: 'incorrect' } as T; } };
  const event: TurnEvent = { type: 'tool_result', metadata: { tool_metadata: { mastery_grade: { result: { results: [
    { question_id: 'wrong', result: 'incorrect', final: true }, { question_id: 'wrong', is_correct: false },
    { question_id: 'right', is_correct: true, result: 'correct' }, { question_id: 'clarify', is_correct: false, needs_clarification: true }, { question_id: 'pending', is_correct: false, result: 'ungraded' },
  ] } } } } };
  assert.equal((await recordedMasteryMistakes(api, 'chat', event)).length, 1); assert.equal(reads.length, 1);
  assert.ok(reads[0].includes('session_id=chat&question_id=wrong'));
  event.metadata = { mastery_grade: { replayed: true, question_id: 'wrong', is_correct: false } };
  assert.deepEqual(await recordedMasteryMistakes(api, 'chat', event), []); assert.equal(reads.length, 1);
  const missing = { ...api, request: async <T>(): Promise<T> => { throw new ApiError('missing', 404); } };
  assert.deepEqual(await recordedMasteryMistakes(missing, 'chat', { type: 'result', metadata: { mastery_grade: { question_id: 'wrong', result: { is_correct: false, final: true } } } }), []);
});

function judge(timeout = 1000) {
  const api = new TutorClient(connection('https://fixture.example.com', 'server'));
  api.user = { user_id: 'fixture', username: 'fixture', role: 'user' }; api.token = 'fixture-token'; api.workspaceId = 'math';
  const control = new AbortController(), sent: string[] = [], info: { url?: string; headers?: Record<string, string> } = {};
  let closes = 0;
  const socket: JudgeSocket = { onopen: null, onmessage: null, onclose: null, onerror: null, send: body => sent.push(body), close: () => { closes++; } };
  const result = judgeQuizAnswer(api, q, 'B', (url, headers) => { Object.assign(info, { url, headers }); return socket; }, control.signal, timeout);
  const emit = (data: unknown) => socket.onmessage?.({ data: JSON.stringify(data) });
  return { api, control, socket, sent, info, result, emit, closes: () => closes };
}

test('judge socket sends authenticated workspace context and waits for completed output', async () => {
  const run = judge(); run.socket.onopen?.();
  assert.equal(run.info.url, 'wss://fixture.example.com/ws/questions/judge');
  assert.ok(run.info.headers?.Cookie.includes('fixture-token')); assert.equal(run.info.headers?.['X-DeepTutor-Workspace'], 'math');
  assert.deepEqual(JSON.parse(run.sent[0]).options, { A: '7', B: '8' });
  assert.equal(JSON.parse(run.sent[0]).language, 'zh');
  run.emit({ type: 'started' }); run.emit({ type: 'text', content: '❌ 不正确\n' }); run.emit({ type: 'text', content: '3 + 4 = 7' }); run.emit({ type: 'done' });
  assert.equal(await run.result, '❌ 不正确\n3 + 4 = 7'); assert.equal(run.closes(), 1);
  run.emit({ type: 'text', content: 'late data' }); assert.equal(run.closes(), 1);
});

test('cancel, retired account, interrupted stream, empty completion and timeout cannot become a grade', async () => {
  for (const stop of [
    (r: ReturnType<typeof judge>) => r.control.abort(),
    (r: ReturnType<typeof judge>) => r.api.close(),
    (r: ReturnType<typeof judge>) => r.socket.onclose?.(),
    (r: ReturnType<typeof judge>) => r.socket.onerror?.(),
    (r: ReturnType<typeof judge>) => r.emit({ type: 'error', content: 'fixture error' }),
    (r: ReturnType<typeof judge>) => r.emit({ type: 'done' }),
    (r: ReturnType<typeof judge>) => r.socket.onmessage?.({ data: '?' }),
    (r: ReturnType<typeof judge>) => r.emit({ type: 'text', content: 'x'.repeat(100001) }),
  ]) { const run = judge(); stop(run); await assert.rejects(run.result); assert.equal(run.closes(), 1); }
  const run = judge(5); await assert.rejects(run.result, /超时/);
});
