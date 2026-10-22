// 截图脚本：把对话流界面和记录面板渲染出来存成 PNG，用来肉眼确认版式。
// 不写断言——断言在各 smoke-* 里；这里只负责「把界面摆成有内容的状态并拍照」。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const SESSION = [
  { t: '10:02:11', kind: 'interviewer', text: '我们先聊一下团队背景。' },
  { t: '10:02:19', kind: 'interviewer', text: '那你说说，项目延期的时候你怎么处理？' },
  { t: '10:02:20', kind: 'answer', text: '要点：先把结论说出来\n其实我当时是接手了一个已经延期的版本，我们重新排了排期。\n\n要点：过程要有取舍\n当时砍掉了两个非核心需求，把联调时间压缩到两天。\n\n要点：结果用数据收尾\n最后上线时间只比原计划晚了三天。' },
  { t: '10:02:48', kind: 'me', text: '我一般会先跟需求方确认优先级。' },
  { t: '10:02:55', kind: 'interviewer', text: '那如果需求方坚持不肯砍呢？' },
];
const asks = [];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

ipcMain.handle('llm:ask', (e, p) => { asks.push(p); return true; });
ipcMain.handle('ark:get-profile', () => '');
ipcMain.handle('ark:set-profile', () => ({ ok: true }));
ipcMain.handle('ark:models', () => ({ all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('ark:status', () => ({ ok: true, model: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('record:list', () => [
  { id: 'interview-2026-09-30_100211.jsonl', mtime: Date.now(), title: '那你说说，项目延期的时候你怎么处理？' },
  { id: 'interview-2026-09-29_153000.jsonl', mtime: Date.now() - 86400000, title: '讲一个你主导过的项目。' },
]);
ipcMain.handle('record:read', () => SESSION);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1180, height: 820,
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 900));

  // 摆出一段真实感够的对话：面试官两句 → AI 回答 → 我说一句 → 面试官追问
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['我们先聊一下团队背景。'], partial: '' });
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['那你说说，项目延期的时候你怎么处理？'], partial: '' });
  await new Promise((r) => setTimeout(r, 1300));
  win.webContents.send('llm:delta', { askId: asks[0].askId, delta: SESSION[2].text });
  win.webContents.send('llm:delta', { askId: asks[0].askId, done: true });
  win.webContents.send('asr:text', { id: 'me', definite: ['我一般会先跟需求方确认优先级。'], partial: '' });
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['那如果需求方坚持不肯砍呢？'], partial: '' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.writeFileSync('/tmp/shot-conv.png', (await win.webContents.capturePage()).toPNG());

  // 记录面板：左边场次列表、右边对话
  await win.webContents.executeJavaScript(`document.getElementById('rec-btn').click()`);
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync('/tmp/shot-record.png', (await win.webContents.capturePage()).toPNG());

  console.log('SHOT_OK /tmp/shot-conv.png /tmp/shot-record.png');
  app.exit(0);
}).catch((e) => { console.log('SHOT_FAIL ' + e.message); app.exit(1); });
