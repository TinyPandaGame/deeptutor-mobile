import { useEffect, useRef, useState } from "react";
import { Text, View, Alert } from "react-native";
import { useAuth } from "../lib/auth";
import { connection, type Connection } from "../lib/connection";
import { Button, C, Field, Heading, Page, Row, Section, s } from "../ui";
export default function Connect() {
  const auth = useAuth();
  const [kind, setKind] = useState<Connection["kind"]>(auth.config?.kind || "computer");
  const [url, setUrl] = useState(auth.config?.origin || process.env.EXPO_PUBLIC_DEFAULT_SERVER || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function connect(input = url, source = kind) {
    setError(""); setBusy(true);
    try { await auth.connect(connection(input, source)); }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <Page>
    <Heading title="连接我的 DeepTutor" sub="首次填入地址，以后打开直接继续学习" />
    <View style={{ gap: 12 }}>
      <Button title="我的电脑" disabled={busy} secondary={kind !== "computer"} onPress={() => setKind("computer")} />
      <Button title="我的服务器" disabled={busy} secondary={kind !== "server"} onPress={() => setKind("server")} />
    </View>
    <View style={[s.card, { marginTop: 20, gap: 16 }]}>
      <Text style={s.text}>{kind === "computer" ? "电脑先安装并启动 DeepTutor，保持在线。手机与电脑连接同一 Wi-Fi，填写电脑的局域网地址。这里的“本地”指你的电脑。" : "填写你部署的 DeepTutor 服务首页地址。公网使用 HTTPS 并启用登录；私有网络可使用受保护的服务地址。"}</Text>
      <Field label={kind === "computer" ? "电脑地址和端口" : "服务器地址"} placeholder={kind === "computer" ? "192.168.1.20:3782" : "tutor.example.com"} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} onSubmitEditing={() => { if (!busy && url.trim()) void connect(); }} />
      <Text style={s.muted}>可直接粘贴完整地址。电脑地址可省略 http://，公网域名默认使用 https://。不要填写 localhost 或 127.0.0.1。</Text>
      {error || auth.bootError ? <Text accessibilityRole="alert" style={{ color: C.danger }}>{error || auth.bootError}</Text> : null}
      <Button title={busy ? "正在检测学习服务…" : "下一步"} busy={busy} disabled={!url.trim()} onPress={() => void connect()} />
      <Text style={s.muted}>支持 DeepTutor 1.7.1 / 1.7.2。自动识别是否需要账号；下次打开自动恢复连接和登录。HTTP 局域网连接不加密，请只在可信网络使用。</Text>
    </View>
    {!!auth.profiles.length && <Section title="已保存的服务" />}
    {auth.profiles.map(p => <View key={p.origin}>
      <Row title={p.kind === "computer" ? "我的电脑" : "我的服务器"} detail={p.origin} icon="server-outline" onPress={() => void connect(p.origin, p.kind)} />
      <Button title="移除此服务" secondary disabled={busy} onPress={() => Alert.alert("移除连接？", "会清除此设备为该服务保存的登录。", [{ text: "取消" }, { text: "移除", onPress: () => void auth.forget(p.origin).catch(() => setError("未能移除，请重试。")) }])} />
    </View>)}
    <Text style={[s.muted, { marginTop: 20 }]}>电脑和服务器是独立部署时，资料不会自动同步。手机不运行 DeepTutor 模型或服务。</Text>
  </Page>;
}
