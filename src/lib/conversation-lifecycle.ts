import type { TutorClient } from './client.ts';
type Listener = (ids: string[]) => void;
const listeners = new WeakMap<TutorClient, Set<Listener>>();
export function subscribeConversationDeletion(api: TutorClient, listener: Listener) {
  const current = listeners.get(api) || new Set<Listener>(); listeners.set(api, current); current.add(listener);
  return () => { current.delete(listener); };
}
export function notifyConversationDeletion(api: TutorClient, ids: string[]) {
  for (const listener of listeners.get(api) || []) listener(ids);
}
