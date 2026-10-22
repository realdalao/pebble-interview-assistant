const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAsrDecoder } = require('../asr-text.cjs');
const { selectCurrentQuestion, stripFinalPrefix, isNonQuestion } = require('../renderer/qdetect.js');
test('ASR全量文本只输出新增定稿和未完成尾句，不重复整场历史', () => {
  const decode = createAsrDecoder();
  const old = '你主要负责什么工作？', next = '你用的工具是哪些？';
  assert.deepEqual(decode({ text: old, utterances: [{text: old, definite: true}] }), { definite: [old], partial: '', partialIsTail: true });
  assert.deepEqual(decode({ text: old + '嗯。', utterances: [{text: old, definite: true}, {text: '嗯。', definite: true}] }), { definite: ['嗯。'], partial: '', partialIsTail: true });
  assert.equal(decode({ text: old + '嗯。' + next, utterances: [{text: old, definite: true}, {text: '嗯。', definite: true}, {text: next, definite: false}] }).partial, next);
  const reconnect = createAsrDecoder();
  assert.deepEqual(reconnect({ text: next, utterances: [{text: next, definite: true}] }).definite, [next]);
});
test('回退兼容去掉全部已定稿前缀，容忍标点修订', () => {
  assert.equal(stripFinalPrefix('你主要负责什么工作？ 嗯， 你用哪些工具', ['你主要负责什么工作？', '嗯。']), '你用哪些工具');
});
test('真实记录中的确认、岗位介绍、告别不自动生成', () => {
  for (const text of ['嗯', '嗯，明白。', '嗯，是的。', '是的是的', '嗯，好，感谢你的分享。', '嗯，好。', '我们是纯线上的。', '我们目前的工作地点是杭州。', 'AI是你核心的一个内容生产工具。', '剪辑软件', '后续的反馈我们会随时同步给到你。']) {
    assert.equal(selectCurrentQuestion(text, false), '', text);
  }
});
test('累计问题只回答最新一轮，保留当轮连续复合问题及反问', () => {
  const current = '你自己主要用的模型是哪几个？或用的工具是哪些？';
  assert.equal(selectCurrentQuestion('你的教育经历怎么安排？嗯，明白。' + current, false), current);
  assert.equal(selectCurrentQuestion('嗯，明白了解。你有什么要问我的吗？', false), '你有什么要问我的吗？');
  assert.equal(selectCurrentQuestion('这是个工作流。', true), '这是个工作流。');
  assert.equal(isNonQuestion('嗯'), true);
});

test('ASR缺少utterances的包仍去掉累计定稿，迟到包不倒退水位', () => {
  const decode = createAsrDecoder();
  decode({ utterances: [{text: '你的经历？', definite: true}] });
  assert.equal(decode({text: '你的经历？你用什么'}).partial, '你用什么');
  decode({ utterances: [{text: '你的经历？', definite: true}, {text: '嗯。', definite: true}] });
  assert.deepEqual(decode({ utterances: [{text: '你的经历？', definite: true}] }).definite, []);
  assert.deepEqual(decode({ utterances: [{text: '你的经历？', definite: true}, {text: '嗯。', definite: true}] }).definite, []);
});
test('尾部灰字未出现在utterances时仍能显示，前缀改写时不回灌全场', () => {
  const decode = createAsrDecoder();
  const utterances = [{text:'你的经历？',definite:true}];
  assert.equal(decode({text:'你的经历？你用什么',utterances}).partial,'你用什么');
  assert.equal(decode({text:'你得经历？你用什么',utterances}).partial,'');
});
