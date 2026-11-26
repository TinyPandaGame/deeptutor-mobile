import { useEffect, useState } from "react";
import { Text, View, type ViewProps } from "react-native";
import { requireNativeViewManager } from "expo-modules-core";
import { File } from "expo-file-system";
import { temporaryBytes } from "../lib/temporary-files";
import { useAuth } from "../lib/auth";
import { Button, Failure, Heading, Loading, Page, s } from "../ui";
import { FormModal } from "./common";
type Props = ViewProps & {
  uri: string;
  page: number;
  onDocumentState: (event: {
    nativeEvent: { pages?: number; error?: string };
  }) => void;
};
const NativeDocument = requireNativeViewManager<Props>("LearningDocument");
export function Pdf({
  materialId,
  page,
  path,
  onPages,
  expandable = false,
}: {
  materialId?: string;
  page: number;
  path?: string;
  onPages?: (count: number) => void;
  expandable?: boolean;
}) {
  const { api } = useAuth();
  const source = JSON.stringify([api?.scope, materialId, path]);
  const [document, setDocument] = useState<{ source: string; uri: string }>();
  const [failure, setFailure] = useState<{ source: string; message: string }>();
  const [expandedSource, setExpandedSource] = useState("");
  const [retry, setRetry] = useState(0);
  const uri = document?.source === source ? document.uri : "";
  const error = failure?.source === source ? failure.message : "";
  const expanded = expandedSource === source;
  useEffect(() => {
    let alive = true;
    let file: File | undefined;
    const controller = new AbortController();
    if (api)
      void (async () => {
        try {
          await api.ensureSession();
          const bytes = await api.download(
            path ? api.contentPath(path) : `/api/reading/materials/${encodeURIComponent(materialId || "")}/raw`,
            { signal: controller.signal }, 60000, 50 * 1024 * 1024,
          );
          if (!alive) return;
          file = new File(temporaryBytes(api, bytes, "reader.pdf"));
          setDocument({ source, uri: file.uri });
        } catch (e) {
          if (alive) setFailure({ source, message: (e as Error).message });
        }
      })();
    return () => {
      alive = false;
      controller.abort();
      if (file?.exists) file.delete();
    };
  }, [api, materialId, path, retry, source]);
  const renderDocument = (fill: boolean) => (
    <NativeDocument
      uri={uri}
      page={page}
      style={{ ...(fill ? { flex: 1 } : { height: 520 }), width: "100%", backgroundColor: "white" }}
      onDocumentState={(e) => {
        if (e.nativeEvent.error) setFailure({ source, message: e.nativeEvent.error });
        if (e.nativeEvent.pages) onPages?.(e.nativeEvent.pages);
      }}
    />
  );
  const retryDocument = () => {
    setDocument(undefined);
    setFailure(undefined);
    setRetry((v) => v + 1);
  };
  const closeExpanded = () => setExpandedSource("");
  return (
    <View style={{ gap: 8 }}>
      {error ? (
        <Failure message={error} retry={retryDocument} />
      ) : uri ? (
        expanded ? <View style={{ height: 520 }} /> : renderDocument(false)
      ) : (
        <Loading />
      )}
      {expandable && uri && !error ? <Button title="全屏看原页" compact secondary
        icon="expand-outline" onPress={() => setExpandedSource(source)} /> : null}
      {uri && !error ? <Text style={s.muted}>双指缩放查看教材原页</Text> : null}
      {expanded ? <FormModal onClose={closeExpanded}>
        <Page scroll={false}>
          <View style={{ flex: 1, paddingHorizontal: 12 }}>
            <Heading title={`教材原页 · 第 ${page} 页`} compact
              right={<Button title="关闭" compact secondary onPress={closeExpanded} />} />
            {error ? <Failure message={error} retry={retryDocument} /> : uri ? renderDocument(true) : <Loading />}
          </View>
        </Page>
      </FormModal> : null}
    </View>
  );
}
