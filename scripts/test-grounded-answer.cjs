const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourcesFor, generateReferenceAnswer } = require('../grounded-answer.cjs');
const { createConversationContext } = require('../renderer/context.js');
test('空档案也生成完整参考答案，没有核对或证据门槛', async () => {
  let calls=0;const events=[];
  const answer='大纲：\n1. 场景：视频改进\n逐字稿：\n我重新设计了素材分类和剪辑顺序。';
  assert.equal(await generateReferenceAnswer({question:'再举一个主动改进的例子',complete:async messages=>{
    calls++;assert.ok(messages[0].content.includes('用户已明确授权'));return answer;
  },diagnostic:e=>events.push(e)}),answer);
  assert.equal(calls,1);assert.deepEqual(events.map(e=>e.type),['request','released']);
  assert.equal(events[0].answerMode,'reference-with-scenarios');
});
test('生成增量实时转发，完成后不重复整段', async () => {
  const chunks=[];
  const result=await generateReferenceAnswer({question:'其他案例？',onDelta:s=>chunks.push(s),complete:async (messages,signal,emit)=>{
    emit('大纲：\n1. 案例\n');emit('逐字稿：\n我调整了剪辑节奏。');return '大纲：\n1. 案例\n逐字稿：\n我调整了剪辑节奏。';
  }});
  assert.equal(chunks.length,2);assert.equal(chunks.join(''),result);
});
test('非流式兼容调用也显示一次答案', async () => {
  const chunks=[];
  await generateReferenceAnswer({question:'案例？',onDelta:s=>chunks.push(s),complete:async()=> '大纲：\n1. 案例\n逐字稿：\n参考答案'});
  assert.equal(chunks.length,1);
});
test('中断后不发布晚到内容，网络异常仍正确报错', async () => {
  const ac=new AbortController();const chunks=[];
  await assert.rejects(generateReferenceAnswer({question:'问题',signal:ac.signal,onDelta:s=>chunks.push(s),complete:async(m,s,emit)=>{ac.abort();emit('晚到');return '晚到';}}),{name:'AbortError'});
  assert.deepEqual(chunks,[]);
  await assert.rejects(generateReferenceAnswer({question:'问题',complete:async()=>{throw Error('network');}}),/network/);
});
test('编写的参考情境不成为候选人实际经历', async () => {
  const context=createConversationContext();context.append('me','我的实际项目是网站。');
  const answer=await generateReferenceAnswer({question:'另一个例子',facts:context.evidence(),complete:async()=> '我做过一个练习案例。'});
  context.append('answer',answer);
  assert.equal(context.evidence(),'我：我的实际项目是网站。');
});
test('既有事实和当前追问仍传给模型，要求另一个案例时不重答旧案例', async () => {
  const facts='我：甲方提供文案和配音，我只生成素材并人工剪辑。';
  await generateReferenceAnswer({question:'换一个设计改进的案例',facts,complete:async messages=>{
    assert.ok(messages[1].content.includes(facts));assert.ok(messages[0].content.includes('换一个场景'));return '另一个案例';
  }});
  assert.equal(sourcesFor('',facts)[0].kind,'candidate');
});
