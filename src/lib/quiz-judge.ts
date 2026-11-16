import type { TutorClient } from './client.ts';
import { questionOptions, type StudyQuestion } from './chat-study.ts';

export type JudgeSocket = {
  onopen: null | (() => void); onmessage: null | ((e: { data: string }) => void);
  onerror: null | (() => void); onclose: null | (() => void);
  send: (body: string) => void; close: () => void;
};
export function judgeQuizAnswer(api: Pick<TutorClient, 'socketOptions' | 'assertOpen' | 'onClose'>,
  question: StudyQuestion, answer: string, createSocket: (url: string, headers: Record<string, string>) => JudgeSocket,
  signal: AbortSignal, timeoutMs = 90000): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false, response = '', socket: JudgeSocket | undefined;
    let unsubscribe: (() => void) | undefined;
    const finish = (error?: Error) => {
      if (finished) return; finished = true;
      clearTimeout(timer); unsubscribe?.(); signal.removeEventListener('abort', abort);
      if (socket) { socket.onclose = null; socket.close(); }
      if (error) reject(error); else resolve(response);
    };
    const abort = () => finish(Error('已取消判题，未收录错题。'));
    const timer = setTimeout(() => finish(Error('判题超时，答案仍保留，请重试。')), timeoutMs);
    try {
      api.assertOpen();
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      if (!answer.trim()) throw Error('请先填写答案。');
      const transport = api.socketOptions();
      socket = createSocket(`${transport.url}/questions/judge`, transport.headers);
      unsubscribe = api.onClose(abort);
      socket.onopen = () => {
        try {
          api.assertOpen();
          socket?.send(JSON.stringify({ question: question.data.question || question.data.prompt,
            question_type: question.data.question_type || '', options: questionOptions(question.data.options),
            correct_answer: question.data.correct_answer || '', explanation: question.data.explanation || '',
            user_answer: answer, language: 'zh' }));
        } catch (e) { finish(e as Error); }
      };
      socket.onmessage = e => {
        if (finished) return;
        try {
          api.assertOpen();
          const data = JSON.parse(e.data);
          if (data.type === 'text' && typeof data.content === 'string') {
            response += data.content;
            if (response.length > 100000) throw Error('判题结果过长，请重试。');
          } else if (data.type === 'error') finish(Error(typeof data.content === 'string' ? data.content : '判题未完成。'));
          else if (data.type === 'done') finish(response.trim() ? undefined : Error('没有取得判题结果，请重试。'));
        } catch (e) { finish(e as Error); }
      };
      socket.onerror = () => finish(Error('判题连接失败，答案仍保留，请重试。'));
      socket.onclose = () => finish(Error('判题中断，尚未确认结果，请重试。'));
    } catch (e) { finish(e as Error); }
  });
}
