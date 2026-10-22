// DOM smoke for 手机端（2026-10-11 重构后）：主区是回答卡片流，面试官说话只在顶部浮窗，
// 对话记录走覆盖层。必须验：①显隐状态跟生成状态走（量 rect，不读 class 字符串）
// ②点了按钮真的往 /api/act 发出对应 action ③新 UI 不横向超屏（铁律：真机会算足 auto 轨道）。
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const CONV = [
  { k: 'iv', t: '10:00:03', text: '你先介绍一下背景。' },
  { k: 'iv', t: '10:00:09', text: '那你怎么看？' },
  { k: 'ai', t: '10:00:10', text: '大纲：\n1. 结论：先亮观点\n逐字稿：\n我先说结论。' }, // 覆盖层应跳过 ai
  { k: 'me', t: '10:00:30', text: '我觉得可以先小范围试。' },
];
const ANSWER = '大纲：\n1. 结论：先亮观点\n2. 依据：小范围试点\n逐字稿：\n我先说结论，这件事值得小范围先试。';
const acts = []; // 手机真的发回来的动作
const ANSWER_CARDS = [{ q: '那你怎么看？', text: ANSWER, err: false, pending: false }];
let pending = false; // 模拟电脑端「是否正在生成」
let autoAsk = true;
let ts = 1;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// 量真实宽度，不读 hidden/class：CSS 里给了 display 的元素，属性判显隐会假绿
const PROBE = `(() => {
  const w = (id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().width) : -1; };
  const cards = [...document.querySelectorAll('#answers .answer-card')];
  return {
    cards: cards.length,
    lastCardText: cards.length ? cards[cards.length - 1].querySelector('.answer-body').textContent.replace(/\\s+/g, ' ').slice(0, 16) : '',
    keylines: cards.length ? cards[cards.length - 1].querySelectorAll('.keyline').length : 0,
    floatShown: !document.getElementById('iv-float').classList.contains('off'),
    floatText: document.getElementById('iv-float-text').textContent.slice(0, 10),
    meShown: !document.getElementById('me-float').classList.contains('off'),
    meText: document.getElementById('me-float').textContent.slice(0, 8),
    autoDimmed: document.getElementById('btn-auto').classList.contains('state-off'),
    askW: w('btn-ask'),
    stopW: w('btn-stop'),
    state: document.getElementById('state').textContent,
    emptyShown: document.getElementById('empty').getBoundingClientRect().width > 0,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

const SHEET_PROBE = `(() => {
  const items = [...document.querySelectorAll('#conv-list .conv-item')].map((el) => ({
    kind: el.classList.contains('me') ? 'me' : 'iv',
    text: el.textContent.replace(/^\\d+:\\d+:\\d+/, '').slice(0, 12),
  }));
  return { sheetShown: !document.getElementById('conv-sheet').classList.contains('off'), items };
})()`;

(async () => {
  const watchdog = setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 45000);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/act' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let action = '';
        try { action = String((JSON.parse(body || '{}') || {}).action || ''); } catch (_) {}
        acts.push(action);
        if (action === 'ask') pending = true;          // 电脑端收到后开始生成
        if (action === 'stop') pending = false;        // 收到停止，生成结束
        if (action === 'toggle-autoask') autoAsk = !autoAsk;
        ts += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (u.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ts,
        conv: CONV,
        answers: pending
          ? ANSWER_CARDS.concat([{ q: '那你说说', text: '', err: false, pending: true }])
          : ANSWER_CARDS,
        partial: pending ? '' : '那你说说', // 没在生成 → 面试官正在说话，浮窗该出现
        mepartial: pending ? '' : '我觉得可以先小范围试', // 底部「我的话语」字幕行数据源
        qstate: pending ? '正在生成回答…' : '',
        history: [], pending, autoAsk,
        live: { interviewer: true, me: true },
        models: { all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' },
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(ROOT, 'renderer', 'phone.html')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await app.whenReady();

  const win = new BrowserWindow({ show: false, width: 390, height: 780, useContentSize: true });
  const logs = [];
  win.webContents.on('console-message', (...a) => {
    const f = a[0];
    logs.push(f && typeof f === 'object' && 'message' in f ? f.level + ': ' + f.message : a[1] + ': ' + a[2]);
  });
  await win.loadURL(`http://127.0.0.1:${port}/phone.html?t=TEST_TOKEN`);
  await new Promise((r) => setTimeout(r, 1200));
  const read = () => win.webContents.executeJavaScript(PROBE);
  const click = (id) => win.webContents.executeJavaScript(`document.getElementById('${id}').click()`);

  const out = {};
  out.idle = await read(); // 没在生成：浮窗该在（面试官正说话），停止该藏

  await click('btn-conv'); // 对话记录覆盖层：只放人说的话，ai 条目跳过
  await new Promise((r) => setTimeout(r, 300));
  out.sheet = await win.webContents.executeJavaScript(SHEET_PROBE);
  await click('btn-conv-close');
  await new Promise((r) => setTimeout(r, 200));

  await click('btn-ask');
  await new Promise((r) => setTimeout(r, 1200)); // 等手机轮询（800ms）把新状态画出来
  out.afterAsk = await read();
  out.actsAfterAsk = acts.slice();

  await click('btn-auto'); // 自动识别开关：动作发回去，状态随下一轮轮询回来
  await new Promise((r) => setTimeout(r, 1200));
  out.actsAfterAuto = acts.slice();
  out.autoDimmedAfterToggle = (await read()).autoDimmed;

  await click('btn-stop');
  await new Promise((r) => setTimeout(r, 1200));
  out.afterStop = await read();
  out.actsAfterStop = acts.slice();
  fs.writeFileSync('/tmp/phone-conv.png', (await win.webContents.capturePage()).toPNG());
  out.logs = logs.filter((l) => !/Security Warning/.test(l));

  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
  clearTimeout(watchdog);
  server.close();
  app.exit(0);
})().catch((e) => { console.log('SMOKE_THROW ' + (e && e.message)); app.exit(3); });
