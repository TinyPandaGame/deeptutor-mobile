import { Directory, File, Paths } from "expo-file-system";
import type { TutorClient } from "./client";
const root = new Directory(Paths.cache, "deeptutor-mobile-sessions");
const owned = new WeakMap<TutorClient, Map<string, { directory: Directory; conversation: string }>>();
const deleted = new WeakMap<TutorClient, Set<string>>();
function checkOwner(api: TutorClient, conversation: string) {
  api.assertOpen();
  if (conversation && deleted.get(api)?.has(conversation)) throw Error('这段对话已删除。');
}
function retain(api: TutorClient, file: File, directory: Directory, conversation: string) {
  const files = owned.get(api) || new Map(); owned.set(api, files);
  files.set(file.uri, { directory, conversation });
  api.onClose(() => { if (directory.exists) directory.delete(); files.delete(file.uri); });
}
export function assignConversationFile(api: TutorClient, uri: string, conversation: string) {
  checkOwner(api, conversation);
  const file = owned.get(api)?.get(uri); if (file) file.conversation = conversation;
}
export function clearConversationFiles(api: TutorClient, ids: string[]) {
  const removed = deleted.get(api) || new Set<string>(); ids.forEach(id => removed.add(id)); deleted.set(api, removed);
  let failed = false;
  for (const [uri, file] of owned.get(api) || []) {
    if (!removed.has(file.conversation)) continue;
    try { if (file.directory.exists) file.directory.delete(); owned.get(api)?.delete(uri); }
    catch { failed = true; }
  }
  if (failed) throw Error('对话附件缓存未能清理完成，请重试清理。');
}
export function clearTemporaryFiles() { if (root.exists) root.delete(); }
export function temporaryBytes(api: TutorClient, bytes: ArrayBuffer, name: string, conversation = "") {
  checkOwner(api, conversation);
  const directory = new Directory(root, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  directory.create({ intermediates: true });
  const file = new File(directory, name);
  try {
    file.write(new Uint8Array(bytes));
    retain(api, file, directory, conversation);
    return file.uri;
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  }
}
export async function ownTemporaryFile(api: TutorClient, uri: string, name: string, conversation = "") {
  checkOwner(api, conversation);
  const directory = new Directory(root, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  directory.create({ intermediates: true });
  const source = new File(uri);
  const file = new File(directory, name.replace(/[^\w.-]/g, "_"));
  try {
    await source.copy(file);
    checkOwner(api, conversation);
    retain(api, file, directory, conversation);
    return file.uri;
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  } finally {
    if (uri.startsWith(Paths.cache.uri)) { try { source.delete(); } catch {} }
  }
}
