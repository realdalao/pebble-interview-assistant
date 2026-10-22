const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifySentence, pendingKind, silenceThreshold, stateLabel, isCompleteQuestion, contentFireDelay, CONTENT_FIRE_MS } = require('../renderer/qdetect.js');

test('问号结尾一律算问句', () => {
  assert.equal(classifySentence('你觉得这个方案怎么样？'), 'question');
  assert.equal(classifySentence('那如果预算减半呢?'), 'question');
  assert.equal(classifySentence('对吧？'), 'question');
});

test('说完整但不是提问 → 背景陈述', () => {
  assert.equal(classifySentence('我先介绍一下公司和团队背景。'), 'background');
  assert.equal(classifySentence('我们主要做短视频内容。'), 'background');
  assert.equal(classifySentence('好，我明白了。'), 'background');
});

test('没有句末标点 → 话没说完', () => {
  assert.equal(classifySentence('我们团队主要做短视频，'), 'partial');
  assert.equal(classifySentence('你刚才提到'), 'partial');
  assert.equal(classifySentence(''), 'partial');
});

test('没标点但有明确请示且够长 → 仍按问句处理', () => {
  assert.equal(classifySentence('请谈谈你的项目经历'), 'question');
  assert.equal(classifySentence('介绍一下你做过的项目'), 'question');
});

test('陈述句里带“什么”这类词不当问句（除非有问号或够长的请示）', () => {
  assert.equal(classifySentence('不管什么情况我们都要交付。'), 'background');
  assert.equal(classifySentence('这就是我们的基本情况。'), 'background');
});

test('句尾疑问词才算问句：“是什么。”要发，“什么情况”在句中不发', () => {
  assert.equal(classifySentence('你遇到最大的困难是什么。'), 'question');
  assert.equal(classifySentence('这个团队大概多少人。'), 'question');
  assert.equal(classifySentence('什么都要以交付为准。'), 'background');
});

test('面试官自称要讲（“我先介绍一下背景。”）是背景，不是请你讲', () => {
  assert.equal(classifySentence('我先介绍一下公司和团队背景。'), 'background');
  assert.equal(classifySentence('我来说明一下面试流程。'), 'background');
  assert.equal(classifySentence('我们先聊一下公司情况，'), 'partial');
});

test('pendingKind 以最后一句定稿为准，没有定稿时看灰字', () => {
  assert.equal(pendingKind(['我介绍一下背景。', '你觉得呢？'], ''), 'question');
  assert.equal(pendingKind(['我们做短视频。'], ''), 'background');
  assert.equal(pendingKind([], '你还'), 'partial');
  assert.equal(pendingKind([], ''), 'background');
});

test('阈值按类别分档：问句最快、半句话最久', () => {
  assert.equal(silenceThreshold('question'), 900);
  assert.equal(silenceThreshold('background'), 2600);
  assert.equal(silenceThreshold('partial'), 3200);
  assert.equal(silenceThreshold('未知类别'), 2600); // 兜底
});

test('状态文案说明“为什么还没发”', () => {
  assert.equal(stateLabel('question', true), '已识别问题，确认中…');
  assert.equal(stateLabel('background', true), '背景说明中，等提问…');
  assert.equal(stateLabel('partial', true), '面试官还在说，等待句末…');
  assert.equal(stateLabel('question', false), '');
});

test('典型场景：背景两段后才提问，最后一句决定触发节奏', () => {
  const seg = ['我先说一下背景。', '我们团队做短视频，去年开始做直播。', '那你怎么看这件事？'];
  assert.equal(pendingKind(seg, ''), 'question');
  assert.equal(silenceThreshold(pendingKind(seg, '')), 900);
});

test('典型场景：面试官停在半句话上，不该马上发', () => {
  const seg = ['我们团队主要做'];
  assert.equal(pendingKind(seg, ''), 'partial');
  assert.equal(silenceThreshold(pendingKind(seg, '')), 3200);
});

// ---- 2026-09-30：拍板依据从「静音」换成「内容」 ----
test('内容拍板：完整问句 → 只等 300ms 拼接窗口，不再等静音', () => {
  assert.equal(contentFireDelay(['那你怎么看这件事？'], ''), CONTENT_FIRE_MS);
  assert.equal(contentFireDelay(['你觉得难点是什么。'], ''), CONTENT_FIRE_MS);
  assert.equal(contentFireDelay(['请谈谈你的项目经历。'], ''), CONTENT_FIRE_MS);
  assert.equal(contentFireDelay(['好，那我们开始吧？'], ''), CONTENT_FIRE_MS);
});

test('内容不足以拍板 → 返回 0，交给静音兜底', () => {
  assert.equal(contentFireDelay(['我先介绍一下背景。'], ''), 0); // 背景
  assert.equal(contentFireDelay(['我们团队主要做'], ''), 0); // 没句末标点
  assert.equal(contentFireDelay(['不管什么情况都要交付。'], ''), 0); // 陈述句
  assert.equal(contentFireDelay([], '你还'), 0); // 只有灰字
  assert.equal(contentFireDelay([], ''), 0);
});

test('内容拍板只看最后一句：前面问过、又在补充背景时不抢发', () => {
  assert.equal(contentFireDelay(['你怎么看？', '我再补充一点背景。'], ''), 0);
  assert.equal(contentFireDelay(['我再补充一点背景。', '那你怎么看？'], ''), CONTENT_FIRE_MS);
});

test('面试官对着「你」发问时，疑问词在句中也算提问', () => {
  assert.equal(classifySentence('你为什么选择我们公司。'), 'question');
  assert.equal(classifySentence('你先做个自我介绍。'), 'question');
  // 负向对照：没有「你」的陈述句里带疑问词，仍然是背景
  assert.equal(classifySentence('不管什么情况我们都要交付。'), 'background');
});

test('isCompleteQuestion 必须有句末标点，防止把 ASR 没收完的话发出去', () => {
  assert.equal(isCompleteQuestion('你怎么看这件事？'), true);
  assert.equal(isCompleteQuestion('你怎么看这件事'), false);
  // 「你先介绍一下背景。」是请你讲（请求作答），该发；「我们团队做短视频。」才是纯背景，不发
  assert.equal(isCompleteQuestion('你先介绍一下背景。'), true);
  assert.equal(isCompleteQuestion('我们团队主要做短视频内容。'), false);
});

test('状态文案：内容拍板时要说清「即将作答」，别让用户以为还在等', () => {
  assert.equal(stateLabel('question', true, true), '问句已完整，即将作答…');
  assert.equal(stateLabel('question', true, false), '已识别问题，确认中…');
  assert.equal(stateLabel('background', true, true), '背景说明中，等提问…'); // 背景不存在内容拍板
});
