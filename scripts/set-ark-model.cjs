// 切换方舟当前模型（写 ScreenRelay 那份 model.enc，两个 app 共用同一份凭据）。
// 方舟的限流是**按模型**算的：某一个模型 429 时，同账号下别的模型往往照常可用，
// 所以「换个模型」是最快的恢复手段，不用等额度重置。
//
// 用法：node scripts/set-ark-model.cjs <模型ID>
// 例：node scripts/set-ark-model.cjs doubao-seed-2-1-pro-260915
//
// 安全：①先备份 model.enc.bak ②只改 model 字段，key/profile 原样保留 ③写回后再读一次
//       校验 model 真的变了、key 长度没变 ④全程不打印 key。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ELECTRON = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
const model = process.argv[2];
if (!model) {
  console.log('用法：node scripts/set-ark-model.cjs <模型ID>');
  console.log('不知道选哪个？先跑 node scripts/probe-ark-quota.cjs 看哪些实测 200。');
  process.exit(1);
}

// safeStorage 的身份由**运行时包的 package.json name** 决定：model.enc 是 screen-relay-lab
// 加密的，所以写入方也必须是同名身份，且必须 `electron <目录>`（传 .cjs 路径会丢身份）。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-set-'));
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'screen-relay-lab', main: 'set.cjs' }));
fs.writeFileSync(path.join(tmp, 'set.cjs'), `
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const dir = path.join(app.getPath('userData'), '..', 'screen-relay-lab');
app.setPath('userData', dir);
app.whenReady().then(() => {
  try {
    const file = path.join(dir, 'model.enc');
    const cfg = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    const before = cfg.model;
    fs.copyFileSync(file, file + '.bak'); // 写坏还能回滚
    cfg.model = ${JSON.stringify(model)};
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(cfg)));
    const back = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    console.log('ARKSET ' + JSON.stringify({
      before, after: back.model, keyLen: (back.key || '').length, profileLen: (back.profile || '').length,
    }));
  } catch (e) {
    console.log('ARKSETFAIL ' + String(e).slice(0, 200));
  }
  app.exit(0);
});
`);

const out = execFileSync(ELECTRON, [tmp], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const line = out.split('\n').find((l) => l.startsWith('ARKSET'));
console.log(line ? line.slice(7) : '失败：' + out.slice(0, 300));
fs.rmSync(tmp, { recursive: true, force: true });
if (line) console.log('已切换（key 与档案原样保留）。两个 app 需**重启**后才读到新模型；回滚：把 model.enc.bak 改回 model.enc。');
