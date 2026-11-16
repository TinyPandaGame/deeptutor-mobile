"""Permanent conversation deletion with independently retained notebook images.

Version gated by mobile_models.install. Uses current user/workspace stores only.
No caller-controlled filesystem paths and no network fetching of image URLs.
"""
import asyncio
import hashlib
import json
import re
import shutil
from urllib.parse import unquote, urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deeptutor.api.routers import sessions
from deeptutor.api.routers.auth import require_auth
from deeptutor.services.session import get_sqlite_session_store
from deeptutor.services.storage.attachment_store import get_attachment_store, LocalDiskAttachmentStore

router = APIRouter(prefix="/api/mobile/conversations", dependencies=[Depends(require_auth)])


@router.get("/capabilities")
async def capabilities():
    return {"permanent_delete": 1, "preserves_notebook_images": True}


class CleanupRequest(BaseModel):
    session_ids: list[str] = Field(min_length=1, max_length=1000)


def valid_id(value):
    # DeepTutor-generated identifiers; reject paths and sanitized aliases.
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", value):
        raise HTTPException(422, "Invalid conversation identifier")
    return value


def notebook_rows(store):
    with store._connect() as conn:
        # A retained question can reference a photo from an earlier conversation,
        # so inspect image-bearing entries across this scoped notebook only.
        return [dict(row) for row in conn.execute(
            "SELECT id, session_id, origin_type, origin_ref, user_answer_images_json FROM notebook_entries "
            "WHERE user_answer_images_json IS NOT NULL AND user_answer_images_json != '[]'"
        ).fetchall()]


async def retain_notebook_images(store, attachments, ids):
    for row in await asyncio.to_thread(notebook_rows, store):
        images = json.loads(row["user_answer_images_json"] or "[]")
        retained, changed, replacements = [], False, {}
        owner = row["session_id"] if row["session_id"] and row["session_id"] not in ids else (
            "question-notebook-" + hashlib.sha256(f"{row['origin_type']}:{row['origin_ref']}".encode()).hexdigest()[:24]
        )
        for image in images:
            url = str(image.get("url") or "")
            path = urlsplit(url).path
            match = re.fullmatch(r"/(?:api|files)/attachments/([^/]+)/([^/]+)/(.+)", path)
            if not match or unquote(match[1]) not in ids:
                retained.append(image)
                continue
            source_id, attachment_id, filename = map(unquote, match.groups())
            source = attachments.resolve_path(session_id=source_id, attachment_id=attachment_id, filename=filename)
            if source is None:
                raise HTTPException(409, "A notebook image cannot be read; conversation was not deleted")
            data = await asyncio.to_thread(source.read_bytes)
            # Stable ID makes a retry reuse the same independent image.
            image_id = hashlib.sha256(f"{row['id']}:{url}".encode()).hexdigest()[:24]
            kept_url = await attachments.put(session_id=owner, attachment_id=image_id,
                                            filename=filename, data=data, mime_type=image.get("mime_type", ""))
            kept = attachments.resolve_path(session_id=owner, attachment_id=image_id, filename=filename)
            if kept is None or await asyncio.to_thread(kept.read_bytes) != data:
                raise HTTPException(503, "Notebook image preservation was not confirmed")
            retained.append({**image, "id": image_id, "url": kept_url})
            replacements[url] = {"id": image_id, "url": kept_url}
            changed = True
        if changed:
            def commit():
                with store._connect() as conn:
                    conn.execute("UPDATE notebook_entries SET user_answer_images_json = ? WHERE id = ?",
                                 (json.dumps(retained, ensure_ascii=False), row["id"]))
                    def rewrite(value):
                        if isinstance(value, dict):
                            result = {key: rewrite(item) for key, item in value.items()}
                            if value.get("url") in replacements:
                                result.update(replacements[value["url"]])
                            return result
                        if isinstance(value, list):
                            return [rewrite(item) for item in value]
                        return value
                    attempts = conn.execute("SELECT attempt_id, assessment_json FROM assessment_attempts WHERE notebook_entry_id = ?", (row["id"],)).fetchall()
                    for attempt in attempts:
                        data = rewrite(json.loads(attempt["assessment_json"]))
                        conn.execute("UPDATE assessment_attempts SET assessment_json = ? WHERE attempt_id = ?",
                                     (json.dumps(data, ensure_ascii=False), attempt["attempt_id"]))
                    conn.commit()
            await asyncio.to_thread(commit)


def purge_files(attachments, id):
    if not isinstance(attachments, LocalDiskAttachmentStore):
        raise HTTPException(409, "This attachment storage has not been validated for permanent deletion")
    roots = [attachments.root, attachments._legacy_root]
    for root in roots:
        if root is None:
            continue
        target = root / valid_id(id)
        if target.is_symlink():
            raise HTTPException(409, "Refusing to follow an attachment directory symlink")
        if target.exists():
            # Unlike upstream's best-effort cleanup, failures remain visible.
            shutil.rmtree(target)
        if target.exists():
            raise HTTPException(503, "Conversation attachments remain on disk")


def delete_rows(store, ids):
    # One scoped SQLite transaction: never remove only part of a conversation
    # tree, and retain a retry receipt without any message contents.
    with store._connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS mobile_deletion_cleanup (session_id TEXT PRIMARY KEY)")
        for id in ids:
            if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (id,)).fetchone() is None:
                raise HTTPException(409, "Conversation changed during deletion; retry")
        for id in reversed(ids):
            conn.execute("DELETE FROM sessions WHERE id = ?", (id,))
            conn.execute("INSERT OR REPLACE INTO mobile_deletion_cleanup VALUES (?)", (id,))
        conn.commit()


def receipt(store, id, remove=False):
    with store._connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS mobile_deletion_cleanup (session_id TEXT PRIMARY KEY)")
        present = conn.execute("SELECT 1 FROM mobile_deletion_cleanup WHERE session_id = ?", (id,)).fetchone() is not None
        if remove:
            conn.execute("DELETE FROM mobile_deletion_cleanup WHERE session_id = ?", (id,)); conn.commit()
        return present


async def cleanup(ids):
    store, attachments = get_sqlite_session_store(), get_attachment_store()
    pending = []
    for id in ids:
        valid_id(id)
        if await store.get_session(id) is not None:
            raise HTTPException(409, "Conversation still exists; attachment cleanup was not started")
        # Never accept an arbitrary folder name, especially a notebook owner.
        if await asyncio.to_thread(receipt, store, id):
            pending.append(id)
        elif isinstance(attachments, LocalDiskAttachmentStore) and any(
            root and (root / id).exists() for root in (attachments.root, attachments._legacy_root)
        ):
            raise HTTPException(403, "No deletion receipt for this attachment directory")
    await retain_notebook_images(store, attachments, pending)
    for id in pending:
        await sessions._cleanup_deleted_session(id)
        await asyncio.to_thread(purge_files, attachments, id)
        await asyncio.to_thread(receipt, store, id, True)


@router.post("/cleanup")
async def retry_cleanup(payload: CleanupRequest):
    await cleanup(payload.session_ids)
    return {"cleaned": True, "session_ids": payload.session_ids}


@router.delete("/{session_id}")
async def delete_conversation(session_id: str):
    valid_id(session_id)
    store, attachments = get_sqlite_session_store(), get_attachment_store()
    if await store.get_session(session_id) is None:
        raise HTTPException(404, "Conversation not found")
    if not isinstance(attachments, LocalDiskAttachmentStore):
        raise HTTPException(409, "This attachment storage has not been validated for permanent deletion")
    def tree_rows():
        with store._connect() as conn:
            return [dict(row) for row in conn.execute("SELECT id, preferences_json FROM sessions").fetchall()]
    # Include archived/recycle-bin descendants, not just visible history rows.
    rows = await asyncio.to_thread(tree_rows)
    children = {}
    for row in rows:
        prefs = json.loads(row["preferences_json"] or "{}")
        children.setdefault(str(prefs.get("parent_session_id") or ""), []).append(row["id"])
    ordered, seen = [session_id], {session_id}
    for parent in ordered:
        for child in children.get(parent, []):
            if child not in seen:
                valid_id(child); seen.add(child); ordered.append(child)
    turns = sessions._turn_application_service()
    for id in ordered:
        for turn in await store.list_active_turns(id):
            if not await turns.cancel_turn_and_wait(turn["id"]):
                raise HTTPException(409, "Active conversation could not be stopped")
    await retain_notebook_images(store, attachments, ordered)
    # Same scoped schema/FK semantics as upstream, committed atomically for
    # the complete tree. Notebook IDs, categories and attempts stay intact.
    await asyncio.to_thread(delete_rows, store, ordered)
    result = {"deleted": True, "session_id": session_id}
    try:
        await cleanup(ordered)
    except Exception:
        return {**result, "deleted_session_ids": ordered, "cleanup_complete": False}
    return {**result, "deleted_session_ids": ordered, "cleanup_complete": True}
