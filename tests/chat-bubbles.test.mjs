import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { chatLongPressScript } from '../src/lib/chat-long-press.ts';
import { readingBlocks } from '../src/lib/reading-content.ts';
import { questionOptions } from '../src/lib/chat-study.ts';

function moduleAt(path, deps) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => deps[name] || {}, setTimeout, clearTimeout, console });
  return module.exports;
}
const jsx = (type, props) => ({ type, props });
const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
const react = { useState: initial => [initial, () => {}], useRef: value => ({ current: value }) };
const native = Object.fromEntries(['View','Text','Pressable','Modal','ScrollView'].map(name => [name, name]));
const ui = { C: {}, s: {}, Button: 'Button', Field: 'Field' };

test('chat prose hides inline copy controls and forwards long presses; other modules keep selection', () => {
  let inChat = true;
  const calls = [];
  const { Prose } = moduleAt('../src/features/common.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native, '../ui': ui,
    '../lib/chat-bubble-context': { useChatBubble: () => inChat ? text => calls.push(text) : null },
    '../lib/math-markup': { hasMath: () => false }, '../lib/reading-content': { readingBlocks },
    '../lib/learning-display-context': { useLearningDisplay: () => ({ value: {} }) },
    '../lib/learning-display': { learningTextStyle: () => ({ fontSize: 18, lineHeight: 26 }) },
    '../components/TextCopyActions': { TextCopyActions: 'CopyActions' },
  });
  let nodes = flatten(Prose({ text: '一起算一算' }));
  assert.equal(nodes.some(n => n.type === 'CopyActions'), false);
  const text = nodes.find(n => n.type === 'Text'); assert.equal(text.props.selectable, false);
  text.props.onLongPress(); assert.deepEqual(calls, ['一起算一算']);
  inChat = false; nodes = flatten(Prose({ text: '阅读正文' }));
  assert.ok(nodes.some(n => n.type === 'CopyActions')); assert.equal(nodes.find(n => n.type === 'Text').props.selectable, true);
});

test('quiz cards inside bubbles contain question/options while answer controls are available in the bottom sheet', () => {
  let inChat = true;
  const { QuestionCard } = moduleAt('../src/features/content.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native, '../ui': ui,
    '../lib/chat-bubble-context': { useChatBubble: () => inChat ? () => {} : null },
    '../lib/auth': { useAuth: () => ({ api: null }) }, '../lib/chat-study': { questionOptions },
    './common': { Prose: 'Prose', Chips: 'Chips', SmallAction: 'SmallAction' },
  });
  const props = { question: { question: '3+4?', options: ['7','8'] }, onAnswer: async () => {}, showSave: false };
  let nodes = flatten(QuestionCard(props));
  assert.equal(nodes.some(n => ['Button', 'Field', 'SmallAction'].includes(n.type)), false);
  assert.equal(nodes.filter(n => n.type === 'Text').length, 2);
  inChat = false; nodes = flatten(QuestionCard(props));
  assert.ok(nodes.some(n => n.type === 'Field')); assert.ok(nodes.some(n => n.type === 'Button' && n.props.title === '提交答案'));
  assert.equal(nodes.some(n => n.type === 'SmallAction'), false);
});

test('long press menu provides copy/read-aloud and dismisses through backdrop, cancel and Android back', () => {
  let closed = 0;
  const { MessageActions } = moduleAt('../src/components/MessageActions.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native, '../ui': ui,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    './TextCopyActions': { TextCopyActions: 'CopyActions' }, '../features/read-aloud': { ReadAloud: 'ReadAloud' },
  });
  const nodes = flatten(MessageActions({ text: 'selected message', conversation: 'chat', onClose: () => closed++ }));
  assert.equal(nodes.find(n => n.type === 'CopyActions').props.text, 'selected message');
  assert.equal(nodes.find(n => n.type === 'ReadAloud').props.conversation, 'chat');
  nodes.find(n => n.type === 'Modal').props.onRequestClose();
  nodes.find(n => n.type === 'Pressable').props.onPress();
  nodes.find(n => n.type === 'Button').props.onPress(); assert.equal(closed, 3);
});

test('formula long press opens a menu only after a stationary hold; scrolling and cancellation do not', () => {
  const handlers = {}, timers = new Map(), sent = []; let next = 0;
  const document = { documentElement: { style: {} }, addEventListener: (name, cb) => { handlers[name] = cb; } };
  const window = { ReactNativeWebView: { postMessage: value => sent.push(value) }, addEventListener: (name, cb) => { handlers[name] = cb; } };
  vm.runInNewContext(chatLongPressScript, { document, window, setTimeout: (cb, ms) => { assert.equal(ms, 500); timers.set(++next, cb); return next; }, clearTimeout: id => timers.delete(id) });
  const fire = () => [...timers.values()].forEach(cb => cb());
  handlers.pointerdown({ clientX: 1, clientY: 1 }); handlers.pointermove({ clientX: 3, clientY: 3 }); fire();
  assert.deepEqual(sent, ['chat-long-press']);
  for (const cancel of ['pointerup','pointercancel','blur']) { handlers.pointerdown({ clientX: 1, clientY: 1 }); handlers[cancel]({}); fire(); }
  handlers.pointerdown({ clientX: 1, clientY: 1 }); handlers.pointermove({ clientX: 30, clientY: 1 }); fire();
  handlers.pointerdown({ isPrimary: false, clientX: 1, clientY: 1 }); fire(); assert.equal(sent.length, 1);
});

// Exercise the actual cache manager against a filesystem port. Bytes below
// are synthetic transport fixtures; no image decoding or visual inspection.
test('conversation file cleanup deletes only owned files and blocks late downloads', async () => {
  const paths = new Set(); let releaseCopy;
  class Directory {
    constructor(parent, name) { this.uri = parent.uri + '/' + name; }
    get exists() { return paths.has(this.uri); }
    create() { paths.add(this.uri); }
    delete() { for (const path of paths) if (path === this.uri || path.startsWith(this.uri + '/')) paths.delete(path); }
  }
  class File {
    constructor(parent, name) { this.uri = name ? parent.uri + '/' + name : parent; }
    write() { paths.add(this.uri); }
    async copy(target) { await new Promise(resolve => { releaseCopy = resolve; }); paths.add(target.uri); }
    delete() { paths.delete(this.uri); }
  }
  const cache = moduleAt('../src/lib/temporary-files.ts', { 'expo-file-system': { Directory, File, Paths: { cache: { uri: 'file:///cache' } } } });
  const api = { assertOpen() {}, onClose() {} }, other = { ...api };
  const a = cache.temporaryBytes(api, new ArrayBuffer(1), 'fixture', 'root');
  const b = cache.temporaryBytes(api, new ArrayBuffer(1), 'fixture', 'keep');
  const c = cache.temporaryBytes(other, new ArrayBuffer(1), 'fixture', 'root');
  const pending = cache.ownTemporaryFile(api, 'file:///cache/picker', 'pending', 'root');
  cache.clearConversationFiles(api, ['root']); releaseCopy(); await assert.rejects(pending, /已删除/);
  assert.equal(paths.has(a), false); assert.ok(paths.has(b)); assert.ok(paths.has(c));
  assert.throws(() => cache.temporaryBytes(api, new ArrayBuffer(1), 'late', 'root'), /已删除/);
  assert.equal([...paths].some(path => path.endsWith('/pending')), false);
});
