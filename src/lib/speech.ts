import { ApiError, type TutorClient } from './client.ts';
import { serviceKey } from './connection.ts';

export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 2];
export const speechRate = (value: unknown) => SPEECH_RATES.includes(Number(value)) ? Number(value) : 1;
export const speechRateKey = (scope: string, conversation: string) => `dtm.speech.${serviceKey(scope)}.${serviceKey(conversation)}`;
export function speechPassage(text: string, selection?: { start: number; end: number }) {
  if (!selection) return text.trim();
  const { start, end } = selection;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start)
    throw Error('请先长按文字，选择想听的段落。');
  return text.slice(start, end).trim();
}
export function speechExtension(type: string) {
  const mime = type.split(';')[0].trim().toLowerCase();
  const suffix = ({ 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/aac': 'aac', 'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a', 'audio/flac': 'flac', 'audio/webm': 'webm' } as Record<string, string>)[mime];
  if (!suffix) throw Error('语音服务没有返回支持的音频，请检查服务端语音格式。');
  return suffix;
}

/** Late synthesis and cancelled requests can never start playback in a new account. */
export class SpeechRequest {
  private serial = 0;
  private controller?: AbortController;
  private api: Pick<TutorClient, 'downloadWithType' | 'assertOpen'>;
  constructor(api: Pick<TutorClient, 'downloadWithType' | 'assertOpen'>) { this.api = api; }
  cancel() { ++this.serial; this.controller?.abort(); this.controller = undefined; }
  async generate(text: string) {
    this.cancel();
    const run = this.serial;
    const passage = text.trim();
    if (!passage) throw Error('没有可以朗读的文字。');
    if (passage.length > 12000) throw Error('这段文字较长，请选择 12000 字以内的段落。');
    this.api.assertOpen();
    const controller = new AbortController(); this.controller = controller;
    try {
      const result = await this.api.downloadWithType('/api/voice/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage }), signal: controller.signal,
      }, 120000, 25 * 1024 * 1024);
      if (run !== this.serial) return null;
      this.api.assertOpen();
      if (!result.bytes.byteLength) throw Error('语音服务返回了空音频，请重试。');
      return { bytes: result.bytes, extension: speechExtension(result.contentType) };
    } catch (error) {
      if (run !== this.serial) return null;
      if (error instanceof ApiError) {
        if (error.status === 400) throw Error('服务器尚未正确配置语音朗读，请由管理员检查语音服务配置。');
        if (error.status === 404) throw Error('当前服务器缺少语音朗读接口，请由管理员检查阅读模块是否已安装并启用。');
        if (error.status === 504) throw Error('语音生成超时，请选择短一些的段落重试。');
      }
      throw error;
    } finally { if (run === this.serial) this.controller = undefined; }
  }
}
