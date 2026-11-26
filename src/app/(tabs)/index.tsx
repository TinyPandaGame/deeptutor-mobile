import { compactConversationTitle } from "../../lib/conversation";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Material, Session, Stats } from "../../lib/client";
import { useResource } from "../../lib/resources";
import {
  Button,
  C,
  Empty,
  Failure,
  Heading,
  Icon,
  Page,
  Row,
  Section,
  s,
} from "../../ui";
export default function Home() {
  const stats = useResource<Stats>("/api/question-notebook/stats");
  const sessions = useResource<{ sessions: Session[] }>(
    "/api/sessions?limit=5",
  );
  const materials = useResource<Material[]>("/api/reading/materials");
  const hour = new Date().getHours();
  const greeting =
    hour < 6
      ? "夜深了"
      : hour < 12
        ? "早上好"
        : hour < 18
          ? "下午好"
          : "晚上好";
  return (
    <Page>
      <Heading title="我的学习" sub={`${greeting}，今天也进步一点点`} />
      <View style={s.hero}>
        <Text style={{ color: "#BDE2D6", fontSize: 13, letterSpacing: 1 }}>
          一点一点，学得更明白
        </Text>
        <Text
          style={{
            fontSize: 27,
            color: C.white,
            fontWeight: "700",
            lineHeight: 38,
          }}
        >
          {stats.data?.unresolved ? "从一道错题开始" : "今天想学懂什么？"}
        </Text>
        <Text style={{ color: "#DBEEE7", lineHeight: 23 }}>
          {stats.data?.unresolved
            ? `还有 ${stats.data.unresolved} 道错题可以回顾。\n不着急，先弄懂一题就很好。`
            : "有不懂的就问一问，\n把每一个小问题都慢慢弄清楚。"}
        </Text>
        <Button
          title={stats.data?.unresolved ? "去复习一道题" : "开始提问"}
          secondary
          icon="arrow-forward"
          onPress={() =>
            router.push(
              stats.data?.unresolved ? "/(tabs)/mistakes" : "/chat/new",
            )
          }
        />
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Pressable
          style={[s.card, { flex: 1, gap: 8 }]}
          onPress={() => router.push("/chat/new")}
        >
          <Icon name="chatbubbles-outline" size={26} />
          <Text style={s.h2}>问一问</Text>
          <Text style={s.muted}>一起拆解难题</Text>
        </Pressable>
        <Pressable
          style={[
            s.card,
            {
              flex: 1,
              gap: 8,
              backgroundColor: C.peach,
              borderColor: "#F0DFC9",
            },
          ]}
          onPress={() => router.push("/capture")}
        >
          <Icon name="camera-outline" size={26} color={C.orange} />
          <Text style={s.h2}>拍照提问</Text>
          <Text style={s.muted}>拍下不会的题</Text>
        </Pressable>
      </View>
      <Row
        title="进行中"
        detail="看进度，接着回答或停止"
        icon="time-outline"
        onPress={() => router.push("/ongoing")}
      />
      <Section
        title="我的积累"
        action="全部功能"
        onPress={() => router.push("/modules")}
      />
      <View style={[s.card, { flexDirection: "row", paddingVertical: 21 }]}>
        {[
          { n: stats.data?.wrong, t: "错题", route: "/(tabs)/mistakes" },
          {
            n: materials.data?.length,
            t: "教材资料",
            route: "/(tabs)/materials",
          },
          {
            n: stats.data?.bookmarked,
            t: "重点收藏",
            route: "/(tabs)/mistakes",
          },
        ].map((v, i) => (
          <Pressable
            key={v.t}
            onPress={() => router.push(v.route as "/(tabs)/mistakes")}
            style={{
              flex: 1,
              alignItems: "center",
              gap: 8,
              borderLeftWidth: i ? 1 : 0,
              borderLeftColor: C.line,
            }}
          >
            <Text style={{ fontSize: 27, fontWeight: "700", color: C.ink }}>
              {v.n ?? "—"}
            </Text>
            <Text style={s.muted}>{v.t}</Text>
          </Pressable>
        ))}
      </View>
      {stats.error ? (
        <Failure message={stats.error} retry={() => void stats.reload()} />
      ) : null}
      <Section
        title="继续聊一聊"
        action="全部对话"
        onPress={() => router.push("/history")}
      />
      {sessions.error ? (
        <Failure
          message={sessions.error}
          retry={() => void sessions.reload()}
        />
      ) : sessions.data?.sessions.length === 0 ? (
        <Empty
          title="第一段学习，从提问开始"
          detail="你的聊天会保存在这里，下次可以接着聊。"
          icon="chatbubble-ellipses-outline"
        />
      ) : (
        sessions.data?.sessions.map((item) => (
          <Row
            key={item.id}
            title={compactConversationTitle(item.title)}
            detail={`${item.message_count || 0} 条消息 · 点击继续`}
            icon="chatbubble-ellipses-outline"
            onPress={() =>
              router.push({ pathname: "/chat/[id]", params: { id: item.id } })
            }
          />
        ))
      )}
    </Page>
  );
}
