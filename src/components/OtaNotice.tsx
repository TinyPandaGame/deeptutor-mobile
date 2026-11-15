import { useEffect } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ota, useOta } from "../lib/ota";
import { C, s } from "../ui";
import { promptForUpdate, restartForUpdate } from "../lib/update-actions";
import { observeUpdateChecks } from "../lib/update-lifecycle";

export function OtaNotice() {
  const state = useOta();
  useEffect(() => observeUpdateChecks(ota, {
    current: () => AppState.currentState,
    subscribe: listener => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
  }, promptForUpdate), []);
  if (state.status !== "ready") return null;
  return <SafeAreaView edges={["top"]} style={{ backgroundColor: C.pale }}>
    <View style={{ flexDirection: "row", paddingHorizontal: 18, paddingVertical: 10, alignItems: "center", gap: 10 }}>
      <Text style={[s.muted, { flex: 1 }]}>{state.message || "新版本已下载，重新打开应用后生效。"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="立即重启" onPress={restartForUpdate} style={{ padding: 10 }}>
        <Text style={s.link}>立即重启</Text>
      </Pressable>
    </View>
  </SafeAreaView>;
}
