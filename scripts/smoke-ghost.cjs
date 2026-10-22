// smoke for「⌃⌥H 隐身模式」（2026-09-30）：窗口 + Dock 图标一起藏、再按唤回。
// 直接本进程 require 真实 main.cjs（同一条启动链），从 module.exports 拿 toggleGhost
// 驱动真实代码路径——globalShortcut 的真实按键在无头冒烟里按不了，但注册是否成功看启动日志。
// 运行：env -u ELECTRON_RUN_AS_NODE electron --no-sandbox --disable-gpu --disable-dev-shm-usage scripts/smoke-ghost.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

(async () => {
  const watchdog = setTimeout(() => { console.log('SMOKE_TIMEOUT'); app.exit(2); }, 45000);
  const assist = require(path.join(__dirname, '..', 'main.cjs'));

  await app.whenReady();
  await new Promise((r) => setTimeout(r, 2500)); // 等窗口与服务起稳
  const w = BrowserWindow.getAllWindows()[0];
  const out = { winExists: !!w, visibleBefore: w.isVisible() };

  assist.toggleGhost(); // 隐身
  await new Promise((r) => setTimeout(r, 600));
  out.visibleAfterGhost = w.isVisible(); // 期望 false
  out.dockHiddenAfterGhost = app.dock ? !app.dock.isVisible() : 'n/a'; // 期望 true
  out.winAliveAfterGhost = !w.isDestroyed(); // 隐身不是销毁
  out.processAlive = true; // 能执行到这里 app 必然活着

  assist.toggleGhost(); // 唤回
  await new Promise((r) => setTimeout(r, 600));
  out.visibleAfterRestore = w.isVisible(); // 期望 true
  out.dockRestored = app.dock ? app.dock.isVisible() : 'n/a'; // 期望 true

  clearTimeout(watchdog);
  console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
  app.exit(0);
})().catch((e) => { console.log('SMOKE_THROW ' + (e && e.stack)); app.exit(3); });
