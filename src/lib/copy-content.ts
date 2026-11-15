import { readingBlocks } from './reading-content.ts';
import { mathParts } from './math-markup.ts';

function formulaText(formula: string) {
  let value = formula.trim();
  // Keep grouping explicit. Unsupported notation stays intact rather than
  // silently losing the mathematical meaning during a clipboard operation.
  for (let i = 0; i < 12; i++) {
    const next = value.replace(/\\(?:dfrac|tfrac|frac)\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
    if (next === value) break;
    value = next;
  }
  return value.replace(/\\(times|cdot|div|pm|leq?|geq?|neq?|approx|pi|infty)(?![a-zA-Z])/g, (_, name: string) =>
    ({ times: '×', cdot: '·', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', pi: 'π', infty: '∞' })[name]!)
    .replace(/\\(?:text|mathrm)\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:left|right)(?![a-zA-Z])/g, '')
    .replace(/\^(?:\{([23])\}|([23])(?!\d))/g, (_, braced: string, plain: string) => (braced || plain) === '2' ? '²' : '³');
}

export function clipboardText(source: string) {
  return readingBlocks(source).map(block => block.kind === 'code' ? block.text :
    mathParts(block.text).map(part => part.formula === undefined ? part.text : formulaText(part.formula)).join(''))
    .join('\n\n').trim();
}

export const MAX_COPY_IMAGE_BYTES = 12 * 1024 * 1024;
export function imageDataUri(uri: string): { base64: string; mime: string } | null {
  if (!uri.startsWith('data:')) return null;
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(uri);
  if (!match || !match[2] || match[2].length % 4 === 1) throw Error('图片格式暂不支持复制，请使用分享图片。');
  return { base64: match[2], mime: match[1].toLowerCase().replace('image/jpg', 'image/jpeg') };
}
export function checkImageSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) throw Error('图片暂时无法读取，请重新打开后再试。');
  if (size > MAX_COPY_IMAGE_BYTES) throw Error('这张图片较大，请使用分享图片。');
}
export function assertLocalImage(uri: string) {
  if (!/^(?:file|content):\/\//.test(uri)) throw Error('请等待图片加载完成后再复制。');
}
export async function copyImageData(uri: string, port: {
  read: (uri: string) => Promise<string>;
  write: (base64: string) => Promise<void>;
  assertActive: () => void;
}) {
  port.assertActive();
  const data = imageDataUri(uri);
  if (!data) assertLocalImage(uri);
  const base64 = data?.base64 ?? await port.read(uri);
  checkImageSize(Math.ceil(base64.length * 3 / 4));
  port.assertActive();
  await port.write(base64);
}
