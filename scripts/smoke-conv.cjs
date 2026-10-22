// DOM smoke for 对话流改造 + 记录面板 + 保存后自动关闭。
// 断言都用真实可见性（rect 宽度），避免「属性设了但 CSS 不认」那种假绿。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const asks = [];
const SESSION = [
  { t: '10:00:01', kind: 'interviewer', text: '你先介绍一下背景。' },
  { t: '10:00:05', kind: 'question', text: '那你怎么看？' },
  { t: '10:00:06', kind: 'answer', text: '要点：先亮结论\n我当时是这么处理的。' },
  { t: '10:00:30', kind: 'me', text: '我觉得可以先小范围试。' },
];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

ipcMain.handle('llm:ask', (e, payload) => { asks.push(payload); return true; });
ipcMain.handle('ark:get-profile', () => '既有档案');
ipcMain.handle('ark:get-jd', () => '');
ipcMain.handle('ark:set-profile', () => ({ ok: true }));
ipcMain.handle('ark:models', () => ({ all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('ark:status', () => ({ ok: true, model: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('record:list', () => [{ id: 'interview-2026-09-30_100000.jsonl', mtime: Date.now(), title: '那你怎么看？' }]);
ipcMain.handle('record:read', () => SESSION);

const READ = `(() => {
  const items = [...document.querySelectorAll('#conv .conv-item')].map((el) => ({
    kind: el.classList.contains('ai') ? 'ai' : el.classList.contains('me') ? 'me' : 'iv',
    visible: el.getBoundingClientRect().width > 0,
    text: el.textContent.replace(/^\\d+:\\d+:\\d+/, '').slice(0, 22),
  }));
  return { items, emptyHint: document.getElementById('conv-empty').getBoundingClientRect().width > 0 };
})()`;

app.whenReady().then(async () => {
  // 看门狗：探针抛错不能让 Electron 永远挂着（45s 强制退出并留证据）
  const watchdog = setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 45000);
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
  await new Promise((r) => setTimeout(r, 900));
  const out = {};
  const read = () => win.webContents.executeJavaScript(READ);

  out.atStart = await read(); // 2026-10-11 起 conv 默认隐藏（主区让给回答流），此时全不可见

  // 打开「对话记录」视图后再验证对话流渲染
  await win.webContents.executeJavaScript(`document.getElementById('conv-btn').click()`);
  await new Promise((r) => setTimeout(r, 150));
  out.convOpened = await read();

  // 面试官 → AI 回答 → 我 → 面试官 → AI：应按时间插在同一条流里
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['你先介绍一下背景。'], partial: '' });
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['那你怎么看？'], partial: '' });
  await new Promise((r) => setTimeout(r, 1300));
  out.askCount = asks.length;
  win.webContents.send('llm:delta', { askId: asks[0].askId, delta: '要点：先亮结论\n我当时是这么处理的。' });
  win.webContents.send('llm:delta', { askId: asks[0].askId, done: true });
  win.webContents.send('asr:text', { id: 'me', definite: ['我觉得可以先小范围试。'], partial: '' });
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['那预算呢？'], partial: '' });
  await new Promise((r) => setTimeout(r, 1300));
  out.afterConversation = await read();
  out.askCountTotal = asks.length;

  // 「显示我说的话」图标开关：关掉后 me 条目不可见（仍在 DOM 里）
  await win.webContents.executeJavaScript(`document.getElementById('show-me').click()`);
  await new Promise((r) => setTimeout(r, 120));
  const hidden = await read();
  out.meVisibleWhenHidden = hidden.items.filter((i) => i.kind === 'me' && i.visible).length;
  out.meStillInDom = hidden.items.filter((i) => i.kind === 'me').length;

  // 记录面板：左边场次列表，右边对话
  await win.webContents.executeJavaScript(`document.getElementById('rec-btn').click()`);
  await new Promise((r) => setTimeout(r, 400));
  out.record = await win.webContents.executeJavaScript(`(() => {
    const modal = document.getElementById('rec-modal');
    const items = [...document.querySelectorAll('#rec-conv .conv-item')].map((el) => el.classList.contains('ai') ? 'ai' : el.classList.contains('me') ? 'me' : 'iv');
    return {
      modalVisible: modal.getBoundingClientRect().width > 0,
      sessions: document.querySelectorAll('#rec-list .rec-item').length,
      convKinds: items,
      keylines: document.querySelectorAll('#rec-conv .keyline').length,
    };
  })()`);
  await win.webContents.executeJavaScript(`document.getElementById('rec-close').click()`);

  // 保存档案后自动关闭
  await win.webContents.executeJavaScript(`document.getElementById('profile-btn').click()`);
  await new Promise((r) => setTimeout(r, 300));
  await win.webContents.executeJavaScript(`document.getElementById('profile-save').click()`);
  await new Promise((r) => setTimeout(r, 900));
  out.profileClosedAfterSave = await win.webContents.executeJavaScript(
    `document.getElementById('profile-modal').getBoundingClientRect().width === 0`);

  out.logs = logs.filter((l) => !/Security Warning/.test(l));
  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
  clearTimeout(watchdog);
  app.exit(0);
}).catch((e) => { console.log('SMOKE_THROW ' + (e && e.message)); app.exit(3); });
