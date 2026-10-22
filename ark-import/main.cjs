// 一次性解密代理：以 screen-relay-lab 身份解出方舟凭据，JSON 打到 stdout 后立即退出
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const dir = path.join(app.getPath('userData'), '..', 'screen-relay-lab');
app.setPath('userData', dir);
app.whenReady().then(() => {
  try {
    const cfg = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(dir, 'model.enc'))));
    console.log('ARKJSON' + JSON.stringify({ key: cfg.key, model: cfg.model, profile: cfg.profile || '' }));
  } catch (e) {
    console.log('ARKFAIL ' + String(e).slice(0, 120));
  }
  app.exit(0);
});
