import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { File } from "expo-file-system";
import { AppState } from "react-native";
import type { TutorClient } from "./client";
import type { Photo } from "./drafts";
import { composerDrafts } from "./native-composer-drafts";
import { temporaryBytes } from "./temporary-files";
import type { ComposerDraft } from "./composer-drafts";

type DraftDocument = { uri: string; name: string; mimeType?: string; size?: number; lastModified: number };
export function useComposerDraft(api: TutorClient | null, route: string, fresh: boolean, value: {
  text: string; photo?: Photo; document: DraftDocument | null; context: Record<string, unknown>;
}, restore: (value: { text: string; photo?: Photo; document: DraftDocument | null; context: Record<string, unknown> }) => void) {
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const latest = useRef(value);
  const restoreRef = useRef(restore);
  useLayoutEffect(() => { latest.current = value; restoreRef.current = restore; });
  const revision = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const discarded = useRef(new Set<string>());
  const scope = api?.scope || "";
  const key = `${scope}\u0000${route}`;
  const ready = loadedKey === key;
  // Serial snapshots prevent a slow attachment read from overwriting a newer send/clear.
  const save = useCallback(() => {
    const current = latest.current;
    const operation = saveQueue.current.catch(() => {}).then(async () => {
      if (!api || api.isClosed || discarded.current.has(key)) return;
      const draft: ComposerDraft = { text: current.text, context: current.context, attachments: [] };
      if (current.photo) draft.attachments.push({ filename: current.photo.filename, base64: current.photo.base64, mime_type: "image/jpeg" });
      if (current.document) draft.attachments.push({ filename: current.document.name, mime_type: current.document.mimeType || "application/octet-stream", base64: await new File(current.document.uri).base64() });
      api.assertOpen();
      if (discarded.current.has(key)) return;
      await composerDrafts.save(scope, route, draft);
    });
    saveQueue.current = operation;
    return operation;
  }, [api, scope, route, key]);
  useEffect(() => {
    let active = true;
    const atStart = revision.current;
    if (!api) return;
    void (async () => {
      try {
        const draft = fresh ? undefined : await composerDrafts.read(scope, route);
        if (draft && active && !api.isClosed && revision.current === atStart) {
          let photo: Photo | undefined;
          let document: DraftDocument | null = null;
          for (const a of draft.attachments) {
            if (a.mime_type.startsWith("image/")) photo = { filename: a.filename, base64: a.base64, uri: `data:${a.mime_type};base64,${a.base64}` };
            else {
              const bytes = Uint8Array.from(atob(a.base64), c => c.charCodeAt(0));
              document = { name: a.filename, mimeType: a.mime_type, size: bytes.byteLength, lastModified: Date.now(), uri: temporaryBytes(api, bytes.buffer, "draft-attachment" + (/\.[a-z0-9]+$/i.exec(a.filename)?.[0] || ".bin"), route) };
            }
          }
          restoreRef.current({ text: draft.text, photo, document, context: draft.context || {} });
        }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setLoadedKey(key); }
    })();
    return () => { active = false; };
  }, [api, scope, route, fresh, key]);
  useEffect(() => {
    if (!ready || !api) return;
    const timer = setTimeout(() => void save().then(() => setError("")).catch(e => setError(e.message)), 450);
    return () => { clearTimeout(timer); };
  }, [ready, api, save, value.text, value.photo, value.document, value.context]);
  useEffect(() => () => { if (ready) void save().catch(() => {}); }, [ready, save]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (ready && state !== "active") void save().catch(e => setError(e.message));
    });
    return () => subscription.remove();
  }, [ready, save]);
  return { ready, error, edited: () => { revision.current++; }, flush: save, discard: async () => {
    discarded.current.add(key);
    await saveQueue.current.catch(() => {});
    await composerDrafts.save(scope, route, { text: '', attachments: [] });
  }, clear: () => {
    latest.current = { ...latest.current, text: "", photo: undefined, document: null };
    return save();
  } };
}
