const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('完整定稿先更新灰字与上下文，再触发问题判断', () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const start = source.indexOf('window.assist.onText((p) => {');
  const end = source.indexOf('// ---- 答案层', start);
  let handler; const seen = [], saved = [];
  const scope = {
    window: { assist: { onText: cb => handler = cb } },
    statusOf: () => ({}), phone: { queue: [] },
    echoFilter: { interviewer() {}, partial() {} },
    conversationContext: { append: (id, text) => saved.push({ id, text }) },
    now: () => '12:00', appendConv() {}, recQueue: [],
    dropPartial() {}, partialEl: () => ({}),
    stripFinalPrefix: require('../renderer/qdetect.js').stripFinalPrefix,
    ivPartial: '旧的临时转写', qByContent: false,
    onInterviewerUtterance(text) { seen.push({ text, partial: scope.ivPartial, saved: saved.length }); },
    renderQState() {}, renderIvFloat() {},
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);
  handler({ id: 'interviewer', definite: ['你如何处理延期？'], partial: '你如何处理延期？' });
  assert.deepEqual(seen, [{ text: '你如何处理延期？', partial: '', saved: 1 }]);
});
