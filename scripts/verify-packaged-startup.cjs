const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'release/Pebble-darwin-arm64/Pebble.app');
const packaged = path.join(bundle, 'Contents/Resources/app');
const files = ['main.cjs', 'asr-text.cjs', 'grounded-answer.cjs', 'prompt.cjs', 'recorder.cjs', 'renderer/app.js', 'renderer/context.js', 'renderer/qdetect.js', 'credential-client.cjs', 'credential-worker.cjs', 'credential-io.cjs', 'preload.cjs'];
for (const file of files) {
  const hash = filePath => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  assert.equal(hash(path.join(root, file)), hash(path.join(packaged, file)), file);
}
assert.ok(!fs.existsSync(path.join(packaged, 'artifacts')));
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
if (process.argv.includes('--static-only')) {
  const result = { signature: 'valid', matchingRuntimeFiles: files.length, privateArtifactsExcluded: true, startup: 'not-verified: macOS Keychain authorization pending' };
  fs.writeFileSync(path.join(root, 'artifacts/package-check-20261020.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2)); process.exit(0);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-package-check-'));
const ownCache = path.join(os.homedir(), 'Library/Application Support/interview-assist/ark.enc');
if (fs.existsSync(ownCache)) { fs.copyFileSync(ownCache, path.join(temporary, 'ark.enc')); fs.chmodSync(path.join(temporary, 'ark.enc'), 0o600); }
const env = { ...process.env, ASSIST_USER_DATA: temporary }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(bundle, 'Contents/MacOS/Pebble'), ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
const watchdog = setTimeout(() => {
  try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
  fs.rmSync(temporary, { recursive: true, force: true });
  console.error('Packaged startup timed out; macOS Keychain authorization may be pending.'); process.exit(1);
}, process.argv.includes('--answer-check') ? 70000 : 20000);
let errors = '';
child.stderr.on('data', chunk => { errors += chunk.toString(); });
child.stdout.resume();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let socket;
  try {
    const deadline = Date.now() + 12000;
    const portFile = path.join(temporary, 'DevToolsActivePort');
    while (!fs.existsSync(portFile) && Date.now() < deadline) await sleep(100);
    const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    let targets = [];
    while (!targets.some(t => t.type === 'page') && Date.now() < deadline) { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json(); await sleep(100); }
    const target = targets.find(t => t.type === 'page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let serial = 0; const waiting = new Map();
    socket.on('message', data => { const msg = JSON.parse(data); if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } });
    const command = (method, params) => new Promise(resolve => { const id = ++serial; waiting.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    let state;
    for (let i = 0; i < 50; i++) {
      const result = await command('Runtime.evaluate', { expression: `({title:document.title,ready:document.readyState,questionSelector:typeof selectCurrentQuestion,evidenceStore:typeof conversationContext !== 'undefined' ? typeof conversationContext.evidence : 'missing',button:document.getElementById('main-toggle')?.textContent,location:location.pathname})`, returnByValue: true });
      state = result.result?.result?.value;
      if (state?.evidenceStore === 'function') break;
      await sleep(100);
    }
    assert.equal(state.questionSelector, 'function'); assert.equal(state.evidenceStore, 'function'); assert.equal(state.button, '开始面试');
    assert.ok(decodeURIComponent(state.location).includes('release/Pebble-darwin-arm64/'));
    assert.ok(!/ReferenceError|SyntaxError|TypeError/.test(errors));
    let modelReady = false;
    for (let i = 0; i < 60; i++) {
      const result = await command('Runtime.evaluate', { expression: 'window.assist.arkStatus().then(s => ({ready:s.ok,loading:s.loading}))', awaitPromise: true, returnByValue: true });
      const status = result.result?.result?.value;
      if (status?.ready) { modelReady = true; break; }
      if (status && !status.loading) break;
      await sleep(100);
    }
    assert.ok(modelReady, 'Packaged UI is responsive, but credentials are not ready');
    const roundTrip = await command('Runtime.evaluate', { expression: `(async () => {
      const profile = await window.assist.getProfile(), jd = await window.assist.getJd();
      const savedProfile = await window.assist.setProfile(profile), savedJd = await window.assist.setJd(jd);
      return { profileSaved: savedProfile.ok, jdSaved: savedJd.ok,
        profilePreserved: (await window.assist.getProfile()) === profile,
        jdPreserved: (await window.assist.getJd()) === jd };
    })()`, awaitPromise: true, returnByValue: true });
    const saved = roundTrip.result?.result?.value;
    assert.ok(saved?.profileSaved && saved?.jdSaved && saved?.profilePreserved && saved?.jdPreserved);
    let answerCheck;
    if (process.argv.includes('--answer-check')) {
      const started = Date.now();
      await command('Runtime.evaluate', { expression: `conversationContext.append('me', '这是一个演示工作流：输入文案和配音，AI生成镜头素材，我手动调整后导入剪辑软件完成人工剪辑。'); qBuf = ['这个演示工作流能直接生成完整成片吗？']; userAsked = true; fireAsk(''); 'requested';` });
      let answer;
      for (let i = 0; i < 250; i++) {
        const result = await command('Runtime.evaluate', { expression: '({pending:generating,error:curAns?.err,text:curAns?.full})', returnByValue: true });
        answer = result.result?.result?.value;
        if (answer && !answer.pending) break;
        await sleep(200);
      }
      assert.ok(answer && !answer.pending && !answer.error && /剪辑/.test(answer.text), 'Packaged live answer did not pass');
      answerCheck = { passed: true, elapsedMs: Date.now() - started };
    }
    const result = { signature: 'valid', matchingRuntimeFiles: files.length, privateArtifactsExcluded: true, startup: state, modelReady, configRoundTrip: saved, answerCheck };
    fs.writeFileSync(path.join(root, 'artifacts/package-check-20261020.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    clearTimeout(watchdog);
    if (socket) socket.close();
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
    await sleep(500);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
