// Real renderer + preload + IPC, virtual interview clock, no API/audio side effects.
// The recording is read locally; no personal transcript is copied into this repo.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createAsrDecoder } = require('../asr-text.cjs');
const ROOT = path.resolve(__dirname, '..');
const input = process.argv.find(arg => arg.endsWith('.jsonl'));
if (!input) throw new Error('Usage: electron scripts/replay-real-interview.cjs /absolute/transcript.jsonl');
const entries = fs.readFileSync(input, 'utf8').trim().split('\n').map(JSON.parse).filter(e => ['interviewer', 'me'].includes(e.kind));
const asks = [], errors = [];
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pebble-replay-')));
app.commandLine.appendSwitch('no-sandbox');
for (const [name, result] of Object.entries({ 'ark:models': { all: ['test'], current: 'test' }, 'ark:status': { ok: true, model: 'test' }, 'ark:get-profile': '', 'ark:get-jd': '', 'window:floating-status': { active: false }, 'llm:summarize-context': { ok: false } })) ipcMain.handle(name, () => result);
ipcMain.handle('llm:ask', (event, payload) => { asks.push(payload); event.sender.send('llm:delta', { askId: payload.askId, done: true }); return true; });
ipcMain.on('phone:sync', () => {});
const millis = text => text.split(':').reduce((n, v) => n * 60 + Number(v), 0) * 1000;
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => app.exit(3), 45000);
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true } });
  win.webContents.on('console-message', (event, level, message) => { const text = event.message || message || ''; if (/ReferenceError|TypeError|SyntaxError/.test(text)) errors.push(text); });
  await win.loadFile(path.join(ROOT, 'renderer/index.html'));
  await win.webContents.executeJavaScript(`(() => {
    localStorage.autoAsk = '1'; autoAsk = true;
    window.__clock = ${millis(entries[0].t)};
    window.__timers = new Map(); window.__tid = 100000;
    Date.now = () => window.__clock;
    window.setTimeout = (fn, ms) => { const id = ++window.__tid; window.__timers.set(id, { at: window.__clock + ms, fn }); return id; };
    window.clearTimeout = id => window.__timers.delete(id);
    window.__advance = target => {
      for (let n = 0; n < 10000; n++) {
        const due = [...window.__timers.entries()].filter(([id, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        window.__clock = due[1].at; window.__timers.delete(due[0]); due[1].fn();
      }
      window.__clock = target; echoFilter.flush();
    };
  })()`);
  const packets = { interviewer: [], me: [] };
  const decoders = { interviewer: createAsrDecoder(), me: createAsrDecoder() };
  for (const entry of entries) {
    const at = Math.max(millis(entry.t), await win.webContents.executeJavaScript('window.__clock'));
    await win.webContents.executeJavaScript(`window.__advance(${at})`);
    const all = packets[entry.kind]; all.push({ text: entry.text, definite: true });
    const payload = { id: entry.kind, ...decoders[entry.kind]({ text: all.map(u => u.text).join(''), utterances: all }) };
    win.webContents.send('asr:text', payload);
    await win.webContents.executeJavaScript('void 0');
  }
  await win.webContents.executeJavaScript('window.__advance(window.__clock + 6000)');
  await win.webContents.executeJavaScript('void 0');
  assert.deepEqual(errors, []);
  assert.ok(asks.length >= 8 && asks.length <= 18, `unexpected trigger count ${asks.length}`);
  for (const ask of asks) {
    assert.ok(ask.question.length < 350, 'cumulative history in latest question');
    assert.ok(!/^嗯[，。\s]*$/.test(ask.question));
    assert.ok(!ask.question.includes('感谢你的分享'));
    assert.equal(typeof ask.facts, 'string');
    // Sources must contain only actual speech that was already available at dispatch.
    assert.ok(!ask.facts.includes('大纲：'));
  }
  const toolAsk = asks.find(a => a.question.includes('主要用的模型'));
  assert.ok(toolAsk && !toolAsk.question.includes('教育经历'));
  const workflowAsk = asks.find(a => a.question.includes('需要哪些的输入'));
  assert.ok(workflowAsk && !workflowAsk.facts.includes('生成出来。然后我再'));
  const result = { inputEvents: entries.length, previousQuestions: 48, requests: asks.length, questions: asks.map(a => a.question), errors };
  const artifact = path.join(ROOT, 'artifacts/interview-replay-20261020.json');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
  clearTimeout(watchdog); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
