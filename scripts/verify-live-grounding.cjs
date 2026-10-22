// Opt-in local benchmark using this app's encrypted config and the production
// transport. Never prints/writes keys. Reads original recording locally.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { generateGroundedAnswer } = require('../grounded-answer.cjs');
const root = path.resolve(__dirname, '..');
const input = process.argv.find(arg => arg.endsWith('.jsonl'));
app.setName('Pebble');
app.whenReady().then(async () => {
  const config = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(app.getPath('appData'), 'interview-assist/ark.enc'))));
  const code = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const scope = { fetch, TextDecoder, COMPATIBLE_MODELS: new Set(['deepseek-v4-1-flash-260910', 'glm-5-3-flash-260828', 'deepseek-v4-pro-ga-260813', 'deepseek-v4-flash-ga-260731', 'glm-5-2-260617']), COMPATIBLE_ENDPOINT: 'https://ark.cn-beijing.volces.com/api/compatible/v1/messages' };
  vm.createContext(scope);
  vm.runInContext(code.slice(code.indexOf('async function sseLines('), code.indexOf('\nconst { createCredentialClient')) + '\n' + code.slice(code.indexOf('async function arkStream('), code.indexOf('// 用模型把整场对话总结')), scope);
  const entries = fs.readFileSync(input, 'utf8').trim().split('\n').map(JSON.parse);
  const cases = [
    { id: 'project-data', at: '10:50:18', question: '百晓生项目的播放量和评论数据怎么样？' },
    { id: 'education-correction', at: '10:47:29', question: '你本科毕业后是直接读硕士的吗？' },
    { id: 'workflow-boundaries', at: '10:55:25', question: '这个百晓生工作流输入什么，直接输出完整视频吗？' },
    { id: 'project-isolation', at: '10:55:25', question: '你在央视频项目里具体负责什么？' },
    { id: 'external-case', at: '10:55:34', question: '近期有什么品牌的AI创意你觉得做得好？' },
  ];
  const results = [];
  for (const item of cases) {
    const facts = entries.filter(e => ['me', 'interviewer'].includes(e.kind) && e.t <= item.at).map(e => (e.kind === 'me' ? '我：' : '面试官：') + e.text).join('\n');
    const events = []; const start = Date.now(); const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const answer = await generateGroundedAnswer({ question: item.question, facts, context: facts, profile: config.profile || '', jd: config.jd || '', len: 'short', signal: controller.signal,
        complete: async (messages, signal) => { let out = ''; await scope.arkStream(messages, delta => { out += delta; }, signal, config); return out; },
        diagnostic: event => events.push(event),
      });
      const checks = [];
      if (item.id === 'project-data') checks.push(!/120万|近万|过万|两千|2000|二十多/.test(answer));
      if (item.id === 'education-correction') checks.push(/两年|2年|技术岗|工作/.test(answer), !/保研|直接读了硕士/.test(answer));
      if (item.id === 'workflow-boundaries') checks.push(/剪辑|人工/.test(answer), !/直接输出完整|自动出成片/.test(answer.replace(/(?:不是|不会|不能|并非)直接输出完整视频/g, '')));
      if (item.id === 'project-isolation') checks.push(!/四五千|十集|10集|四五分钟/.test(answer));
      if (item.id === 'external-case') checks.push(answer.includes('大纲：') && answer.includes('逐字稿：'));
      results.push({ ...item, answer, passed: checks.every(Boolean), elapsedMs: Date.now() - start, events });
    } catch (error) { results.push({ ...item, passed: false, error: String(error.message), elapsedMs: Date.now() - start, events }); }
    finally { clearTimeout(timer); }
    const last = results[results.length - 1];
    console.log(JSON.stringify({ id: last.id, passed: last.passed, error: last.error, elapsedMs: last.elapsedMs }));
    // Save after every case so interrupted validation remains inspectable.
    fs.writeFileSync(path.join(root, 'artifacts/live-grounding-20261020.json'), JSON.stringify({ model: config.model, results }, null, 2), { mode: 0o600 });
  }
  app.exit(results.every(r => r.passed) ? 0 : 1);
}).catch(error => { console.error(error.message); app.exit(2); });
