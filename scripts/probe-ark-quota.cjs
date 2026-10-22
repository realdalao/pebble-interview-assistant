// 诊断脚本：用真实凭据查方舟「这个 key 能访问哪些模型」+「逐个模型最小请求的真实返回码」。
// 目的：区分「账号整体额度/欠费」和「单个模型的 RPM/TPM 限速」——两者都报 429，但解法完全不同。
// 安全：只打印状态码与方舟返回的错误码/消息，**绝不打印 key 本身**。
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ELECTRON = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
const ARK_IMPORT = path.join(__dirname, '..', 'ark-import');
const BASE = 'https://ark.cn-beijing.volces.com/api/v3';
// 软件注册表里的固定模型，全试一遍就能看出是个别模型限速还是整个账号都过不去
const CANDIDATES = [
  'doubao-seed-2-1-pro-260915',
  'doubao-seed-2-1-lite-260915',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-0-mini-260428',
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-evolving',
];
// 兼容通道（Anthropic Messages 格式）走另一个 endpoint，返回的错误码含义一样，单独测
const COMPATIBLE = [
  'deepseek-v4-1-flash-260910',
  'glm-5-3-flash-260828',
  'deepseek-v4-pro-ga-260813',
  'deepseek-v4-flash-ga-260731',
  'glm-5-2-260617',
];

// 面试辅助启动后会把自己那份凭据（含 model）缓存到自己的 ark.enc（身份 interview-assist），
// 和 ScreenRelay 的 model.enc 是两份——要知道「软件到底在用哪个模型」，必须读它自己的这份。
function readOwnCache() {
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(require('node:path').join(os.tmpdir(), 'ark-own-'));
  fs.writeFileSync(require('node:path').join(tmp, 'package.json'), JSON.stringify({ name: 'interview-assist', main: 'r.cjs' }));
  fs.writeFileSync(require('node:path').join(tmp, 'r.cjs'), `
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
app.whenReady().then(() => {
  try {
    const f = path.join(app.getPath('userData'), 'ark.enc');
    const cfg = JSON.parse(safeStorage.decryptString(fs.readFileSync(f)));
    console.log('OWN ' + JSON.stringify({ model: cfg.model, keyLen: (cfg.key || '').length, profileLen: (cfg.profile || '').length }));
  } catch (e) { console.log('OWNFAIL ' + String(e).slice(0, 120)); }
  app.exit(0);
});
`);
  const out = execFileSync(ELECTRON, [tmp], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return out.split('\n').find((l) => l.startsWith('OWN')) || '(读不到)';
}

function getKey() {
  const out = execFileSync(ELECTRON, [ARK_IMPORT], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const line = out.split('\n').find((l) => l.startsWith('ARKJSON'));
  if (!line) throw new Error('拿不到凭据：' + out.slice(0, 200));
  return JSON.parse(line.slice(7));
}

async function probeModel(key, model, compatible) {
  const t0 = Date.now();
  const url = compatible
    ? 'https://ark.cn-beijing.volces.com/api/compatible/v1/messages'
    : BASE + '/chat/completions';
  const body = compatible
    ? { model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }
    : { model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        ...(compatible ? { 'anthropic-version': '2023-06-01' } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let code = '', msg = '';
    try {
      const j = JSON.parse(text);
      code = (j.error && (j.error.code || j.error.type)) || '';
      msg = (j.error && j.error.message) || '';
    } catch { msg = text.slice(0, 80); }
    return { model, status: res.status, code, msg: String(msg).slice(0, 120), ms: Date.now() - t0 };
  } catch (e) {
    return { model, status: 'NETWORK', code: '', msg: String(e.message).slice(0, 80), ms: Date.now() - t0 };
  }
}

(async () => {
  const cfg = getKey();
  console.log('面试辅助自己缓存的那份：' + readOwnCache());
  console.log('ScreenRelay 那份（凭据来源）：' + cfg.model + '；key 长度 ' + String(cfg.key || '').length + '（不打印内容）');

  // 1) 这个 key 能访问哪些模型：不消耗额度，只列清单
  const listRes = await fetch(BASE + '/models?page_num=1&page_size=100', {
    headers: { Authorization: 'Bearer ' + cfg.key },
  }).catch((e) => ({ status: 'NETWORK', text: async () => e.message }));
  const listText = await listRes.text();
  let ids = [];
  try {
    const j = JSON.parse(listText);
    ids = (j.data || []).map((m) => m.id);
  } catch { /* 有的网关这里不返回 JSON */ }
  console.log('models 接口 HTTP ' + listRes.status + '，可访问模型数 ' + ids.length);
  console.log('可访问模型：' + JSON.stringify(ids));

  // 2) 逐个最小请求：1 个 token，成本可忽略
  const rows = [];
  for (const m of CANDIDATES) rows.push(await probeModel(cfg.key, m, false));
  console.log('原生通道逐个模型实测（max_tokens=1）：');
  for (const r of rows) console.log('  ' + r.status + ' | ' + (r.code || '-') + ' | ' + r.model + ' | ' + r.msg);
  const crows = [];
  for (const m of COMPATIBLE) crows.push(await probeModel(cfg.key, m, true));
  console.log('兼容通道逐个模型实测（max_tokens=1）：');
  for (const r of crows) console.log('  ' + r.status + ' | ' + (r.code || '-') + ' | ' + r.model + ' | ' + r.msg);
  const ok = rows.concat(crows).filter((r) => r.status === 200).map((r) => r.model);
  // 3) 视觉能力：ScreenRelay 走的是 Responses API（input_image），不是 chat/completions 的
  //    image_url——按它真实用的格式探，才知道换过去能不能识别截图。
  // 用一张真实截图（1×1 的假图会被判 InvalidParameter，测不出模型到底认不认图）
  const real = require('node:fs').readFileSync('/tmp/shot-conv.png').toString('base64');
  const PNG = 'data:image/png;base64,' + real;
  for (const m of ['doubao-seed-2-1-pro-260915', 'doubao-seed-2-0-lite-260428', 'doubao-seed-evolving']) {
    const res = await fetch(BASE + '/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: m, max_output_tokens: 1,
        input: [{ role: 'user', content: [{ type: 'input_image', image_url: PNG }, { type: 'input_text', text: '看图' }] }],
      }),
    }).catch((e) => ({ status: 'NETWORK', text: async () => e.message }));
    const t = await res.text();
    let code = '', vmsg = '';
    try { const j = JSON.parse(t); code = (j.error && (j.error.code || j.error.type)) || ''; vmsg = (j.error && j.error.message) || ''; } catch { code = t.slice(0, 60); }
    console.log('  视觉(Responses)：' + res.status + ' | ' + (code || 'OK') + ' | ' + m + ' | ' + String(vmsg).slice(0, 110));
  }
  console.log('现在能跑通的模型：' + JSON.stringify(ok));
})().catch((e) => { console.log('PROBE_FAIL ' + e.message); process.exit(1); });
