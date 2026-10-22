// DOM smoke for 一键开始/结束（2026-09-30）：真实使用里两个声道永远要一起开，
// 所以要验的是「点一次两个都起来」「再点一次两个都停」「只起来一个时不拖累另一个」。
// 麦克风用 Electron 的假设备（不弹真授权、不依赖硬件），ASR 通道在主进程桩掉。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const starts = [];
const stops = [];
let failMe = false; // 模拟「我的麦克风」那一路启动失败

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

ipcMain.handle('asr:start', (e, p) => {
  if (failMe && p.id === 'me') throw new Error('模拟：麦克风被占用');
  starts.push({ id: p.id, source: p.source });
  return true;
});
ipcMain.handle('asr:stop', (e, id) => { stops.push(id); return true; });
ipcMain.handle('ark:models', () => ({ all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('ark:status', () => ({ ok: true, model: 'doubao-seed-2-0-mini-260428' }));

const PROBE = `(() => {
  const el = (id) => document.getElementById(id);
  const on = (id) => el(id).classList.contains('on');
  return {
    mainText: el('main-toggle').textContent,
    mainOn: on('main-toggle'),
    ivOn: on('tog-interviewer'),
    meOn: on('tog-me'),
    ivText: el('tog-interviewer').textContent,
    meText: el('tog-me').textContent,
    banner: el('banner').hidden ? '' : el('banner').textContent.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 90),
  };
})()`;

app.whenReady().then(async () => {
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
  await new Promise((r) => setTimeout(r, 1200));
  const read = () => win.webContents.executeJavaScript(PROBE);
  const click = (id) => win.webContents.executeJavaScript(`document.getElementById('${id}').click()`);
  const out = {};

  out.atStart = await read();

  // ① 一键开始：一次点击把两个声道都拉起来
  await click('main-toggle');
  await new Promise((r) => setTimeout(r, 1500));
  out.afterStart = await read();
  out.starts = starts.slice();

  // ② 一键结束：再点一次两个都停，文案回到「开始面试」
  await click('main-toggle');
  await new Promise((r) => setTimeout(r, 800));
  out.afterStop = await read();
  out.stops = stops.slice();

  // ③ 部分失败：我的麦克风起不来时，面试官照常工作，横幅说清楚该重试哪个
  failMe = true;
  await click('main-toggle');
  await new Promise((r) => setTimeout(r, 1500));
  out.afterPartialFail = await read();

  out.logs = logs.filter((l) => !/Security Warning/.test(l));
  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
  clearTimeout(watchdog);
  app.exit(0);
}).catch((e) => { console.log('SMOKE_THROW ' + (e && e.message)); app.exit(3); });
