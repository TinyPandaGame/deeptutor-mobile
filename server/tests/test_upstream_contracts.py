"""Real upstream routers and registry merge; synthetic data, no paid providers/server."""
import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock, patch

temporary = tempfile.TemporaryDirectory(prefix="upstream-contract-", dir=os.environ.get("TEST_SCRATCH"))
os.environ["DEEPTUTOR_HOME"] = temporary.name

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from deeptutor.api.routers import voice
from deeptutor.api.routers import sessions
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.multi_user.paths import user_context
from deeptutor.services.session import get_sqlite_session_store
from deeptutor.services.workspace import get_content_workspace_service
from deeptutor.services.workspace.context import workspace_context
from deeptutor.api.routers.settings import RegistryEditPayload
from deeptutor.services.settings.registry_edit import merge_registry_edit


def require_test_identity(request: Request):
    if request.headers.get("authorization") != "Bearer fixture-token":
        raise HTTPException(401)


app = FastAPI()
app.include_router(voice.router, prefix="/api/voice", dependencies=[Depends(require_test_identity)])
client = TestClient(app)
headers = {"Authorization": "Bearer fixture-token"}


session_workspaces = {}


@contextmanager
def session_identity(name="alice", workspace="math"):
    root = Path(temporary.name) / "data" / "users" / name
    actor = CurrentUser(id=name, username=name, role="user", scope=UserScope(kind="user", user_id=name, root=root))
    with user_context(actor):
        key = (name, workspace)
        if key not in session_workspaces:
            session_workspaces[key] = get_content_workspace_service().create_workspace(workspace)["workspace_id"]
        with workspace_context(session_workspaces[key]):
            yield get_sqlite_session_store()


async def session_authentication(request: Request):
    name = request.headers.get("x-test-user")
    if name not in {"alice", "bob"}:
        raise HTTPException(401)
    with session_identity(name, request.headers.get("x-deeptutor-workspace", "math")):
        yield


app.include_router(sessions.router, prefix="/api/sessions", dependencies=[Depends(session_authentication)])


class SessionDeleteContractsTest(unittest.TestCase):
    def setUp(self):
        self.parent, self.child, self.grandchild, self.keep = [str(uuid4()) for _ in range(4)]
        async def seed(store):
            for id in [self.parent, self.child, self.grandchild, self.keep]:
                await store.create_session(title="Synthetic conversation", session_id=id)
                await store.add_message(id, "user", "Synthetic content")
            await store.update_session_preferences(self.child, {"parent_session_id": self.parent})
            await store.update_session_preferences(self.grandchild, {"parent_session_id": self.child})
        with session_identity() as store:
            self.store = store
            asyncio.run(seed(store))
        self.headers = {"x-test-user": "alice", "X-DeepTutor-Workspace": "math"}

    def exists(self, id):
        with session_identity() as store:
            return asyncio.run(store.get_session(id)) is not None

    def test_delete_acknowledgement_and_descendant_cleanup_preserve_unrelated_conversations(self):
        turns = SimpleNamespace(cancel_turn_and_wait=AsyncMock(return_value=True))
        active = AsyncMock(side_effect=lambda id: [{"id": "synthetic-turn"}] if id == self.parent else [])
        with patch.object(sessions, "_turn_application_service", return_value=turns), patch.object(self.store, "list_active_turns", active), patch.object(sessions, "_cleanup_deleted_session", new=AsyncMock()) as cleanup:
            response = client.delete(f"/api/sessions/{self.parent}", headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {"deleted": True, "session_id": self.parent})
            turns.cancel_turn_and_wait.assert_awaited_once_with("synthetic-turn")
            self.assertEqual([call.args[0] for call in cleanup.await_args_list], [self.grandchild, self.child, self.parent])
        for id in [self.parent, self.child, self.grandchild]:
            self.assertFalse(self.exists(id))
        self.assertTrue(self.exists(self.keep))

    def test_other_account_or_workspace_cannot_delete_this_conversation(self):
        for headers in [{"x-test-user": "bob", "X-DeepTutor-Workspace": "math"}, {"x-test-user": "alice", "X-DeepTutor-Workspace": "chinese"}, {}]:
            result = client.delete(f"/api/sessions/{self.parent}", headers=headers)
            self.assertEqual(result.status_code, 404 if headers else 401)
        self.assertTrue(self.exists(self.parent))
        self.assertTrue(self.exists(self.child))

    def test_unstoppable_turn_returns_conflict_without_deleting_messages(self):
        turns = SimpleNamespace(cancel_turn_and_wait=AsyncMock(return_value=False))
        with patch.object(sessions, "_turn_application_service", return_value=turns), patch.object(self.store, "list_active_turns", new=AsyncMock(return_value=[{"id": "busy-turn"}])), patch.object(sessions, "_cleanup_deleted_session", new=AsyncMock()) as cleanup:
            result = client.delete(f"/api/sessions/{self.parent}", headers=self.headers)
            self.assertEqual(result.status_code, 409, result.text)
            cleanup.assert_not_awaited()
        for id in [self.parent, self.child, self.grandchild, self.keep]:
            self.assertTrue(self.exists(id))

    def test_missing_conversation_and_storage_failure_never_acknowledge_deletion(self):
        self.assertEqual(client.delete("/api/sessions/fixture-does-not-exist", headers=self.headers).status_code, 404)
        with patch.object(sessions, "_turn_application_service", return_value=SimpleNamespace()), patch.object(self.store, "delete_session", new=AsyncMock(return_value=False)), patch.object(sessions, "_cleanup_deleted_session", new=AsyncMock()) as cleanup:
            result = client.delete(f"/api/sessions/{self.parent}", headers=self.headers)
            self.assertEqual(result.status_code, 409, result.text)
            cleanup.assert_not_awaited()
        self.assertTrue(self.exists(self.parent))


class UpstreamContractsTest(unittest.TestCase):
    def test_tts_binary_contract_and_selected_text(self):
        with patch.object(voice, "synthesize_speech", new=AsyncMock(return_value=(b"fixture-audio", "audio/mpeg"))) as synth:
            response = client.post("/api/voice/tts", json={"text": "50% 和 30°"}, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "audio/mpeg")
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.content, b"fixture-audio")
            synth.assert_awaited_once_with("50% 和 30°", voice=None, response_format=None)
            self.assertEqual(client.post("/api/voice/tts", json={"text": "test"}).status_code, 401)
            self.assertEqual(synth.await_count, 1)

    def test_tts_pcm_is_wrapped_as_wav_for_mobile_playback(self):
        with patch.object(voice, "synthesize_speech", new=AsyncMock(return_value=(b"\0\0" * 16, "audio/pcm;rate=24000"))):
            response = client.post("/api/voice/tts", json={"text": "test"}, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "audio/wav")
            self.assertTrue(response.content.startswith(b"RIFF"))

    def test_tts_missing_configuration_and_timeout_remain_explicit(self):
        for error, expected in [(ValueError("fixture missing config"), 400), (voice.VoiceProviderTimeout(), 504), (voice.VoiceProviderError("fixture failure"), 502)]:
            with patch.object(voice, "synthesize_speech", new=AsyncMock(side_effect=error)):
                self.assertEqual(client.post("/api/voice/tts", json={"text": "test"}, headers=headers).status_code, expected)
        self.assertEqual(client.post("/api/voice/tts", json={"text": ""}, headers=headers).status_code, 422)

    def test_actual_typescript_bulk_payload_merges_into_upstream_catalog(self):
        # Execute the shipped planner, then feed its exact payload through the
        # installed upstream schema and merge implementation (not a copy).
        script = """
import { importModelEdits } from './src/lib/model-discovery.ts';
const provider = { id: 'fixture', name: 'Fixture', provider: 'custom', base_url: 'https://api.example.com/v1', api_key: 'fixture-key' };
const catalog = { version: 2, connections: [provider], services: { llm: { profiles: [{ id: 'existing', name: 'Existing', provider_ref: { connection_id: 'fixture' }, models: [{ id: 'existing-model', name: 'Existing', model: 'existing' }] }], active_profile_id: 'existing', active_model_id: 'existing-model' } } };
const edits = importModelEdits(catalog, { provider, ref: { connection_id: 'fixture' } }, 'llm', ['first', 'second', 'existing', 'first']);
process.stdout.write(JSON.stringify({ catalog, edits }));
"""
        result = subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", script], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        catalog = data["catalog"]
        self.assertEqual(len(data["edits"]), 2)
        for edit in data["edits"]:
            parsed = RegistryEditPayload.model_validate(edit)
            catalog = merge_registry_edit(catalog, parsed.model_dump(exclude_none=True))
        bucket = catalog["services"]["llm"]
        self.assertEqual(bucket["active_profile_id"], "existing")
        self.assertEqual(bucket["active_model_id"], "existing-model")
        self.assertEqual({m["model"] for p in bucket["profiles"] for m in p["models"]}, {"first", "second", "existing"})
        self.assertEqual(catalog["connections"][0]["api_key"], "fixture-key")


if __name__ == "__main__":
    unittest.main()
