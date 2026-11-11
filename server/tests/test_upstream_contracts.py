"""Real upstream routers and registry merge; synthetic data, no paid providers/server."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

temporary = tempfile.TemporaryDirectory(prefix="upstream-contract-", dir=os.environ.get("TEST_SCRATCH"))
os.environ["DEEPTUTOR_HOME"] = temporary.name

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from deeptutor.api.routers import voice
from deeptutor.api.routers.settings import RegistryEditPayload
from deeptutor.services.settings.registry_edit import merge_registry_edit


def require_test_identity(request: Request):
    if request.headers.get("authorization") != "Bearer fixture-token":
        raise HTTPException(401)


app = FastAPI()
app.include_router(voice.router, prefix="/api/voice", dependencies=[Depends(require_test_identity)])
client = TestClient(app)
headers = {"Authorization": "Bearer fixture-token"}


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
