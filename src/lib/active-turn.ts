export type SessionTurn = {
  id: string;
  status: string;
  last_seq?: number;
  assistant_message_id?: string | number | null;
};

type TurnSummary = {
  status?: string;
  active_turn_id?: string;
  active_turns?: SessionTurn[];
  active_turn?: SessionTurn | null;
};

const liveStatuses = new Set(["queued", "running", "waiting_input", "recovering"]);

/** Read the current detail response, with compatibility for older servers. */
export function activeSessionTurn(session: TurnSummary): SessionTurn | undefined {
  const isLive = (turn: SessionTurn | null | undefined): turn is SessionTurn =>
    !!turn?.id && liveStatuses.has(turn.status);
  if (Array.isArray(session.active_turns)) return session.active_turns.find(isLive);
  if (isLive(session.active_turn)) return session.active_turn;
  if (session.active_turn_id && session.status && liveStatuses.has(session.status)) {
    return { id: session.active_turn_id, status: session.status };
  }
}

export function messagesForTurnReplay<T extends { id: string | number }>(
  messages: T[],
  turn: SessionTurn | undefined,
): T[] {
  const liveMessage = turn?.assistant_message_id;
  if (liveMessage == null) return messages;
  return messages.filter(message => String(message.id) !== String(liveMessage));
}

export function reachedReplayHead(
  turn: SessionTurn,
  event: { type: string; turn_id?: string },
  sequence: number,
): boolean {
  if (event.turn_id && event.turn_id !== turn.id) return false;
  return event.type === "done" || event.type === "error" ||
    (event.turn_id === turn.id && sequence >= (turn.last_seq || 0));
}
