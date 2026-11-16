import { useConversationCache } from "../lib/conversation-cache-context";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { temporaryBytes } from "../lib/temporary-files";
import * as Sharing from "expo-sharing";
import { useAuth } from "../lib/auth";
import type { TutorClient } from "../lib/client";
import { Button } from "../ui";

export function ExportFile({
  path,
  filename,
  mime,
  body,
  load,
  title = "导出与分享",
}: {
  path?: string;
  filename: string;
  mime: string;
  body?: unknown;
  load?: (api: TutorClient, signal: AbortSignal) => Promise<ArrayBuffer>;
  title?: string;
}) {
  const { api } = useAuth();
  const conversation = useConversationCache();
  const [busy, setBusy] = useState(false);
  const transfer = useRef<AbortController | null>(null);
  useEffect(() => () => transfer.current?.abort(), [api]);
  async function run() {
    if (!api || busy) return;
    const controller = new AbortController();
    transfer.current = controller;
    setBusy(true);
    try {
      await api.ensureSession();
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("当前设备暂不支持文件分享。");
      if (!load && !path) throw new Error("没有可导出的内容。");
      const bytes = load
        ? await load(api, controller.signal)
        : await api.download(
            path!,
            body === undefined
              ? { signal: controller.signal }
              : {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                  signal: controller.signal,
                },
            120000,
          );
      // Recheck identity after downloading before exposing the native share UI.
      await api.ensureSession();
      if (controller.signal.aborted) return;
      const name = filename
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
        .slice(0, 100);
      const uri = temporaryBytes(api, bytes, name, conversation);
      await Sharing.shareAsync(uri, {
        mimeType: mime,
        dialogTitle: "保存或分享学习资料",
      });
      // Android receivers may consume the URI after the chooser returns. Keep
      // the private cache until this client is retired or the app next starts.
    } catch (e) {
      if (!controller.signal.aborted)
        Alert.alert("未能导出", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button title={title} secondary busy={busy} onPress={() => void run()} />
  );
}
