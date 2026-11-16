import { Directory, File, Paths } from "expo-file-system";
import { ComposerDraftStore } from "./composer-drafts";
const directory = new Directory(Paths.document, "composer-drafts");
const files = () => directory.exists ? directory.list().filter((entry): entry is File => entry instanceof File && /^v1-.*\.json$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name)) : [];
export const composerDrafts = new ComposerDraftStore({
  read: async () => {
    const saved = files();
    for (const file of saved) {
      const text = await file.text();
      try { if (JSON.parse(text).version === 1) return text; } catch { /* A failed write must not hide the last readable draft. */ }
    }
    if (saved.length) throw new Error("草稿记录无法读取，原文件已保留。");
    return null;
  },
  write: async content => {
    directory.create({ intermediates: true, idempotent: true });
    // Serialize all writers; retain the last readable record if a write fails.
    const previous = files();
    const next = new File(directory, `v1-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    next.write(content);
    if (await next.text() !== content) throw new Error("草稿没有完整保存，请保留当前输入后重试。");
    let cleanupFailed = false;
    for (const old of previous) { try { old.delete(); } catch { cleanupFailed = true; } }
    if (cleanupFailed) throw Error("旧草稿文件未能清理完成，请重试清理。");
  },
});
