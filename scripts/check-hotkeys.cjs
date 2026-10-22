// 快捷键字符串校验：globalShortcut.register 对非法 accelerator 是「静默返回 false」，
// 不报异常，所以必须显式断言注册成功。这里不真正占用按键，注册后立刻注销。
const { app, globalShortcut } = require('electron');

const HOTKEYS = { 'Control+Alt+X': 'stop', 'Control+Alt+Space': 'ask' };

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

app.whenReady().then(() => {
  const out = {};
  for (const accel of Object.keys(HOTKEYS)) {
    const ok = globalShortcut.register(accel, () => {});
    out[accel] = { registered: ok, isRegistered: globalShortcut.isRegistered(accel) };
  }
  globalShortcut.unregisterAll();
  out.afterUnregister = Object.keys(HOTKEYS).map((a) => globalShortcut.isRegistered(a));
  console.log('HOTKEY_CHECK ' + JSON.stringify(out, null, 2));
  app.exit(0);
});
