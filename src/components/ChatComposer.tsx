import { useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { C, Icon, s, type IconName } from "../ui";

export type ComposerTool = {
  key: string;
  title: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
};

export function ChatComposer({ text, onChangeText, onSend, editable, sendDisabled, toolsDisabled,
  keyboardVisible, tools, modelLabel }: {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  editable: boolean;
  sendDisabled: boolean;
  toolsDisabled: boolean;
  keyboardVisible: boolean;
  tools: ComposerTool[];
  modelLabel: string;
}) {
  const input = useRef<TextInput>(null);
  const [expanded, setExpanded] = useState(false);
  const showingTools = expanded && !toolsDisabled;
  useEffect(() => {
    if (!showingTools) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { setExpanded(false); return true; });
    return () => subscription.remove();
  }, [showingTools]);
  const toggleTools = () => {
    if (toolsDisabled) return;
    if (expanded) {
      setExpanded(false);
      input.current?.focus();
    } else {
      input.current?.blur();
      Keyboard.dismiss();
      setExpanded(true);
    }
  };
  const choose = (tool: ComposerTool) => {
    if (toolsDisabled || tool.disabled) return;
    setExpanded(false);
    input.current?.blur();
    Keyboard.dismiss();
    tool.onPress();
  };
  return <View style={{ gap: 10 }}>
    <View style={styles.bar}>
      <TextInput
        ref={input}
        accessibilityLabel="输入问题"
        placeholder="把问题告诉我…"
        value={text}
        onChangeText={onChangeText}
        onFocus={() => setExpanded(false)}
        editable={editable}
        multiline
        style={[s.input, styles.input]}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={showingTools ? "收起更多功能" : "更多功能"}
        accessibilityState={{ expanded: showingTools, disabled: toolsDisabled }} disabled={toolsDisabled}
        onPress={toggleTools} style={({ pressed }) => [styles.more, pressed && { backgroundColor: C.pale }, toolsDisabled && { opacity: 0.4 }]}>
        <Icon name={showingTools ? "close-outline" : "add-outline"} size={27} />
      </Pressable>
      {!!text.trim() && <Pressable accessibilityRole="button" accessibilityLabel="发送问题"
        accessibilityState={{ disabled: sendDisabled }} disabled={sendDisabled}
        onPress={() => { if (!sendDisabled) { setExpanded(false); onSend(); } }}
        style={({ pressed }) => [styles.send, (sendDisabled || pressed) && { opacity: 0.5 }]}>
        <Text style={styles.sendText}>发送</Text>
      </Pressable>}
    </View>
    {showingTools && !keyboardVisible && <ScrollView keyboardShouldPersistTaps="handled"
      style={{ maxHeight: 240 }} contentContainerStyle={styles.panel}>
      <View style={styles.grid}>
        {tools.map(tool => <Pressable key={tool.key} accessibilityRole="button" accessibilityLabel={tool.title}
          disabled={tool.disabled} accessibilityState={{ disabled: !!tool.disabled }}
          onPress={() => choose(tool)} style={({ pressed }) => [styles.tool, (pressed || tool.disabled) && { opacity: 0.4 }]}>
          <View style={styles.toolIcon}><Icon name={tool.icon} size={27} /></View>
          <Text style={styles.toolText}>{tool.title}</Text>
        </Pressable>)}
      </View>
      <Text numberOfLines={2} style={[s.muted, { fontSize: 12 }]}>当前模型：{modelLabel}</Text>
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 125, paddingHorizontal: 12,
    paddingVertical: 10, borderRadius: 12, backgroundColor: C.bg },
  more: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line,
    alignItems: "center", justifyContent: "center" },
  send: { minWidth: 54, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12,
    backgroundColor: C.teal, alignItems: "center", justifyContent: "center" },
  sendText: { color: C.white, fontSize: 15, fontWeight: "600" },
  panel: { gap: 14, paddingTop: 8, paddingBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "5%", rowGap: 16 },
  tool: { width: "30%", alignItems: "center", gap: 7 },
  toolIcon: { width: 54, height: 50, borderRadius: 14, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  toolText: { color: C.ink, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
