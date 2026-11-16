"""Delete real fixture SQL rows/files, retaining notebook IDs/photos/attempts.

Uses a disposable home, not a running backend or any learner's actual data.
"""
import asyncio
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch, AsyncMock
from urllib.parse import unquote, urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_upstream_contracts import app, client, session_identity, session_authentication, SessionDeleteContractsTest
from deeptutor.api.routers.auth import require_auth
from deeptutor.services.storage.attachment_store import get_attachment_store
from mobile_models import conversations as mobile
app.include_router(mobile.router)
app.dependency_overrides[require_auth] = session_authentication


class RetainedNotebookTest(SessionDeleteContractsTest):
    def setUp(self):
        super().setUp()
        with session_identity() as store:
            self.attachments = get_attachment_store()
            self.url = asyncio.run(self.attachments.put(session_id=self.parent, attachment_id="photo", filename="fixture.bin", data=b"fixture-not-a-real-photo"))
            asyncio.run(self.attachments.put(session_id=self.child, attachment_id="unused", filename="fixture.bin", data=b"chat-only"))
            asyncio.run(store.upsert_notebook_entries(self.parent, [{
                "question_id": "fixture-question", "question": "3 + 4 = ?", "user_answer": "8", "correct_answer": "7",
                "user_answer_images": [{"id": "photo", "url": self.url, "filename": "fixture.bin", "mime_type": "image/png"}],
                "is_correct": False, "result": "incorrect", "source": "deep_question",
            }]))
            self.entry = asyncio.run(store.find_notebook_entry_by_origin("conversation", self.parent, "fixture-question"))
            # Real FK rows verify retained categories and assessment history.
            with store._connect() as conn:
                conn.execute("INSERT INTO assessment_attempts (attempt_id, notebook_entry_id, session_id, origin_type, origin_ref, turn_id, question_id, source, assessment_type, result, occurred_at, assessment_json) VALUES (?, ?, ?, 'conversation', ?, '', 'fixture-question', 'deep_question', 'quiz', 'incorrect', 1, ?)", (self.parent, self.entry['id'], self.parent, self.parent, json.dumps({'images': [{'id': 'photo', 'url': self.url}]})))
                conn.commit()

    def delete(self):
        return client.delete(f"/api/mobile/conversations/{self.parent}", headers=self.headers)

    def test_permanent_tree_deletion_retains_notebook_and_independent_image(self):
        response = self.delete()
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json(); self.assertTrue(result['cleanup_complete'])
        self.assertEqual(set(result['deleted_session_ids']), {self.parent, self.child, self.grandchild})
        with session_identity() as store:
            with store._connect() as conn:
                for table, column in [('sessions', 'id'), ('messages', 'session_id'), ('turns', 'session_id')]:
                    for id in result['deleted_session_ids']:
                        self.assertIsNone(conn.execute(f'SELECT 1 FROM {table} WHERE {column} = ?', (id,)).fetchone())
                attempt = dict(conn.execute('SELECT * FROM assessment_attempts WHERE attempt_id = ?', (self.parent,)).fetchone())
                self.assertIsNone(attempt['session_id']); self.assertEqual(attempt['notebook_entry_id'], self.entry['id'])
                self.assertEqual(conn.execute('SELECT COUNT(*) FROM mobile_deletion_cleanup').fetchone()[0], 0)
            kept = asyncio.run(store.get_notebook_entry(self.entry['id']))
            self.assertEqual(kept['question'], self.entry['question']); self.assertFalse(kept['session_id'])
            url = kept['user_answer_images'][0]['url']; self.assertNotEqual(url, self.url)
            self.assertEqual(json.loads(attempt['assessment_json'])['images'][0]['url'], url)
            parts = [unquote(p) for p in urlsplit(url).path.split('/')[-3:]]
            path = get_attachment_store().resolve_path(session_id=parts[0], attachment_id=parts[1], filename=parts[2])
            self.assertEqual(path.read_bytes(), b'fixture-not-a-real-photo')
        for id in result['deleted_session_ids']:
            self.assertFalse((self.attachments.root / id).exists())
        self.assertTrue(self.exists(self.keep))

    def test_other_notebook_origin_referencing_a_deleted_chat_photo_remains_readable(self):
        with session_identity() as store:
            asyncio.run(store.upsert_notebook_entries(None, [{
                'origin_type': 'external_import', 'origin_ref': 'fixture-independent',
                'question_id': 'independent-photo', 'question': 'Preserve this imported question',
                'user_answer_images': [{'id': 'photo', 'url': self.url, 'filename': 'fixture.bin'}],
            }]))
        response = self.delete(); self.assertEqual(response.status_code, 200, response.text)
        with session_identity() as store:
            entry = asyncio.run(store.find_notebook_entry_by_origin('external_import', 'fixture-independent', 'independent-photo'))
            parts = [unquote(p) for p in urlsplit(entry['user_answer_images'][0]['url']).path.split('/')[-3:]]
            path = get_attachment_store().resolve_path(session_id=parts[0], attachment_id=parts[1], filename=parts[2])
            self.assertEqual(path.read_bytes(), b'fixture-not-a-real-photo')

    def test_recycle_bin_descendants_are_removed_from_the_real_store_too(self):
        with session_identity() as store:
            asyncio.run(store.soft_delete_session(self.child))
        response = self.delete(); self.assertEqual(response.status_code, 200, response.text)
        self.assertIn(self.child, response.json()['deleted_session_ids'])
        with session_identity() as store:
            with store._connect() as conn:
                self.assertIsNone(conn.execute('SELECT 1 FROM sessions WHERE id = ?', (self.child,)).fetchone())

    def test_image_copy_failure_keeps_the_chat_and_original_notebook_photo(self):
        with patch.object(self.attachments, 'put', new=AsyncMock(side_effect=OSError('fixture full disk'))):
            with TestClientNoRaise() as failed:
                response = failed.delete(f'/api/mobile/conversations/{self.parent}', headers=self.headers)
        self.assertEqual(response.status_code, 500)
        self.assertTrue(self.exists(self.parent)); self.assertTrue(self.exists(self.child))
        with session_identity() as store:
            self.assertEqual(asyncio.run(store.get_notebook_entry(self.entry['id']))['user_answer_images'][0]['url'], self.url)

    def test_cleanup_failure_is_explicit_and_retriable_without_deleting_notebook(self):
        with patch.object(mobile, 'purge_files', side_effect=OSError('fixture locked file')):
            response = self.delete()
        self.assertEqual(response.status_code, 200, response.text); self.assertFalse(response.json()['cleanup_complete'])
        self.assertFalse(self.exists(self.parent))
        retry = client.post('/api/mobile/conversations/cleanup', headers=self.headers, json={'session_ids': response.json()['deleted_session_ids']})
        self.assertEqual(retry.status_code, 200, retry.text); self.assertTrue(retry.json()['cleaned'])
        self.assertEqual(client.post('/api/mobile/conversations/cleanup', headers=self.headers, json={'session_ids': response.json()['deleted_session_ids']}).status_code, 200)

    def test_cleanup_rejects_existing_chat_path_traversal_and_arbitrary_notebook_directory(self):
        with session_identity():
            owner = 'question-notebook-fixture-protected'
            asyncio.run(get_attachment_store().put(session_id=owner, attachment_id='photo', filename='fixture.bin', data=b'keep'))
        for id, expected in [(self.parent, 409), ('../escape', 422), (owner, 403)]:
            response = client.post('/api/mobile/conversations/cleanup', headers=self.headers, json={'session_ids': [id]})
            self.assertEqual(response.status_code, expected, response.text)
        self.assertTrue((self.attachments.root / owner).exists()); self.assertTrue(self.exists(self.parent))

    def test_new_delete_route_respects_identity_workspace_and_turn_stop(self):
        for headers in [{}, {'x-test-user': 'bob'}, {'x-test-user': 'alice', 'X-DeepTutor-Workspace': 'other'}]:
            response = client.delete(f'/api/mobile/conversations/{self.parent}', headers=headers)
            self.assertEqual(response.status_code, 401 if not headers else 404)
        with patch.object(mobile.sessions, '_turn_application_service', return_value=SimpleNamespace(cancel_turn_and_wait=AsyncMock(return_value=False))), patch.object(self.store, 'list_active_turns', new=AsyncMock(return_value=[{'id': 'busy'}])):
            self.assertEqual(self.delete().status_code, 409)
        self.assertTrue(self.exists(self.parent))


def TestClientNoRaise():
    from fastapi.testclient import TestClient
    return TestClient(app, raise_server_exceptions=False)


if __name__ == '__main__':
    unittest.main()
