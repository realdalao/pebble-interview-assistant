// echoguard.js 单测：node --test test-echoguard 风格，与 test-qdetect 同款
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normKey, bigramSim, isEcho } = require('../renderer/echoguard.js');

test('normKey 去掉标点空白', () => {
  assert.equal(normKey('你好，世界！ Hello, world. '), '你好世界Helloworld');
  assert.equal(normKey(null), '');
});

test('bigramSim：同文 1、无关近 0', () => {
  assert.equal(bigramSim('我们团队做短视频内容', '我们团队做短视频内容'), 1);
  assert.ok(bigramSim('我们团队做短视频内容', '今天天气非常不错适合出门') < 0.15);
});

test('逐字重复的外放回声 → 丢弃', () => {
  const iv = ['我们这个岗位需要经常和运营团队协作，你觉得怎么样？'];
  assert.equal(isEcho('我们这个岗位需要经常和运营团队协作，你觉得怎么样？', iv, ''), true);
  assert.equal(isEcho('我们这个岗位需要经常和运营团队协作。你觉得怎么样？', iv, ''), true); // 标点差异
});

test('轻微识别差异的回声 → 相似度命中', () => {
  const iv = ['我们这个岗位需要经常和运营团队协作，你觉得怎么样？'];
  // 同一段声音两次 ASR，个别字不同
  assert.equal(isEcho('我们这个岗位需要经常和运营团队协作你觉得怎么样', iv, ''), true);
});

test('未定稿里的回声也能命中', () => {
  assert.equal(isEcho('你们团队现在有多少人', ['无关的上一句'], '你们团队现在有多少人，方便说下吗'), true);
});

test('我真实说的话 → 不丢', () => {
  const iv = ['我们这个岗位需要经常和运营团队协作，你觉得怎么样？'];
  assert.equal(isEcho('好的，这块我在天美项目里主要负责统筹设备到货和现场施工。', iv, ''), false);
  assert.equal(isEcho('我觉得可以先小范围试点两周看效果。', iv, ''), false);
});

test('太短的话不判，防误伤', () => {
  assert.equal(isEcho('好的', ['我们这个岗位需要经常和运营团队协作'], ''), false);
  assert.equal(isEcho('嗯没问题', [], ''), false);
});

test('空面试官历史 → 不可能判回声', () => {
  assert.equal(isEcho('我们团队主要做短视频内容', [], ''), false);
});

const { createEchoFilter } = require('../renderer/echoguard.js');
test('麦克风先定稿，面试官后返回，重复内容不提交', () => {
  let time = 0; const out = [];
  const f = createEchoFilter((text) => out.push(text), () => time);
  f.enqueue('嗯好的你可能理解的这个商场的运营可能不仅仅是帮商家去做宣传', '12:00');
  time = 900;
  f.interviewer('嗯好的你可能理解的这个商场的运营');
  f.interviewer('可能不仅仅是帮商家去做宣传');
  time = 1900; f.flush();
  assert.deepEqual(out, []);
});
test('真实回答保留，旧面试官内容超时后不再当回声', () => {
  let time = 0; const out = [];
  const f = createEchoFilter(text => out.push(text), () => time);
  f.interviewer('你具体是如何调整施工顺序的');
  f.enqueue('我先安排不依赖新设备的布线施工', '12:00');
  time = 1900; f.flush();
  assert.equal(out.length, 1);
  time = 14000;
  f.enqueue('你具体是如何调整施工顺序的', '12:01');
  time = 16000; f.flush();
  assert.equal(out.length, 2);
});
test('结束强制提交真实发言，新场清空待确认发言', () => {
  const out = []; const f = createEchoFilter(text => out.push(text));
  f.enqueue('这是我的真实回答内容', '12:00'); f.flush(true);
  assert.equal(out.length, 1);
  f.enqueue('上一场尚未提交的内容', '12:01'); f.clear(); f.flush(true);
  assert.equal(out.length, 1);
});
