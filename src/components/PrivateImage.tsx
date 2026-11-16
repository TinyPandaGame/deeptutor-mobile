import { useConversationCache } from "../lib/conversation-cache-context";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { temporaryBytes } from "../lib/temporary-files";
import { Button, s } from "../ui";
import { QuestionImage } from "./QuestionImage";
export function PrivateImage({ path }: { path: string }) {
  const { api } = useAuth();
  const conversation = useConversationCache();
  const [attempt, setAttempt] = useState(0);
  const key = `${api?.scope}:${path}`;
  const [stored, setStored] = useState<{ key: string; uri: string } | null>(
    null,
  );
  const uri = stored?.key === key ? stored.uri : "";
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const error = failure?.key === key ? failure.message : "";
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (api)
      void Promise.resolve()
        .then(() =>
          api.download(api.contentPath(path), { signal: controller.signal }),
        )
        .then((bytes) => {
          if (alive && !api.isClosed)
            setStored({
              key,
              uri: temporaryBytes(api, bytes, "attachment.jpg", conversation),
            });
        })
        .catch(() => {
          if (alive)
            setFailure({ key, message: "附件暂时无法读取，请稍后重试。" });
        });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [api, path, key, attempt, conversation]);
  if (error) return <View style={{ gap: 8, paddingVertical: 12 }}>
    <Text style={s.muted}>{error}</Text>
    <Button title="重新加载照片" secondary onPress={() => { setFailure(null); setStored(null); setAttempt(v => v + 1); }} />
  </View>;
  if (!uri) return <Text style={s.muted}>正在读取照片…</Text>;
  return (
    <QuestionImage
      uri={uri}
      onError={() =>
        setFailure({ key, message: "图片暂时无法显示，请返回后重新打开。" })
      }
    />
  );
}
