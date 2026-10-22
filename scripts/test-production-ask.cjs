const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../main.cjs'), 'utf8');
const start = source.indexOf("ipcMain.handle('llm:ask'");
const end = source.indexOf('// 中断当前这次生成', start);
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(generate) {
  const messages = [], records = [], abortors = new Map();
  let handler;
  const scope = { ipcMain: { handle: (name, fn) => { handler = fn; } }, BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false, webContents: { send: (name, event) => messages.push(event) } }) },
    ark: { key: 'TEST_ONLY_SECRET', model: 'test-model', profile: 'old-profile', jd: 'old-jd' }, abortors,
    AbortController, DOMException, setTimeout, clearTimeout, Date,
    recorder: { diagnosticWriter: meta => event => records.push({ ...meta, ...event }) },
    generateReferenceAnswer: generate,
    arkStream: async (messages, onDelta, signal, config) => onDelta(config.profile),
  };
  vm.createContext(scope); vm.runInContext(source.slice(start, end), scope);
  return { scope, handler, messages, records, abortors };
}
test('主进程冻结请求档案，诊断不含凭据', async () => {
  let finish, options;
  const fixture = setup(opts => { options = opts; return new Promise(resolve => { finish = resolve; }); });
  fixture.handler({ sender: {} }, { askId: 1, question: '问题', facts: '我：原文', context: '摘要', len: 'short', trigger: 'manual' });
  fixture.scope.ark.profile = 'changed-profile';
  assert.equal(options.profile, 'old-profile');
  assert.equal(await options.complete([], new AbortController().signal), 'old-profile');
  assert.equal(fixture.messages.length, 0);
  finish('verified-answer'); await tick();
  assert.equal(fixture.messages[0].delta, 'verified-answer');
  assert.equal(fixture.messages[1].done, true);
  assert.ok(!JSON.stringify(fixture.records).includes('TEST_ONLY_SECRET'));
  assert.equal(fixture.abortors.size, 0);
});
test('模型请求失败明确显示错误', async () => {
  const fixture = setup(async () => { throw new Error('模型连接失败'); });
  fixture.handler({ sender: {} }, { askId: 2, question: '问题' }); await tick();
  assert.equal(fixture.messages[0].error, '模型连接失败');
  assert.ok(!fixture.messages.some(event => event.delta));
  assert.equal(fixture.abortors.size, 0);
});
test('被替换/取消的请求不能在晚到时发布答案', async () => {
  let finish;
  const fixture = setup(() => new Promise(resolve => { finish = resolve; }));
  fixture.handler({ sender: {} }, { askId: 3, question: '旧题' });
  fixture.abortors.get(3).abort(); finish('late-answer'); await tick();
  assert.ok(!fixture.messages.some(event => event.delta));
  assert.equal(fixture.abortors.size, 0);
});
test('主进程流式输出后完成时不重复整段', async () => {
  const fixture = setup(async options => {
    options.onDelta('大纲：\n'); options.onDelta('逐字稿：\n参考答案');
    return '大纲：\n逐字稿：\n参考答案';
  });
  fixture.handler({ sender: {} }, { askId: 4, question: '案例' }); await tick();
  assert.equal(fixture.messages.filter(e=>e.delta).map(e=>e.delta).join(''),'大纲：\n逐字稿：\n参考答案');
  assert.equal(fixture.messages.filter(e=>e.done).length,1);
});
