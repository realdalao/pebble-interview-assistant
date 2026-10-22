const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConversationContext } = require('../renderer/context.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('双方定稿保留说话人，AI 建议不进入记忆', () => {
  const c = createConversationContext();
  c.append('interviewer', '具体怎么调整？'); c.append('me', '先做布线。'); c.append('answer', '未说出口的建议');
  assert.ok(c.text().includes('面试官：具体怎么调整？\n我：先做布线。'));
  assert.ok(!c.text().includes('未说出口'));
});
test('长对话逐批合并早期摘要，近期原文保留', async () => {
  const calls = [];
  const c = createConversationContext(40, 2, async payload => {
    calls.push(payload);
    return { ok: true, summary: payload.summary + payload.text + '\n' };
  });
  c.append('me', '开场项目预算是十万元');
  c.append('interviewer', '团队有五个人');
  c.append('me', '我负责统筹');
  await tick();
  c.append('interviewer', '怎样处理延期？');
  await tick();
  assert.ok(calls.length >= 2);
  assert.ok(calls[1].summary.includes('十万元'));
  assert.ok(c.text().includes('十万元'));
  assert.ok(c.text().includes('我：我负责统筹\n面试官：怎样处理延期？'));
});
test('摘要失败不丢原文，后续追加重试', async () => {
  let attempt = 0;
  const c = createConversationContext(40, 1, async () => ++attempt === 1 ? { ok: false } : { ok: true, summary: '我：早期事实' });
  c.append('me', '早期事实'); c.append('me', '最近事实');
  await tick(); assert.ok(c.text().includes('我：早期事实'));
  c.append('me', '下一句'); await tick();
  assert.ok(attempt >= 2); assert.ok(c.text().includes('累计摘要'));
});
test('切场后旧摘要返回不能污染新场', async () => {
  let finish;
  const c = createConversationContext(40, 1, () => new Promise(resolve => { finish = resolve; }));
  c.append('me', '上一场'); c.append('me', '上一场后续');
  c.clear(); c.append('me', '新场');
  finish({ ok: true, summary: '旧场摘要' }); await tick();
  assert.ok(!c.text().includes('旧场')); assert.ok(!c.text().includes('上一场'));
  assert.ok(c.text().includes('我：新场'));
});
test('超长单条定稿不截掉开头', () => {
  const c = createConversationContext(20, 2);
  c.append('me', '开场重要事实' + '后续内容'.repeat(20));
  assert.ok(c.text().includes('开场重要事实'));
});

test('摘要不是事实证据，原始发言跨压缩保留，切场清除', async () => {
  const c = createConversationContext(40, 1, async () => ({ok: true, summary: '错误摘要：央视频做了十集'}));
  c.append('me', '百晓生做了十集'); c.append('me', '央视频只负责一条'); await tick();
  assert.equal(c.evidence(), '我：百晓生做了十集\n我：央视频只负责一条');
  assert.ok(!c.evidence().includes('错误摘要'));
  c.clear(); assert.equal(c.evidence(), '');
});
