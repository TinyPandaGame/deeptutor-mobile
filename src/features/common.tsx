import { useState, useRef } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  Button,
  C,
  Empty,
  Failure,
  Field,
  Heading,
  Icon,
  type IconName,
  Loading,
  Page,
  s,
} from "../ui";
import { useAuth } from "../lib/auth";
import { TutorClient } from "../lib/client";
import { chatDraft } from "../lib/drafts";
import { MathProse } from "./math";
import { hasMath } from "../lib/math-markup";
import { readingBlocks } from "../lib/reading-content";
import { useLearningDisplay } from "../lib/learning-display-context";
import { learningTextStyle } from "../lib/learning-display";
import { selectedPreset, type TextPreset } from "../lib/study-presets";
import { TextCopyActions } from "../components/TextCopyActions";

export const enc = encodeURIComponent;
export function feature(
  area: string,
  id = "",
  extra: Record<string, string> = {},
) {
  router.push({ pathname: "/feature", params: { area, id, ...extra } });
}
export function ask(
  api: TutorClient,
  content: string,
  context: Record<string, unknown> = {},
) {
  chatDraft.set(api, { content, context });
  router.push("/chat/new");
}
export function Chips({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginVertical: 10,
      }}
    >
      {items.map((i) => (
        <Pressable
          key={i.value}
          accessibilityRole="button"
          accessibilityState={{ selected: i.value === value }}
          accessibilityLabel={i.label}
          onPress={() => onChange(i.value)}
          style={({ pressed }) => ({
            paddingHorizontal: 13,
            paddingVertical: 11,
            minHeight: 44,
            maxWidth: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderRadius: 14,
            backgroundColor: i.value === value ? C.pale : C.white,
            borderWidth: 1,
            borderColor: i.value === value ? C.teal : C.line,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon name={i.value === value ? "checkmark-circle" : "ellipse-outline"} size={17} color={i.value === value ? C.teal : C.muted} />
          <Text style={{ color: i.value === value ? C.teal : C.ink, fontSize: 14, lineHeight: 20, fontWeight: i.value === value ? "600" : "400", flexShrink: 1 }}>
            {i.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function PresetField({ label, value, presets, onChange, multiline = true }: {
  label: string;
  value: string;
  presets: TextPreset[];
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const [custom, setCustom] = useState(() => !!value && selectedPreset(value, presets) === null);
  return <View style={[s.card, { padding: 16, gap: 8 }]}>
    <Text style={s.label}>{label}</Text>
    <Text style={s.muted}>选一个即可，也可以按自己的需要修改。</Text>
    <Chips items={[{ value: "", label: "不指定" }, ...presets]} value={value}
      onChange={next => { onChange(next); setCustom(false); }} />
    {value && !custom ? <Text style={s.muted}>{value}</Text> : null}
    <View style={{ alignSelf: "flex-start" }}>
      <Button title={custom ? "收起输入" : "自定义"} secondary compact icon="create-outline" onPress={() => setCustom(v => !v)} />
    </View>
    {custom ? <Field label={`${label} · 自定义`} value={value} onChangeText={onChange} multiline={multiline} /> : null}
  </View>;
}
export function ResourceState({
  resource,
  empty,
}: {
  resource: {
    loading: boolean;
    error: string;
    data: unknown;
    reload: () => void;
  };
  empty?: boolean;
}) {
  if (resource.error)
    return <Failure message={resource.error} retry={resource.reload} />;
  if (resource.loading && !resource.data) return <Loading />;
  return empty ? (
    <Empty title="这里还没有内容" detail="添加内容后，会显示在这里。" />
  ) : null;
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  return { busy, error, run };
}
export type InputSpec = {
  key: string;
  label: string;
  value?: string;
  multiline?: boolean;
  required?: boolean;
  number?: boolean;
  options?: { value: string; label: string }[];
  presets?: TextPreset[];
};
// Keep one KeyboardProvider at the app root. Multiple providers overwrite the
// native Modal's dismissal listener and leave the main keyboard callback suspended.
// Resize the modal form independently using native keyboard frame notifications.
export function FormModal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (Keyboard.isVisible()) Keyboard.dismiss();
        else onClose();
      }}
    >
      <SafeAreaProvider>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {children}
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}
export function Editor({
  title,
  fields,
  onSave,
  onClose,
  beforeFields,
}: {
  title: string;
  fields: InputSpec[];
  onSave: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
  beforeFields?: (values: Record<string, string>, update: (values: Record<string, string>) => void) => React.ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, f.value ?? f.options?.[0]?.value ?? ""]),
    ),
  );
  const action = useAction();
  return (
    <FormModal onClose={onClose}>
      <Page>
        <Heading
          title={title}
          right={<Button title="取消" compact secondary onPress={onClose} />}
        />
        <View style={{ gap: 18 }}>
          {beforeFields?.(values, patch => setValues(current => ({ ...current, ...patch })))}
          {fields.map((f) =>
            f.presets ? (
              <PresetField key={f.key} label={f.label} presets={f.presets} value={values[f.key]}
                multiline={f.multiline} onChange={v => setValues(x => ({ ...x, [f.key]: v }))} />
            ) : f.options ? (
              <View key={f.key}>
                <Text style={s.label}>{f.label}</Text>
                <Chips
                  items={f.options}
                  value={values[f.key]}
                  onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
                />
              </View>
            ) : (
              <Field
                key={f.key}
                label={f.label}
                value={values[f.key]}
                onChangeText={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
                multiline={f.multiline}
                keyboardType={f.number ? "numeric" : "default"}
              />
            ),
          )}
          {action.error ? (
            <Text style={{ color: C.danger }}>{action.error}</Text>
          ) : null}
          <Button
            title="保存"
            busy={action.busy}
            disabled={fields.some((f) => f.required && !values[f.key]?.trim())}
            onPress={() =>
              void action.run(async () => {
                await onSave(values);
                onClose();
              })
            }
          />
        </View>
      </Page>
    </FormModal>
  );
}
export function confirmDelete(title: string, action: () => Promise<void>) {
  Alert.alert(`删除${title}？`, "删除后无法恢复，请确认当前选中的内容。", [
    { text: "取消", style: "cancel" },
    {
      text: "删除",
      style: "destructive",
      onPress: () =>
        void action().catch((e) => Alert.alert("未能删除", e.message)),
    },
  ]);
}
export function Actions({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: 10, marginVertical: 12 }}>{children}</View>;
}
export function SmallAction({
  title,
  onPress,
  icon,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
}) {
  return (
    <Button title={title} onPress={onPress} compact secondary icon={icon}
      disabled={disabled} danger={title.startsWith("删除") || title.startsWith("移除")} />
  );
}
// Markdown stays native Text: headings, lists, code and quotations keep selection.
// HTML is never evaluated here and server content cannot navigate the app.
export function Prose({ text, streaming = false }: { text: unknown; streaming?: boolean }) {
  const { value: display } = useLearningDisplay();
  if (typeof text !== "string" || !text.trim()) return null;
  return (
    <View style={{ gap: 9 }}>
      {readingBlocks(text, streaming).map((block, i) => (
        block.kind !== "code" && hasMath(block.text) ? (
          <MathProse key={i} text={block.text} streaming={streaming} />
        ) : (
          <Text key={i} selectable style={[
            s.text,
            learningTextStyle(display, block.kind === "heading" ? 18 : 16),
            block.kind === "heading" && { fontWeight: "700", marginTop: 4 },
            block.kind === "code" && { fontFamily: "monospace", padding: 10, backgroundColor: C.pale, borderRadius: 8 },
          ]}>{block.text}</Text>
        )
      ))}
      <TextCopyActions text={text} disabled={streaming} />
    </View>
  );
}
export function Refresh({ onPress }: { onPress: () => void }) {
  return <SmallAction title="刷新" icon="refresh-outline" onPress={onPress} />;
}
export function AccountNote() {
  const { user } = useAuth();
  return <Text style={s.muted}>保存到 {user?.username} 的学习空间</Text>;
}
