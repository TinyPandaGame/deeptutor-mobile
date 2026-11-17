import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { saveQuestionEntry } from '../src/lib/question-entry.ts';

// Exercise the shipped form callbacks with native controls and the provider
// replaced. This does not assert camera permissions, gestures or visual layout.
function host({ initial, picked, result, recognize, pickError } = {}) {
  const slots = [], effects = [], writes = [], navigations = [], picks = [], copies = [], alerts = [];
  let cursor = 0, nodes = [];
  const image = picked || { uri: 'file:///synthetic.jpg', base64: 'synthetic-photo', filename: 'question.jpg' };
  const recognized = result || { question: '3 × 4 = ?', user_answer: '10', uncertainties: ['最后一个字不清楚'], session_id: 'recognition-session', turn_id: 'recognition-turn' };
  const api = { isClosed: false, assertOpen() { if (api.isClosed) throw Error('retired'); }, async json(path, body) {
    writes.push({ path, body }); return { ...body, id: 7, user_answer_images: (body.user_answer_images || []).map(photo => ({ id: photo.id, url: '/files/attachments/q/' + photo.id + '/question.jpg' })) }; }
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useEffect(effect, deps) { const i = cursor++, prev = effects[i]; if (prev && deps.every((d,j) => Object.is(d, prev.deps[j]))) return; prev?.cleanup?.(); effects[i] = { deps, cleanup: effect() }; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable', Alert: { alert: (...args) => alerts.push(args) } },
    'expo-router': { router: { replace: v => navigations.push(v), push: v => navigations.push(v) }, useLocalSearchParams: () => ({ id: 'new' }) },
    '../../components/PrivateImage': { PrivateImage: 'PrivateImage' },
    '../../components/QuestionImage': { QuestionImage: 'QuestionImage' },
    '../../lib/auth': { useAuth: () => ({ api }) },
    '../../lib/drafts': { questionDraft: { take: () => initial } },
    '../../lib/pick-photo': { pickQuestionPhoto: async (_, camera) => { picks.push(camera); if (pickError) throw Error(pickError); return picked === null ? undefined : image; } },
    '../../lib/question-recognition': { recognizeQuestion: recognize || (async (_, __, ___, ____, _____, onSession) => { onSession(recognized.session_id); return recognized; }) },
    '../../features/model-picker': { ModelPicker: 'ModelPicker' },
    '../../lib/resources': {}, '../../features/common': {}, '../../lib/learning-records': {},
    '../../lib/question-images': { copyQuestionImages: async (_, images, id) => { copies.push(images); return images.map((v, i) => ({ ...v, id: `${id}_photo_${i}` })); } },
    '../../lib/question-entry': { saveQuestionEntry },
    '../../ui': Object.fromEntries(['Button','Failure','Field','Heading','Icon','Loading','Page','Section'].map(v => [v, v]).concat([['C', {}], ['s', {}]])),
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/app/question/[id].tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, WebSocket: class {}, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name];
  } });
  const flatten = v => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === 'object' ? [v, ...flatten(v.props?.children)] : typeof v === 'string' ? [v] : [];
  const ui = {
    api, writes, navigations, picks, copies, alerts,
    render() { cursor = 0; const root = module.exports.default(); nodes = flatten(root.type(root.props)); return ui; },
    button(title) { return nodes.find(v => v.type === 'Button' && v.props.title === title)?.props; },
    field(label) { return nodes.find(v => v.type === 'Field' && v.props.label === label)?.props; },
    tap(title) { const button = ui.button(title); assert.ok(button, `Missing ${title}`); if (!button.disabled && !button.busy) button.onPress(); return ui.render(); },
    edit(label, value) { const field = ui.field(label); if (field.editable !== false) field.onChangeText(value); return ui.render(); },
    text() { return nodes.filter(v => typeof v === 'string').join(' '); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); return ui.render(); },
    unmount() { effects.forEach(v => v?.cleanup?.()); },
  };
  return ui.render();
}

test('camera and album fill the actual form, keep the original photo, and only save after confirmation', async () => {
  for (const entry of ['拍照提取题目', '从相册选题目']) {
    const ui = host(); ui.tap(entry); await ui.flush();
    assert.equal(ui.field('题目').value, '3 × 4 = ?'); assert.equal(ui.field('我的作答').value, '10');
    assert.equal(ui.field('正确答案').value, ''); assert.ok(ui.text().includes('最后一个字不清楚'));
    assert.equal(ui.writes.length, 0); assert.deepEqual(ui.picks, [entry === '拍照提取题目']);
    ui.edit('题目', '校对后的题干').tap('保存到我的错题本'); await ui.flush();
    assert.equal(ui.writes.length, 1); assert.equal(ui.writes[0].body.question, '校对后的题干');
    assert.equal(ui.writes[0].body.user_answer_images[0].base64, 'synthetic-photo');
    assert.equal(ui.writes[0].body.session_id, 'recognition-session');
    assert.deepEqual(ui.navigations, ['/(tabs)/mistakes']); ui.unmount();
  }
});

test('recognition cannot overwrite a typed question without an explicit choice', async () => {
  const ui = host(); ui.edit('题目','已有题目').edit('我的作答','已有答案').edit('正确答案','旧标准答案');
  ui.tap('拍照提取题目'); await ui.flush();
  assert.equal(ui.field('题目').value, '已有题目'); assert.equal(ui.writes.length, 0);
  assert.equal(ui.button('保存到我的错题本').disabled, true);
  ui.tap('取消这张照片，保留原内容');
  assert.equal(ui.field('题目').value, '已有题目'); assert.equal(ui.field('正确答案').value, '旧标准答案');
  ui.tap('从相册选题目'); await ui.flush(); ui.tap('使用这道题和原图');
  assert.equal(ui.field('题目').value, '3 × 4 = ?'); assert.equal(ui.field('正确答案').value, '');
  ui.unmount();
});

test('failed or unreadable recognition retains the photo and supports manual correction or retry', async () => {
  let attempt = 0;
  const ui = host({ recognize: async () => { attempt++; if (attempt === 1) throw Error('识别连接中断'); return {question:'重试结果',user_answer:'',uncertainties:[],session_id:'s',turn_id:'t'}; } });
  ui.tap('拍照提取题目'); await ui.flush(); assert.ok(ui.text().includes('识别连接中断'));
  assert.equal(ui.writes.length, 0); ui.tap('重新识别这张照片'); await ui.flush();
  assert.equal(ui.field('题目').value, '重试结果'); ui.unmount();
  const empty = host({ result: { question:'',user_answer:'',uncertainties:['多道题请裁剪'],session_id:'s',turn_id:'t' } });
  empty.tap('从相册选题目'); await empty.flush(); assert.equal(empty.field('题目').value,'');
  empty.tap('保留这张照片，手动校对').edit('题目','手动校对的题目').tap('保存到我的错题本'); await empty.flush();
  assert.equal(empty.writes[0].body.user_answer_images.length, 1); assert.equal(empty.writes[0].body.origin_type, 'external_import'); empty.unmount();
});

test('cancelled picker, denied permission, repeated taps and late results after leaving cannot write', async () => {
  for (const options of [{ picked: null }, { pickError: '相机权限未允许' }]) {
    const ui = host(options); ui.edit('题目','已有内容').tap('拍照提取题目'); await ui.flush();
    assert.equal(ui.field('题目').value,'已有内容'); assert.equal(ui.writes.length,0); ui.unmount();
  }
  let complete, signal;
  const ui = host({ recognize: (_, __, ___, ____, value) => { signal = value; return new Promise(resolve => { complete = resolve; }); } });
  ui.tap('拍照提取题目').tap('拍照提取题目'); await ui.flush();
  assert.equal(ui.picks.length, 1); assert.equal(ui.field('题目').editable,false);
  ui.tap('停止识别'); assert.equal(signal.aborted,true); ui.unmount();
  complete({question:'迟到结果',user_answer:'',uncertainties:[],session_id:'s',turn_id:'t'}); await ui.flush();
  assert.equal(ui.writes.length,0); assert.equal(ui.field('题目').value,'');
});
