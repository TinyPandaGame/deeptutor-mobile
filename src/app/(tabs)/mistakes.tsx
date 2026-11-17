import { useEffect, useState } from "react";
import {
  QUESTION_PAGE_SIZE,
  questionListPath,
  documentPreview,
} from "../../lib/learning-records";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useResource } from "../../lib/resources";
import { Question } from "../../lib/client";
import { Chips } from "../../features/common";
import {
  C,
  Button,
  Empty,
  Failure,
  FormScrollView,
  Heading,
  Icon,
  Loading,
  Page,
  s,
} from "../../ui";
export default function Mistakes() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState({ search: "", filter: "all", page: 0 });
  useEffect(() => {
    const timer = setTimeout(() => setQuery({ search, filter, page: 0 }), 300);
    return () => clearTimeout(timer);
  }, [search, filter]);
  const q = useResource<{ items: Question[]; total: number }>(
    questionListPath(query.search, query.filter, query.page),
  );
  const pending = search !== query.search || filter !== query.filter;
  const items = pending ? [] : q.data?.items || [];
  return (
    <Page scroll={false}>
      <FormScrollView
        contentContainerStyle={s.pageBody}
        refreshControl={
          <RefreshControl
            refreshing={q.loading && !!q.data}
            onRefresh={q.reload}
            tintColor={C.teal}
          />
        }
      >
        <Heading
          title="我的错题本"
          sub="把做错的，变成真正会的"
          right={
            <Pressable
              accessibilityLabel="记录错题"
              onPress={() => router.push("/question/new")}
              style={s.iconButton}
            >
              <Icon name="add" />
            </Pressable>
          }
        />
        <View style={{ marginBottom: 18 }}>
          <Button
            title="拍照 / 相册录入错题"
            icon="camera-outline"
            onPress={() => router.push("/question/new")}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: C.white,
            borderRadius: 15,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderColor: C.line,
          }}
        >
          <Icon name="search-outline" size={19} color={C.muted} />
          <TextInput
            accessibilityLabel="搜索错题"
            placeholder="搜索全部错题"
            maxLength={200}
            value={search}
            onChangeText={setSearch}
            style={{ flex: 1, padding: 14, color: C.ink, fontSize: 15 }}
          />
        </View>
        <Chips
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "全部错题" },
            { value: "todo", label: "待回顾" },
            { value: "star", label: "重点收藏" },
          ]}
        />
        {q.error ? <Failure message={q.error} retry={q.reload} /> : null}
        {pending || (q.loading && !q.data) ? <Loading /> : null}
        {!pending && !q.loading && !q.error && !items.length ? (
          <Empty
            title={search ? "没有找到这道题" : "这里暂时还没有错题"}
            detail="做错不是坏事，记录下来就是进步的开始。"
            icon="book-outline"
          />
        ) : null}
        {items.map((item, index) => (
          <Pressable
            key={item.id}
            style={[s.card, { marginBottom: 12, gap: 12 }]}
            onPress={() =>
              router.push({
                pathname: "/question/[id]",
                params: { id: String(item.id) },
              })
            }
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text style={s.tag}>
                {item.categories?.[0]?.name || "学习错题"}
              </Text>
              <Text style={[s.muted, { flex: 1 }]}>
                {item.resolved ? "已回顾" : "待回顾"}
              </Text>
              {item.bookmarked && (
                <Icon name="star" size={16} color={C.orange} />
              )}
              <Text style={s.muted}>
                {String(query.page * QUESTION_PAGE_SIZE + index + 1).padStart(
                  2,
                  "0",
                )}
              </Text>
            </View>
            <Text style={s.text} numberOfLines={3}>
              {documentPreview(item.question)}
            </Text>
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Text style={s.muted}>先自己想一想，再看讲解</Text>
              <Icon name="arrow-forward" size={18} />
            </View>
          </Pressable>
        ))}
        {(q.data?.total || 0) > QUESTION_PAGE_SIZE || query.page > 0 ? (
          <View style={{ gap: 12, paddingVertical: 18 }}>
            <Text style={s.muted}>
              第 {query.page + 1} 页 · 共 {q.data?.total ?? "…"} 道题
            </Text>
            <Button
              title="上一页"
              secondary
              disabled={pending || q.loading || query.page === 0}
              onPress={() =>
                setQuery((v) => ({ ...v, page: Math.max(0, v.page - 1) }))
              }
            />
            <Button
              title="下一页"
              secondary
              disabled={
                pending ||
                q.loading ||
                (query.page + 1) * QUESTION_PAGE_SIZE >= (q.data?.total || 0)
              }
              onPress={() => setQuery((v) => ({ ...v, page: v.page + 1 }))}
            />
          </View>
        ) : null}
      </FormScrollView>
    </Page>
  );
}
