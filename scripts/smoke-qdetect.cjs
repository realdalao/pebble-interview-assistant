// DOM smoke for 内容判停（2026-09-30 改造后：内容拍板，静音只兜底）：
// ① 背景陈述不会触发提问 ② 完整问句在 300ms 拼接窗口后就发，不等 900ms 静音
// ③ 拼接窗口内来了新定稿 → 取消重判 ④ 判定后他又开口 → 撤掉内容触发，不许抢答
// ⑤ 手动按钮仍可立即触发 ⑥ 状态提示文案反映当前判定。
// 提问报文一律从主进程真实 IPC 抓（llm:ask），不读界面。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const asks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

ipcMain.handle('llm:ask', (e, payload) => { asks.push(payload); return true; });
ipcMain.handle('ark:models', () => ({ all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('ark:status', () => ({ ok: true, model: 'doubao-seed-2-0-mini-260428' }));

// 等到 asks 真的多出一条为止，返回耗时；超时返回 -1。用来量「内容拍板到底多快」
async function waitAsk(budget) {
  const n = asks.length;
  const t0 = Date.now();
  while (Date.now() - t0 < budget) {
    if (asks.length > n) return Date.now() - t0;
    await sleep(40);
  }
  return -1;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  const logs = [];
  win.webContents.on('console-message', (...a) => {
    const f = a[0];
    logs.push(f && typeof f === 'object' && 'message' in f ? f.level + ': ' + f.message : a[1] + ': ' + a[2]);
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(900);
  const emit = (payload) => win.webContents.send('asr:text', payload);
  win.webContents.send('asr:text', { id: 'interviewer', status: 'live' });
  const read = () => win.webContents.executeJavaScript(`({
    bar: document.getElementById('q-bar').getBoundingClientRect().width > 0,
    state: document.getElementById('q-state').textContent,
  })`);

  const out = { barAtStart: (await read()).bar };

  // ① 背景陈述：不该发
  emit({ id: 'interviewer', definite: ['我先介绍一下公司和团队背景。'], partial: '' });
  await sleep(150);
  out.afterBackground = await read();
  await sleep(1750); // 负向对照：背景阈值 2600ms，1.9s 时仍不该发
  out.asksAt1900ms = asks.length;

  // ② 完整问句：内容拍板，应该在 300ms 量级发出（旧逻辑要 900ms）
  emit({ id: 'interviewer', definite: ['那你怎么看这件事？'], partial: '' });
  await sleep(120);
  out.afterQuestion = await read();
  out.fireLatencyMs = await waitAsk(1500);
  out.asksAfterQuestion = asks.length;
  out.firedQuestion = asks.length ? asks[asks.length - 1].question : '';
  // 不补一个 done，generating 会一直是 true：后面的场景全被「生成中不催单」挡住，断言就成了假绿
  win.webContents.send('llm:delta', { askId: asks[asks.length - 1].askId, done: true });
  await sleep(120);

  // ③ 拼接窗口：300ms 内又来一段定稿 → 取消重判，不许把半截问题发出去
  const beforeJoin = asks.length;
  emit({ id: 'interviewer', definite: ['那你觉得难点是什么？'], partial: '' });
  await sleep(120);
  emit({ id: 'interviewer', definite: ['先说第一个就行。'], partial: '' });
  await sleep(600);
  out.asksAfterJoinWindow = asks.length - beforeJoin; // 期望 0：被取消了

  // ④ 判定完他又开口（灰字回来）→ 撤掉内容触发，不许在他补充时抢答
  const beforeResume = asks.length;
  emit({ id: 'interviewer', definite: ['你先做个自我介绍。'], partial: '' });
  await sleep(120);
  out.stateBeforeResume = (await read()).state;
  emit({ id: 'interviewer', partial: '另外我还想问' });
  await sleep(600);
  out.asksAfterResume = asks.length - beforeResume; // 期望 0：内容触发已撤销
  out.stateAfterResume = (await read()).state;

  // ⑤ 手动触发：不受上面任何等待影响，点一下就发
  await win.webContents.executeJavaScript(`document.getElementById('ask-now').click()`);
  await sleep(250);
  out.asksAfterManual = asks.length;
  out.manualQuestion = asks.length ? asks[asks.length - 1].question : '';

  out.logs = logs.filter((l) => !/Security Warning/.test(l));
  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
  app.exit(0);
}).catch((e) => { console.log('SMOKE_THROW ' + (e && e.message)); app.exit(3); });
