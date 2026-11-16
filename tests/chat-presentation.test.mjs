import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { compactConversationTitle, conversationTitle } from "../src/lib/conversation.ts";

// Run the real component and its callbacks with a minimal native host. This
// checks interaction logic, not device layout, keyboard animation or gestures.
function host(overrides = {}) {
  const slots = [], effects = [], calls = [];
  let cursor = 0, nodes = [], back;
  const input = { focus: () => calls.push("focus"), blur: () => calls.push("blur") };
  const props = {
    text: "", editable: true, sendDisabled: false, toolsDisabled: false,
    keyboardVisible: false, modelLabel: "合成测试模型",
    tools: ["相册", "拍照", "文件", "切换模型", "学习方式"].map((title, index) => ({
      key: String(index), title, icon: "add-outline", onPress: () => calls.push(title),
    })),
    onChangeText(value) { props.text = value; calls.push("edited"); },
    onSend() { calls.push("send"); },
    ...overrides,
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      useRef() { const i = cursor++; return slots[i] ??= { current: input }; },
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
      },
      useEffect(effect, deps) {
        const i = cursor++, previous = effects[i];
        if (previous && deps.every((d, j) => Object.is(d, previous.deps[j]))) return;
        previous?.cleanup?.();
        effects[i] = { deps, cleanup: effect() };
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ScrollView: "ScrollView",
      StyleSheet: { create: value => value }, Keyboard: { dismiss: () => calls.push("dismiss") },
      BackHandler: { addEventListener(name, callback) {
        assert.equal(name, "hardwareBackPress"); back = callback;
        return { remove() { if (back === callback) back = undefined; } };
      } },
    },
    "../ui": { C: {}, s: {}, Icon: "Icon" },
  };
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/components/ChatComposer.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  function flatten(value) {
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (value && typeof value === "object") return [value, ...flatten(value.props?.children)];
    return typeof value === "string" ? [value] : [];
  }
  const ui = {
    props, calls,
    render(changes = {}) {
      Object.assign(props, changes); cursor = 0;
      nodes = flatten(module.exports.ChatComposer(props)); return ui;
    },
    button(label) { return nodes.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label); },
    field() { return nodes.find(n => n.type === "TextInput").props; },
    tap(label) {
      const button = ui.button(label);
      assert.ok(button, `Missing button ${label}`);
      if (!button.props.disabled) button.props.onPress();
      return ui.render();
    },
    text() { return nodes.filter(n => typeof n === "string").join(""); },
    back() { const consumed = back?.(); ui.render(); return consumed; },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
  return ui.render();
}

test("chat starts with only the input and more button; tools and model details appear on demand", () => {
  const ui = host();
  assert.ok(ui.button("更多功能")); assert.equal(ui.button("发送问题"), undefined);
  for (const tool of ui.props.tools) assert.equal(ui.button(tool.title), undefined);
  assert.equal(ui.text().includes(ui.props.modelLabel), false);
  ui.tap("更多功能");
  for (const tool of ui.props.tools) assert.ok(ui.button(tool.title));
  assert.ok(ui.text().includes(ui.props.modelLabel));
  assert.equal(ui.button("收起更多功能").props.accessibilityState.expanded, true);
  assert.deepEqual(ui.calls, ["blur", "dismiss"]);
  ui.unmount();
});

test("keyboard and tool panel alternate without losing a typed draft", () => {
  const ui = host({ text: "还没写完的题目", keyboardVisible: true });
  ui.tap("更多功能");
  assert.equal(ui.button("相册"), undefined, "wait for the keyboard to close before showing the grid");
  ui.render({ keyboardVisible: false }); assert.ok(ui.button("相册"));
  ui.field().onFocus(); ui.render({ keyboardVisible: true });
  assert.equal(ui.button("相册"), undefined); assert.equal(ui.field().value, "还没写完的题目");
  ui.field().onChangeText("还没写完的题目：3 + 4"); ui.render();
  ui.tap("更多功能").render({ keyboardVisible: false });
  ui.tap("收起更多功能"); assert.equal(ui.calls.at(-1), "focus");
  assert.equal(ui.field().value, "还没写完的题目：3 + 4");
  assert.equal(ui.calls.filter(call => call === "edited").length, 1);
  ui.unmount();
});

test("all five tools keep their callbacks and dismiss the panel without sending or clearing the draft", () => {
  const ui = host({ text: "请解释这道题" });
  for (const tool of ui.props.tools) {
    ui.tap("更多功能").tap(tool.title);
    assert.equal(ui.calls.filter(call => call === tool.title).length, 1);
    assert.equal(ui.button(tool.title), undefined);
    assert.equal(ui.field().value, "请解释这道题");
  }
  assert.equal(ui.calls.includes("send"), false);
  ui.unmount();
});

test("Android back closes the open tools first and releases its listener afterwards", () => {
  const ui = host();
  assert.equal(ui.back(), undefined);
  ui.tap("更多功能"); assert.equal(ui.back(), true);
  assert.equal(ui.button("相册"), undefined); assert.equal(ui.back(), undefined);
  ui.tap("更多功能"); ui.unmount(); assert.equal(ui.back(), undefined);
});

test("send becomes available with text, respects disabled states and closes tools", () => {
  const ui = host({ text: " \n  " });
  assert.equal(ui.button("发送问题"), undefined);
  ui.render({ text: "请讲一讲", sendDisabled: true });
  ui.button("发送问题").props.onPress(); assert.equal(ui.calls.includes("send"), false);
  ui.render({ sendDisabled: false }).tap("更多功能").tap("发送问题");
  assert.equal(ui.calls.filter(call => call === "send").length, 1);
  assert.equal(ui.button("相册"), undefined);
  ui.unmount();
});

test("loading, generating, deleting or picking can disable tools without erasing input", () => {
  const ui = host({ text: "保留草稿", editable: false, toolsDisabled: true });
  assert.equal(ui.field().editable, false);
  ui.button("更多功能").props.onPress(); ui.render();
  assert.equal(ui.button("相册"), undefined); assert.deepEqual(ui.calls, []);
  ui.render({ toolsDisabled: false, editable: true }).tap("更多功能");
  ui.render({ toolsDisabled: true });
  assert.equal(ui.button("相册"), undefined); assert.equal(ui.back(), undefined);
  assert.equal(ui.field().value, "保留草稿");
  ui.unmount();
});

test("conversation labels are short without changing original titles, numbers or short names", () => {
  const title = "四年级数学第12课：三位数乘两位数的解题步骤和课后练习";
  assert.equal(compactConversationTitle(title), "四年级数学第12课：三位数乘两…");
  assert.equal(Array.from(compactConversationTitle(title, 12)).length, 12);
  assert.equal(conversationTitle(title), title, "editing and storage still receive the original title");
  assert.equal(compactConversationTitle("第12题：3×24"), "第12题：3×24");
  assert.equal(compactConversationTitle("  分数\n\t练习  "), "分数 练习");
  for (const placeholder of ["", "  ", "New conversation", "New chat", "New reading conversation"]) {
    assert.equal(compactConversationTitle(placeholder), "学习对话");
  }
  assert.equal(compactConversationTitle("🧮".repeat(20)), "🧮".repeat(15) + "…");
});


test("answer and notebook tools are on demand and independently disabled", () => {
  const calls = [];
  const tools = [
    { key: 'answer', title: '提交答案', icon: 'add-outline', disabled: true, onPress: () => calls.push('answer') },
    { key: 'mistake', title: '收进错题本', icon: 'add-outline', onPress: () => calls.push('mistake') },
  ];
  const ui = host({ tools });
  assert.equal(ui.button('提交答案'), undefined);
  ui.tap('更多功能');
  assert.equal(ui.button('提交答案').props.disabled, true);
  ui.button('提交答案').props.onPress(); assert.deepEqual(calls, []);
  ui.tap('收进错题本'); assert.deepEqual(calls, ['mistake']);
  assert.equal(ui.button('收进错题本'), undefined);
  ui.unmount();
});
