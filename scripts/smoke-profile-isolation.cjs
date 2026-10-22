// 验证「档案不随凭据迁移」：把 userData 指到临时目录，让 main.cjs 走 helper 导入路径
// （缓存必空 → 必须去解 ScreenRelay 凭据），然后读回它自己写下的 ark.enc，断言 profile 为空、
// 凭据齐全。全程不碰用户真实的 userData。
// 2026-10-10：main.cjs 把 userData 钉死成常量了，隔离改走 ASSIST_USER_DATA 环境变量。
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const TMP = '/tmp/assist-tmp-userdata';
const MAIN = path.join(__dirname, '..', 'main.cjs');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

app.whenReady().then(async () => {
  process.env.ASSIST_USER_DATA = TMP; // main.cjs 顶部的钉死逻辑认这个变量
  require(MAIN);
  const cache = path.join(TMP, 'ark.enc');
  let out = { cacheWritten: false };
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (fs.existsSync(cache)) { out.cacheWritten = true; break; }
  }
  if (out.cacheWritten) {
    const cfg = JSON.parse(safeStorage.decryptString(fs.readFileSync(cache)));
    out.hasKey = !!cfg.key;
    out.hasModel = !!cfg.model;
    out.profileLen = (cfg.profile || '').length;
    out.profilePreview = (cfg.profile || '').slice(0, 20);
  }
  console.log('MIGRATION_TEST ' + JSON.stringify(out, null, 2));
  app.exit(0);
});
