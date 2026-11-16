import { ApiError, type Question, type TutorClient, type TurnEvent } from './client.ts';

type Data = Record<string, unknown>;
const object = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';
function questionFingerprint(data: Data) {
  const value = JSON.stringify([data.question || data.prompt, questionOptions(data.options)]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return `text-${hash.toString(16)}`;
}
export type StudyQuestion = { key: string; data: Data; messageId: string; turnId: string; mastery: boolean; interactionId: string };
export type StudyMessage = { id: string; role: string; events?: TurnEvent[] };

export function questionOptions(value: unknown): Record<string, string> {
  if (Array.isArray(value)) return Object.fromEntries(value.map((v, i) => {
    const item = object(v);
    return [text(item.label) || String.fromCharCode(65 + i), typeof v === 'string' ? v : text(item.body) || text(item.text)];
  }));
  return Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function studyQuestions(messages: StudyMessage[]): StudyQuestion[] {
  const found = new Map<string, StudyQuestion>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const [index, event] of (message.events || []).entries()) {
      if (!['result', 'tool_result', 'progress'].includes(event.type)) continue;
      const meta = object(event.metadata), tool = object(meta.tool_metadata);
      const mastery = tool.mastery_question || meta.mastery_question;
      const root = mastery || tool.result || meta.result || meta.data || meta.qa_pair || tool.qa_pair || (event.type === 'result' ? meta : undefined);
      const walk = (value: unknown, path: string, interactionId = '', depth = 0) => {
        if (depth > 8) return;
        if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}.${i}`, interactionId, depth + 1)); return; }
        const data = object(value);
        const id = text(data.question_id);
        if ((text(data.question) || text(data.prompt)) && !Array.isArray(data.questions)) {
          const key = mastery ? `mastery:${id || path}` : `quiz:${event.turn_id || message.id}:${id || questionFingerprint(data)}`;
          found.set(key, { key, data, messageId: String(message.id), turnId: event.turn_id || '', mastery: !!mastery, interactionId: interactionId || id });
        }
        for (const child of ['questions', 'qa_pairs', 'qa_pair', 'payload', 'results', 'data', 'items', 'sections', 'blocks']) {
          if (data[child]) walk(data[child], `${path}.${child}`, mastery && child === 'questions' ? id || interactionId : interactionId, depth + 1);
        }
      };
      walk(root, `${message.id}.${index}`);
    }
  }
  // Mastery assessments belong to the grading turn, not the earlier turn
  // that displayed the card. Use that identity when opening its saved row.
  for (const message of messages) for (const event of message.events || []) {
    const meta = object(event.metadata), grade = object(object(meta.tool_metadata).mastery_grade || meta.mastery_grade);
    const result = object(grade.result);
    const leaves = Array.isArray(result.results) ? result.results.map(object) : [Object.keys(result).length ? result : grade];
    if (grade.replayed === true || !event.turn_id) continue;
    for (const leaf of leaves) {
      const id = text(leaf.question_id) || text(grade.question_id);
      const q = found.get(`mastery:${id}`); if (q) q.turnId = event.turn_id;
    }
  }
  return [...found.values()];
}

export type Verdict = 'correct' | 'incorrect' | 'partial' | 'ungraded';
// Only parse the dedicated judge's declared first-line protocol. Never scan
// arbitrary chat prose for words such as "wrong" or guess from a blank answer.
export function judgeVerdict(feedback: string): Verdict {
  const first = feedback.trim().split(/\r?\n/)[0].replace(/^[#\s*]+|\*+$/g, '').trim();
  if (/^✅\s*(?:正确|Correct)(?=$|[\s，。:：.!—-])/i.test(first)) return 'correct';
  if (/^❌\s*(?:不正确|错误|Incorrect)(?=$|[\s，。:：.!—-])/i.test(first)) return 'incorrect';
  if (/^⚠️?\s*(?:部分正确|Partially correct)(?=$|[\s，。:：.!—-])/i.test(first)) return 'partial';
  return 'ungraded';
}

export function questionSubmission(q: StudyQuestion, answer: string, feedback = '', verdict: Verdict = 'ungraded') {
  const questionId = text(q.data.question_id);
  if (q.mastery) {
    if (!questionId || !q.interactionId) throw Error('题目缺少编号，请重新打开学习进度。');
    return { content: answer, context: { mastery_answer: q.interactionId === questionId
      ? { question_id: questionId, text: answer }
      : { question_id: q.interactionId, answers: { [questionId]: answer } } } };
  }
  return { content: `我的答案是：${answer}。请帮我检查思路并讲解。`, context: {
    capability: 'deep_question', config: {}, followup_question_context: {
      ...q.data, options: questionOptions(q.data.options), user_answer: answer,
      ...(verdict !== 'ungraded' ? { is_correct: verdict === 'correct' } : {}), ai_judgment: feedback,
    },
  } };
}

export async function saveJudgedMistake(api: Pick<TutorClient, 'json' | 'assertOpen'>, sessionId: string,
  q: StudyQuestion, answer: string, feedback: string, verdict: Verdict, assertActive = () => {}) {
  if (!['incorrect', 'partial'].includes(verdict)) return null;
  if (!sessionId || !answer.trim() || !text(q.data.question || q.data.prompt).trim()) throw Error('题目或作答不完整，尚未收录。');
  assertActive(); api.assertOpen();
  // Stable origin/turn/question key makes network retries update the same row.
  const questionId = text(q.data.question_id) || `mobile:${q.key}`;
  const saved = await api.json<Question>('/api/question-notebook/entries/upsert', {
    origin_type: 'conversation', origin_ref: sessionId, session_id: sessionId,
    turn_id: q.turnId, question_id: questionId, question: text(q.data.question || q.data.prompt),
    question_type: text(q.data.question_type), options: questionOptions(q.data.options),
    correct_answer: text(q.data.correct_answer), explanation: feedback || text(q.data.explanation),
    user_answer: answer, source: 'deep_question', is_correct: false, result: verdict,
  });
  assertActive(); api.assertOpen();
  if (!Number.isSafeInteger(saved?.id) || saved.question_id !== questionId || saved.origin_ref !== sessionId)
    throw Error('服务器尚未确认错题收录，请重试。');
  return saved;
}

export async function recordedMasteryMistakes(api: Pick<TutorClient, 'request' | 'assertOpen'>, sessionId: string, event: TurnEvent) {
  const meta = object(event.metadata), grade = object(object(meta.tool_metadata).mastery_grade || meta.mastery_grade);
  const result = object(grade.result);
  if (grade.replayed === true) return [];
  const leaves = Array.isArray(result.results) ? result.results.map(object) : [Object.keys(result).length ? result : grade];
  const ids = new Set(leaves.filter(v => {
    if (v.final === false || v.needs_clarification === true || v.result === 'ungraded' || v.result === 'correct') return false;
    return v.result === 'incorrect' || v.result === 'partial' || v.is_correct === false;
  }).map(v => text(v.question_id) || text(grade.question_id)).filter(Boolean));
  const saved: Question[] = [];
  for (const id of ids) {
    api.assertOpen();
    // Mastery already records on the server. Confirm its receipt instead of
    // creating a duplicate or resurrecting a question the learner deleted.
    try {
      const row = await api.request<Question>(`/api/question-notebook/entries/lookup/by-question?session_id=${encodeURIComponent(sessionId)}&question_id=${encodeURIComponent(id)}&turn_id=${encodeURIComponent(event.turn_id || "")}`);
      if (row?.question_id === id && row.is_correct === false && row.result !== 'ungraded') saved.push(row);
    } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
  }
  return saved;
}
