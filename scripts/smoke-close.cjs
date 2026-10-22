// smoke for「点 X 只隐藏、软件不退出」（2026-09-30）：
// 直接在本进程 require 真实 main.cjs（同一条启动链），再从主进程调 win.close()——
// 这与点原生红绿灯 X 走同一条 close 事件链。不能用渲染层 window.close() 代替：
// 本机 Electron 版本里它会绕过 BrowserWindow 的 close 事件直接销毁窗口（最小实验实锤），
// 等价性不成立。验证：①窗口活着且不可见（hide 不是 destroy）②渲染层 visibilityState=hidden
// ③手机投屏服务仍响应。⌘Q 真退出走 before-quit 放行，逻辑简单不在此覆盖。
// 运行：env -u ELECTRON_RUN_AS_NODE electron --no-sandbox --disable-gpu --disable-dev-shm-usage scripts/smoke-close.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const http = require('node:http');

const PHONE = 'http://127.0.0.1:9433/';
const httpGet = (url) => new Promise((resolve, reject) => {
  const req = http.get(url, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b));
  });
  req.on('error', reject);
});

(async () => {
  const watchdog = setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 45000);
  app.on('will-quit', () => { console.log('SMOKE_WILL_QUIT (app 要退出了，close 防线没拦住)'); });
  require(path.join(__dirname, '..', 'main.cjs')); // 真实 app 在本进程跑起来

  await app.whenReady();
  await new Promise((r) => setTimeout(r, 3000)); // 等投屏服务等起稳

  const w = BrowserWindow.getAllWindows()[0];
  const before = { winExists: !!w, visibleBefore: w ? w.isVisible() : null };
  try { await httpGet(PHONE); before.phoneServerBefore = 'alive'; } catch (e) { before.phoneServerBefore = 'DOWN: ' + e.message; }

  w.close(); // 与点原生红绿灯 X 同一条 close 事件链
  await new Promise((r) => setTimeout(r, 1200));

  const out = { ...before };
  // 能执行到后面这些行，本身就证明 app 没退（close→hide 成功的话进程还在跑）
  out.appAliveAfterClose = true;
  out.winAliveAfterClose = !w.isDestroyed();
  out.visibleAfterClose = w.isDestroyed() ? null : w.isVisible(); // 期望 false：藏起来了而不是销毁
  try {
    const html = await httpGet(PHONE);
    out.phoneServerAfterClose = /<!doctype/i.test(html) ? 'alive' : 'unexpected';
  } catch (e) { out.phoneServerAfterClose = 'DOWN: ' + e.message; }
  try {
    out.visibilityState = await w.webContents.executeJavaScript('document.visibilityState'); // 期望 hidden
  } catch (e) { out.visibilityState = 'ERR ' + e.message; }

  clearTimeout(watchdog);
  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
  app.exit(0);
})().catch((e) => { console.log('SMOKE_THROW ' + (e && e.stack)); app.exit(3); });
