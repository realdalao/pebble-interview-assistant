// DOM smoke for 面试辅助 我的档案 editor.
// Loads the real renderer (index.html + preload.cjs) in a hidden window; IPC handlers
// are stubbed here in the smoke main process so the full preload<->renderer roundtrip
// is exercised without booting ASR/audio in the real main.cjs.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const STUB_PROFILE = '教育背景：中国传媒大学 硕士\n工作经历：新华社张扬工作室';
let savedPayload = null;
const logs = [];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

ipcMain.handle('ark:get-profile', () => STUB_PROFILE);
ipcMain.handle('ark:set-profile', (e, text) => { savedPayload = text; return { ok: true }; });
ipcMain.handle('ark:models', () => ({ all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('ark:status', () => ({ ok: true, model: 'doubao-seed-2-0-mini-260428' }));

const PROBE = `(async () => {
  const out = { steps: [], fail: '' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = (id) => document.getElementById(id);
  const step = (name, value) => out.steps.push([name, value]);
  try {
    const visible = (el) => !!el && el.getBoundingClientRect().width > 0; // hidden 属性会被 display:flex 压掉，必须量真实宽度
    step('modalAtStart', visible(g('profile-modal')) ? 'VISIBLE(bad)' : 'not visible');
    step('gType', typeof document.getElementById);
    step('btnAtStart', g('profile-btn') ? 'ok' : 'NULL');
    g('profile-btn').click();
    await sleep(300);
    step('modalOpen', visible(g('profile-modal')) ? 'visible' : 'NOT VISIBLE(bad)');
    step('loadedProfile', (g('profile-text').value || '').slice(0, 12));
    g('profile-text').value = '新的档案内容：腾讯天美电竞项目';
    g('profile-save').click();
    await sleep(900); // 保存后 400ms 自动关闭，留足余量
    // 新需求：点「保存档案」就自己关掉，不用再点关闭
    step('modalClosedAfterSave', visible(g('profile-modal')) ? 'STILL VISIBLE(bad)' : 'closed');
    // Esc 关窗是另一条独立的路，必须重开一次单独验，否则会被上面的自动关闭顶掉变成假绿
    g('profile-btn').click();
    await sleep(300);
    step('reopened', visible(g('profile-modal')) ? 'visible' : 'NOT VISIBLE(bad)');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await sleep(200);
    step('modalClosedByEsc', visible(g('profile-modal')) ? 'STILL VISIBLE(bad)' : 'closed');
  } catch (e) { out.fail = (out.fail || '') + String(e && e.stack || e).slice(0, 300); }
  return out;
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    if (first && typeof first === 'object' && 'message' in first) logs.push(first.level + ': ' + first.message);
    else logs.push(args[1] + ': ' + args[2]);
  });
  win.webContents.on('render-process-gone', (e, d) => logs.push('RENDER_GONE ' + JSON.stringify(d)));
  try {
    await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    await new Promise((r) => setTimeout(r, 1200));
    const probe = await win.webContents.executeJavaScript(PROBE);
    fs.writeFileSync('/tmp/profile-smoke.png', (await win.webContents.capturePage()).toPNG());
    console.log('SMOKE_RESULT ' + JSON.stringify({ probe, savedPayload, logs }, null, 2));
  } catch (error) {
    console.log('SMOKE_FAILED ' + error.message);
  }
  app.exit(0);
});
