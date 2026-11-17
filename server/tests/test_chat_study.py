"""Shipped TypeScript judge/upsert payloads against official pinned routers."""
import asyncio
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch, AsyncMock
from urllib.parse import unquote, urlsplit
from fastapi import Depends
from test_upstream_contracts import app, client, session_identity, session_authentication, temporary
settings = Path(temporary.name) / "data/user/settings"
settings.mkdir(parents=True, exist_ok=True)
(settings / "main.yaml").write_text("system:\n  language: zh\n")
from deeptutor.api.routers import quiz_judge, question_notebook, auth

app.include_router(quiz_judge.router, prefix='/ws')
app.include_router(question_notebook.router, prefix='/api/question-notebook', dependencies=[Depends(session_authentication)])


def shipped_payloads():
    script = """
import { judgeQuizAnswer } from './src/lib/quiz-judge.ts';
import { saveJudgedMistake } from './src/lib/chat-study.ts';
import { recognitionCommand } from './src/lib/question-recognition.ts';
import { questionEntryPayload } from './src/lib/question-entry.ts';
const q = { key:'quiz:fixture:q', turnId:'fixture-turn', messageId:'2', mastery:false, interactionId:'', data:{question_id:'fixture-q',question:'3 + 4 = ?',correct_answer:'7',options:{A:'7',B:'8'}} };
let judge, upsert;
const socket = {onopen:null,onmessage:null,onerror:null,onclose:null,send(text){judge=JSON.parse(text)},close(){}};
const result = judgeQuizAnswer({assertOpen(){},socketOptions(){return {url:'ws://fixture/ws',headers:{}}},onClose(){return ()=>{}}},q,'8',()=>socket,new AbortController().signal);
socket.onopen();socket.onmessage({data:JSON.stringify({type:'text',content:'❌ 不正确：3+4=7'})});socket.onmessage({data:JSON.stringify({type:'done'})});
await result;
await saveJudgedMistake({assertOpen(){},async json(path,body){upsert=body;return {...body,id:1}}},'study-fixture',q,'8','❌ 不正确：3+4=7','incorrect');
const photo = {id:'fixture-photo',type:'image',base64:Buffer.from('synthetic attachment bytes').toString('base64'),filename:'question.jpg',mime_type:'image/jpeg'};
const recognition = recognitionCommand(photo, {profile_id:'fixture-profile',model_id:'fixture-model'}, 'math', 'fixture-submission');
const photoEntry = questionEntryPayload({id:'fixture-photo-question',question:'3 × 4 = ?',user_answer:'10',correct_answer:'',explanation:'',options:{},session_id:'recognition-fixture',turn_id:'recognition-turn'}, [photo]);
process.stdout.write(JSON.stringify({judge,upsert,recognition,photoEntry}));
"""
    return json.loads(subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', script], cwd=Path(__file__).resolve().parents[2], check=True, capture_output=True, text=True).stdout)


class ChatStudyContractsTest(unittest.TestCase):
    def test_photo_recognition_command_and_confirmed_entry_use_official_contracts(self):
        from deeptutor.api.contracts.turn_protocol import StartTurnCommand
        from deeptutor.api.routers import attachments
        payloads = shipped_payloads()
        command = StartTurnCommand.model_validate(payloads['recognition'])
        self.assertEqual(command.llm_selection.profile_id, 'fixture-profile')
        self.assertEqual(command.attachments[0].type, 'image')
        self.assertEqual(command.workspace_id, 'math')
        headers = {'x-test-user': 'alice', 'X-DeepTutor-Workspace': 'math'}
        with session_identity() as store:
            asyncio.run(store.create_session(title='Synthetic recognition', session_id='recognition-fixture'))
        payload = payloads['photoEntry']
        saved = client.post('/api/question-notebook/entries/upsert', headers=headers, json=payload)
        self.assertEqual(saved.status_code, 200, saved.text)
        again = client.post('/api/question-notebook/entries/upsert', headers=headers, json=payload)
        self.assertEqual(again.json()['id'], saved.json()['id'])
        path = f"/api/question-notebook/entries/{saved.json()['id']}"
        reread = client.get(path, headers=headers).json()
        self.assertEqual(reread['question'], '3 × 4 = ?')
        self.assertEqual(reread['user_answer'], '10')
        self.assertEqual(reread['correct_answer'], '')
        self.assertEqual(len(reread['user_answer_images']), 1)
        self.assertEqual(client.get(path, headers={'x-test-user':'bob'}).status_code, 404)
        self.assertEqual(client.get(path, headers={**headers, 'X-DeepTutor-Workspace':'chinese'}).status_code, 404)
        image = reread['user_answer_images'][0]
        parts = [unquote(p) for p in urlsplit(image['url']).path.split('/')[-3:]]
        with session_identity():
            served = asyncio.run(attachments.get_attachment(*parts))
            self.assertEqual(Path(served.path).read_bytes(), b'synthetic attachment bytes')

    def test_official_judge_stream_and_client_payload(self):
        payload = shipped_payloads()['judge']
        prompts = []
        async def stream(**kwargs):
            prompts.append(kwargs)
            yield '❌ 不正确：'; yield '3 + 4 = 7。'
        with patch.object(auth, 'ws_require_auth', new=AsyncMock(return_value=None)), patch.object(quiz_judge, 'llm_stream', new=stream):
            with client.websocket_connect('/ws/questions/judge') as ws:
                ws.send_json(payload)
                events = [ws.receive_json() for _ in range(4)]
        self.assertEqual([v['type'] for v in events], ['started', 'text', 'text', 'done'])
        self.assertIn('3 + 4 = ?', prompts[0]['prompt']); self.assertIn('8', prompts[0]['prompt'])
        self.assertIn('❌ 不正确', prompts[0]['system_prompt'])

    def test_upsert_payload_is_deduplicated_by_real_notebook_storage(self):
        payload = shipped_payloads()['upsert']
        with session_identity() as store:
            asyncio.run(store.create_session(title='Synthetic study', session_id='study-fixture'))
        headers = {'x-test-user': 'alice', 'X-DeepTutor-Workspace': 'math'}
        first = client.post('/api/question-notebook/entries/upsert', headers=headers, json=payload)
        self.assertEqual(first.status_code, 200, first.text)
        second = client.post('/api/question-notebook/entries/upsert', headers=headers, json=payload)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()['id'], second.json()['id']); self.assertFalse(second.json()['is_correct'])
        self.assertEqual(second.json()['user_answer'], '8'); self.assertEqual(second.json()['origin_ref'], 'study-fixture')
        lookup = client.get('/api/question-notebook/entries/lookup/by-question?session_id=study-fixture&question_id=fixture-q&turn_id=fixture-turn', headers=headers)
        self.assertEqual(lookup.status_code, 200, lookup.text)
        self.assertEqual(lookup.json()['id'], first.json()['id'])
        self.assertEqual(client.get('/api/question-notebook/entries/lookup/by-question?session_id=study-fixture&question_id=fixture-q&turn_id=fixture-turn', headers={'x-test-user': 'bob'}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
