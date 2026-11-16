export type DraftAttachment = { filename: string; base64: string; mime_type: string };
export type ComposerDraft = { text: string; attachments: DraftAttachment[]; context?: Record<string, unknown> };
type Entry = { scope: string; route: string; draft: ComposerDraft };
export type DraftStorage = { read: () => Promise<string | null>; write: (text: string) => Promise<void> };
// Private app storage, partitioned by exact server + account + workspace + route.
// Never evict another unsent draft to make a newer one fit.
export class ComposerDraftStore {
  private pending: Promise<unknown> = Promise.resolve();
  private removed = new Map<string, Set<string>>();
  private storage: DraftStorage;
  constructor(storage: DraftStorage) { this.storage = storage; }
  private async entries(): Promise<Entry[]> {
    const raw = await this.storage.read();
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error("草稿记录无法读取，原文件已保留。");
    return data.entries;
  }
  async read(scope: string, route: string): Promise<ComposerDraft | undefined> {
    await this.pending;
    const found = (await this.entries()).find(e => e.scope === scope && e.route === route)?.draft;
    return found ? JSON.parse(JSON.stringify(found)) as ComposerDraft : undefined;
  }
  save(scope: string, route: string, draft: ComposerDraft): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(draft)) as ComposerDraft;
    const operation = this.pending.catch(() => {}).then(async () => {
      const entries = (await this.entries()).filter(e => e.scope !== scope || e.route !== route);
      if (!this.isRemoved(scope, route, snapshot) && (snapshot.text || snapshot.attachments.length)) entries.push({ scope, route, draft: snapshot });
      const content = JSON.stringify({ version: 1, entries });
      if (content.length > 40 * 1024 * 1024) throw new Error("本机未发送草稿较多，请先发送或清除部分草稿。原草稿已保留。");
      await this.storage.write(content);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  private isRemoved(scope: string, route: string, draft: ComposerDraft) {
    const ids = this.removed.get(scope);
    const source = draft.context?.selection_tutor_context as { parent_session_id?: string } | undefined;
    return ids?.has(route) || (source?.parent_session_id && ids?.has(source.parent_session_id));
  }
  removeConversations(scope: string, ids: string[]): Promise<void> {
    const removed = this.removed.get(scope) || new Set<string>();
    ids.forEach(id => removed.add(id)); this.removed.set(scope, removed);
    const operation = this.pending.catch(() => {}).then(async () => {
      const entries = (await this.entries()).filter(e => e.scope !== scope || !this.isRemoved(scope, e.route, e.draft));
      await this.storage.write(JSON.stringify({ version: 1, entries }));
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

}
