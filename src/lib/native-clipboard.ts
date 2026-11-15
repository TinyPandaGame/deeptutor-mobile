import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { Image } from 'react-native';
import { checkImageSize, copyImageData } from './copy-content';

export async function copyText(text: string) {
  if (!text.trim()) throw Error('没有可以复制的文字。');
  if (!await Clipboard.setStringAsync(text)) throw Error('复制没有成功，请重试。');
}

export async function copyImage(uri: string, assertActive: () => void) {
  await copyImageData(uri, {
    assertActive,
    read: async path => {
      const file = new File(path);
      checkImageSize(file.size ?? 0);
      return file.base64();
    },
    write: async base64 => {
      const size = await Image.getSize(uri);
      if (size.width * size.height > 24_000_000) throw Error('这张图片分辨率较高，请使用分享图片。');
      assertActive();
      await Clipboard.setImageAsync(base64);
    },
  });
}
