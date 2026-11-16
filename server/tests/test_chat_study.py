"""Shipped TypeScript judge/upsert payloads against official pinned routers."""
import asyncio
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch, AsyncMock
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
const q = { key:'quiz:fixture:q', turnId:'fixture-turn', messageId:'2', mastery:false, interactionId:'', data:{question_id:'fixture-q',question:'3 + 4 = ?',correct_answer:'7',options:{A:'7',B:'8'}} };
let judge, upsert;
const socket = {onopen:null,onmessage:null,onerror:null,onclose:null,send(text){judge=JSON.parse(text)},close(){}};
const result = judgeQuizAnswer({assertOpen(){},socketOptions(){return {url:'ws://fixture/ws',headers:{}}},onClose(){return ()=>{}}},q,'8',()=>socket,new AbortController().signal);
socket.onopen();socket.onmessage({data:JSON.stringify({type:'text',content:'❌ 不正确：3+4=7'})});socket.onmessage({data:JSON.stringify({type:'done'})});
await result;
await saveJudgedMistake({assertOpen(){},async json(path,body){upsert=body;return {...body,id:1}}},'study-fixture',q,'8','❌ 不正确：3+4=7','incorrect');
process.stdout.write(JSON.stringify({judge,upsert}));
"""
    return json.loads(subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', script], cwd=Path(__file__).resolve().parents[2], check=True, capture_output=True, text=True).stdout)


class ChatStudyContractsTest(unittest.TestCase):
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
