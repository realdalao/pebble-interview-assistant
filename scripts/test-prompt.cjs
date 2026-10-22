// prompt.cjs 单测：node scripts/test-prompt.cjs，全过打 PASS
const { buildSysPrompt } = require('../prompt.cjs');
let fails = 0;
function ok(cond, name) { if (!cond) { fails++; console.log('FAIL ' + name); } }

const s1 = buildSysPrompt('我的档案正文', '岗位介绍正文', 'short');
ok(s1.includes('目标岗位介绍（回答要对着它优化）：岗位介绍正文'), 'jd 注入');
ok(s1.includes('候选人资料：我的档案正文'), 'profile 注入');
ok(s1.indexOf('目标岗位介绍') < s1.indexOf('候选人资料：'), 'jd 在 profile 之前');
ok(s1.includes('用户已明确授权'), '允许合理构造参考情境');
// 两段式结构（2026-10-10 深夜用户拍板：先大纲、再整段逐字稿）
ok(s1.includes('两段式'), '两段式定位');
ok(s1.includes('标题行写「大纲：」'), '大纲段标题规则在');
ok(s1.includes('标题行写「逐字稿：」'), '逐字稿段标题规则在');
ok(s1.includes('可以直接照着念'), '逐字稿可照念定位');
ok(s1.includes('逐字稿必须和大纲一一对应'), '逐字稿覆盖大纲约束在');
ok(s1.includes('整体示范'), 'few-shot 整体示范在');
ok(s1.includes('大纲：\n1.'), '示范含大纲部分');
ok(s1.includes('逐字稿：\n'), '示范含逐字稿部分');
ok(buildSysPrompt('', '', 'long').includes('大纲 7-9 条'), 'len=long 条数档');
ok(buildSysPrompt('', '', 'long').includes('逐字稿 300-400 字'), 'len=long 逐字稿字数档');
ok(buildSysPrompt('', '', 'short').includes('大纲 3-4 条'), 'len=short 条数档');
ok(buildSysPrompt('', '', 'normal').includes('逐字稿 200-250 字'), 'len=normal 逐字稿字数档');
ok(!buildSysPrompt('', '', 'short').includes('目标岗位介绍'), '无 jd 时不出现岗位段');
ok(!buildSysPrompt('', '', 'short').includes('候选人资料：'), '无 profile 时不出现资料段');
ok(buildSysPrompt('', '', 'unknown').includes('大纲 3-4 条'), '未知 len 回落 short');
ok(buildSysPrompt(null, null, 'short').includes('资深面试教练'), '基底提示词在');
ok(buildSysPrompt(null, null, 'short').includes('赋能、抓手'), '空话黑名单保留');
// 2026-10-12 用户反馈「AI 味太重」：去 AI 腔规则与反面示范
ok(buildSysPrompt(null, null, 'short').includes('不要升华'), '结尾升华禁令在');
ok(buildSysPrompt(null, null, 'short').includes('不难看出'), 'AI 腔连接词进黑名单');
ok(buildSysPrompt(null, null, 'short').includes('反面示范'), 'AI 腔反面示范在');

ok(!/腾讯|天美|1380|抢回/.test(buildSysPrompt('', '', 'short')), '空档案不带示范经历或金额');
ok(s1.includes('不要因缺少依据而拒答'), '材料不足不拒答');

console.log(fails ? 'PROMPT TEST FAIL' : 'PROMPT TEST PASS');
process.exit(fails ? 1 : 0);
