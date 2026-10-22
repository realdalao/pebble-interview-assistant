// DOM smoke for 停止回答：生成中状态条显示「正在生成回答…」+停止按钮；点下去要
// ① 真的向主进程发出 llm:cancel(askId) ② 已生成的内容留在屏幕上 ③ 按钮收起、状态显示「已停止」
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const asks = [];
const cancels = [];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

ipcMain.handle('llm:ask', (e, payload) => { asks.push(payload); return true; });
ipcMain.on('llm:cancel', (e, askId) => { cancels.push(askId); });
ipcMain.handle('ark:models', () => ({ all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('ark:status', () => ({ ok: true, model: 'doubao-seed-2-0-mini-260428' }));
// 渲染层 init 会读档案和 JD，缺 handler 会打断启动链路（2026-10-10 假绿教训）
ipcMain.handle('ark:get-profile', () => '');
ipcMain.handle('ark:get-jd', () => '');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 900));
  const read = () => win.webContents.executeJavaScript(`(() => {
    const g = (id) => document.getElementById(id);
    const shown = (el) => el.getBoundingClientRect().width > 0;
    return {
      bar: shown(g('q-bar')),
      state: g('q-state').textContent,
      stopShown: shown(g('stop-answer')),
      askNowShown: shown(g('ask-now')),
      // 2026-10-11 起答案是卡片流：取最后一张 .answer-card
      answer: (() => { const cs = document.querySelectorAll('#answers .answer-card'); const c = cs[cs.length - 1]; return c ? c.querySelector('.answer-body').textContent : ''; })(),
      answerState: (() => { const cs = document.querySelectorAll('#answers .answer-card'); const c = cs[cs.length - 1]; return c ? c.querySelector('.answer-state').textContent : ''; })(),
      cards: document.querySelectorAll('#answers .answer-card').length,
    };
  })()`);

  const out = {};
  out.beforeAsk = await read();

  // 触发一次提问（问句 → 900ms）
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['你怎么看这件事？'], partial: '' });
  await new Promise((r) => setTimeout(r, 1300));
  out.askCount = asks.length;
  out.askId = asks.length ? asks[0].askId : null;
  out.whileGenerating = await read();

  // 模拟流式增量
  const id = out.askId;
  win.webContents.send('llm:delta', { askId: id, delta: '要点：先说结论\n其实我当时' });
  await new Promise((r) => setTimeout(r, 150));
  out.afterDelta = (await read()).answer;

  // 点停止
  await win.webContents.executeJavaScript(`document.getElementById('stop-answer').click()`);
  await new Promise((r) => setTimeout(r, 200));
  out.cancels = cancels.slice();
  out.afterStop = await read();

  // 主进程收到 abort 后收尾（stopped）
  win.webContents.send('llm:delta', { askId: id, done: true, stopped: true });
  await new Promise((r) => setTimeout(r, 150));
  out.afterStoppedEvent = await read();

  // 快捷键链路：主进程转发 hotkey 事件，等价于点按钮
  win.webContents.send('asr:text', { id: 'interviewer', partial: '那你说说' });
  await new Promise((r) => setTimeout(r, 120));
  win.webContents.send('hotkey', 'ask');           // ⌃⌥Enter
  await new Promise((r) => setTimeout(r, 250));
  out.asksAfterHotkeyAsk = asks.length;
  out.hotkeyAskQuestion = asks.length ? asks[asks.length - 1].question : '';
  out.stateAfterHotkeyAsk = (await read()).state;

  const id2 = asks.length ? asks[asks.length - 1].askId : null;
  win.webContents.send('llm:delta', { askId: id2, delta: '要点：…' });
  await new Promise((r) => setTimeout(r, 120));
  win.webContents.send('hotkey', 'stop');          // ⌃⌥X
  await new Promise((r) => setTimeout(r, 200));
  out.cancelsAfterHotkeyStop = cancels.slice();
  out.afterHotkeyStop = await read();

  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
  app.exit(0);
});
