import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "../lib/auth";
import { compactConversationTitle } from "../lib/conversation";
import { loadTaskOverview, type TaskOverview } from "../lib/ongoing-sessions";
import { Empty, Failure, Heading, Loading, Page, Row, Section } from "../ui";

export default function Ongoing() {
  const { api } = useAuth();
  const [snapshot, setSnapshot] = useState<{ scope: string; tasks: TaskOverview }>();
  const [error, setError] = useState("");
  const refresh = useRef<() => void>(null);
  const tasks = snapshot?.scope === api?.scope ? snapshot?.tasks : undefined;

  useFocusEffect(
    useCallback(() => {
      if (!api) return;
      setError("");
      let current: AbortController | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        clearTimeout(timer);
        current?.abort();
        current = undefined;
      };
      const fetchTasks = async () => {
        if (current || api.isClosed) return;
        const controller = new AbortController();
        current = controller;
        try {
          const tasks = await loadTaskOverview(api, controller.signal);
          if (!controller.signal.aborted && !api.isClosed) {
            setSnapshot({ scope: api.scope, tasks });
            setError("");
          }
        } catch (error) {
          if (!controller.signal.aborted && !api.isClosed) {
            setError((error as Error).message);
          }
        } finally {
          if (current === controller) current = undefined;
          if (!controller.signal.aborted && !api.isClosed && AppState.currentState === "active") {
            timer = setTimeout(() => void fetchTasks(), 8000);
          }
        }
      };
      const resume = () => {
        clearTimeout(timer);
        void fetchTasks();
      };
      refresh.current = resume;
      const listener = AppState.addEventListener("change", state => {
        if (state === "active") resume();
        else stop();
      });
      if (AppState.currentState === "active" || AppState.currentState == null) resume();
      return () => {
        listener.remove();
        stop();
        refresh.current = null;
      };
    }, [api]),
  );

  const openChat = (id: string) =>
    router.push({ pathname: "/chat/[id]", params: { id } });

  return (
    <Page>
      <Heading title="进行中" sub="接着处理当前工作区的学习任务" back />
      {error ? <Failure message={error} retry={() => refresh.current?.()} /> : null}
      {!error && !tasks ? <Loading /> : null}
      {!error && tasks?.active.length === 0 ? (
        <Empty
          title="现在没有进行中的任务"
          detail="用电脑或手机开始学习后，可以回到这里看进度。"
          icon="time-outline"
        />
      ) : null}
      {tasks?.active.map(task => (
        <Row
          key={task.id}
          title={compactConversationTitle(task.title)}
          detail={task.label}
          icon="time-outline"
          onPress={() => openChat(task.id)}
        />
      ))}
      {tasks?.recent.length ? <Section title="最近结束" /> : null}
      {tasks?.recent.map(task => (
        <Row
          key={task.id}
          title={compactConversationTitle(task.title)}
          detail={task.label}
          icon="chatbubble-ellipses-outline"
          onPress={() => openChat(task.id)}
        />
      ))}
    </Page>
  );
}
