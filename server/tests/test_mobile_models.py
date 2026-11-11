"""Contract tests against the installed, pinned upstream package; no backend starts."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, AsyncMock

temporary = tempfile.TemporaryDirectory(prefix="mobile-models-test-", dir=os.environ.get("TEST_SCRATCH"))
os.environ["DEEPTUTOR_HOME"] = temporary.name
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from deeptutor.multi_user.models import CurrentUser, UserScope
from deeptutor.multi_user.paths import user_context
from deeptutor.multi_user.model_access import apply_allowed_llm_selection, allowed_llm_options
from deeptutor.multi_user.personal_models import merge_personal_llm_profiles
from deeptutor.services.config.model_catalog import _default_catalog
from deeptutor.services.model_selection.runtime import resolve_llm_config_for_selection
from deeptutor.api.routers.auth import require_auth
import mobile_models as mm


def actor(name):
    return CurrentUser(id=name, username=name, role="user", scope=UserScope(kind="user", user_id=name, root=Path(temporary.name) / "data" / "users" / name))


app = FastAPI()
mm.install(app)


async def authentication(request: Request):
    from fastapi import HTTPException
    name = request.headers.get("x-test-user")
    if name not in {"alice", "bob"}:
        raise HTTPException(401)
    with user_context(actor(name)):
        yield


app.dependency_overrides[require_auth] = authentication
client = TestClient(app)


class PersonalModelsTest(unittest.TestCase):
    def test_unknown_upstream_version_is_rejected_without_installing_routes(self):
        target = FastAPI()
        original = len(target.routes)
        with patch('deeptutor.__version__.__version__', '1.7.99'):
            with self.assertRaises(RuntimeError):
                mm.install(target)
        self.assertEqual(len(target.routes), original)

    def setUp(self):
        for name in ("alice", "bob"):
            with user_context(actor(name)):
                mm.store().save(_default_catalog())
        self.validation = patch.object(mm, "validate_url")
        self.validation.start()
        self.addCleanup(self.validation.stop)

    def call(self, path="", method="get", user="alice", **kwargs):
        return getattr(client, method)("/api/mobile/models" + path, headers={"x-test-user": user}, **kwargs)

    def create(self, **overrides):
        payload = {"name": "Test provider", "binding": "custom", "base_url": "https://api.example.com/v1", "api_key": "fake-key-first", "models": ["test-a", "test-b"]}
        payload.update(overrides)
        result = self.call("/profile", "post", json=payload)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()["profiles"][0], result.json()

    def test_private_keys_and_model_access_are_isolated(self):
        profile, public = self.create()
        self.assertNotIn("fake-key", str(public))
        self.assertNotIn("api_key", profile)
        self.assertTrue(profile["has_key"])
        choice = {"profile_id": profile["id"], "model_id": profile["models"][0]["id"]}
        with user_context(actor("alice")):
            self.assertEqual(apply_allowed_llm_selection(choice), choice)
            self.assertIn(choice["profile_id"], str(allowed_llm_options()))
            merged = merge_personal_llm_profiles(_default_catalog())
            self.assertEqual(merged["services"]["llm"]["profiles"][0]["api_key"], "fake-key-first")
            self.assertIn("data/system/user-secrets", str(mm.store().path))
        with user_context(actor("bob")):
            self.assertEqual(mm.personal_profiles(), [])
            with self.assertRaises(PermissionError):
                apply_allowed_llm_selection(choice)
        self.assertEqual(self.call(user="bob").json()["profiles"], [])
        self.assertEqual(self.call("/profile/" + profile["id"], "delete", user="bob").status_code, 404)

    def test_replacement_applies_to_next_runtime_resolution_and_preserves_ids(self):
        profile, _ = self.create()
        choice = {"profile_id": profile["id"], "model_id": profile["models"][0]["id"]}
        with user_context(actor("alice")):
            self.assertEqual(resolve_llm_config_for_selection(choice).api_key, "fake-key-first")
        updated, _ = self.create(id=profile["id"], api_key="fake-key-second")
        self.assertEqual(updated["models"], profile["models"])
        with user_context(actor("alice")):
            self.assertEqual(resolve_llm_config_for_selection(choice).api_key, "fake-key-second")
        self.create(id=profile["id"], api_key="")
        with user_context(actor("alice")):
            self.assertEqual(mm.personal_profiles()[0]["api_key"], "fake-key-second")

    def test_change_origin_requires_fresh_key_and_mask_is_not_a_key(self):
        profile, _ = self.create()
        payload = {"id": profile["id"], "name": "Changed", "binding": "custom", "base_url": "https://different.example.com/v1", "models": ["test-a"]}
        self.assertEqual(self.call("/profile", "post", json=payload).status_code, 400)
        payload.update(base_url=profile["base_url"], api_key="***")
        self.assertEqual(self.call("/profile", "post", json=payload).status_code, 400)

    def test_discovery_reads_only_owner_key_and_redacts_upstream_response(self):
        profile, _ = self.create()
        payload = {k: profile[k] for k in ("id", "name", "binding", "base_url", "api_format")}
        with patch("deeptutor.services.settings.provider_probe.probe_provider", new=AsyncMock(return_value={"status": "connected", "models": [{"id": "discovered", "private": "not-returned"}], "secret": "not-returned"})) as probe:
            result = self.call("/discover", "post", json=payload)
            self.assertEqual(result.json(), {"status": "connected", "models": [{"id": "discovered"}]})
            self.assertEqual(probe.call_args.kwargs["api_key"], "fake-key-first")
            self.assertEqual(self.call("/discover", "post", user="bob", json=payload).status_code, 404)
            self.assertEqual(probe.call_count, 1)

    def test_defaults_and_deletions_do_not_leave_invalid_references(self):
        profile, _ = self.create()
        choice = {"profile_id": profile["id"], "model_id": profile["models"][1]["id"]}
        self.assertEqual(self.call("/default", "post", json=choice).status_code, 200)
        self.assertEqual(self.call("/options").json()["active"], choice)
        self.create(id=profile["id"], models=["test-a"])
        self.assertNotEqual(self.call("/options").json()["active"], choice)
        self.assertEqual(self.call("/profile/" + profile["id"], "delete").status_code, 200)
        self.assertNotIn(profile["id"], str(self.call("/options").json()))

    def test_unauthenticated_and_injected_catalog_fields_rejected(self):
        self.assertEqual(client.get("/api/mobile/models").status_code, 401)
        self.assertEqual(self.call("/profile", "post", json={"name": "x", "binding": "custom", "base_url": "https://api.example.com", "models": ["a"], "provider_ref": {"connection_id": "shared"}}).status_code, 422)

    def test_url_validation_blocks_local_and_embedded_credentials(self):
        self.validation.stop()
        for url in ["http://127.0.0.1/v1", "http://[::1]/v1", "https://user:pass@example.com", "https://example.com?api_key=test"]:
            with self.assertRaises(Exception):
                mm.validate_url(url)
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("10.0.0.1", 443))]):
            with self.assertRaises(Exception):
                mm.validate_url("https://internal.example.com")


if __name__ == "__main__":
    unittest.main()
