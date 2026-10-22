// DOM smoke for 要点 highlighting in 面试辅助 answers.
// Two surfaces: the desktop answer card (streams llm:delta) and the phone mirror page
// (polls /api/state). Both must render 「要点：」 lines highlighted while keeping the
// full text — including the newlines that the phone payload and the record log rely on.
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = process.env.PEBBLE_TEST_ROOT || path.resolve(__dirname, '..');
// 2026-10-10 深夜起答案改「大纲 + 逐字稿」两段式：大纲：/逐字稿：标题行和编号行都要高亮
const ANSWER = '大纲：\n1. 定位：一句话讲清「懂技术的内容人」\n2. 项目：天美扩容（1380 万）抢回延期工期\n逐字稿：\n我的背景比较特殊，本科学的是自动化，研究生读的广电，算是一个懂技术的内容人。之前在腾讯天美做电竞演播系统扩容，项目 1380 万，中途设备到货延期，最后靠调整施工顺序把工期抢了回来。这段经历让我既能对接技术方案，也能把控内容效果，正好对应岗位的要求。';
const logs = [];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

const asks = [];
ipcMain.handle('llm:ask', (e, payload) => { asks.push(payload); return true; });
ipcMain.handle('ark:models', () => ({ all: ['doubao-seed-2-0-mini-260428'], current: 'doubao-seed-2-0-mini-260428' }));
ipcMain.handle('ark:status', () => ({ ok: true, model: 'doubao-seed-2-0-mini-260428' }));
// 渲染层初始化会读档案和 JD，缺 handler 会直接把启动链路打断（2026-10-10 冒烟假绿教训）
ipcMain.handle('ark:get-profile', () => '');
ipcMain.handle('ark:get-jd', () => '');
// 真实证据：渲染层往主进程同步手机镜像的那条报文。DOM 里 textContent 会把 <br> 吞掉，
// 如果同步改成读 textContent，换行会在手机上丢——这里直接抓 IPC 载荷断言换行还在。
const syncs = [];
ipcMain.on('phone:sync', (e, payload) => { syncs.push(payload); });

// desktop: drive the real delta handler, then inspect the DOM the model's text produced
// 2026-10-11 答案是卡片流 + 大纲/逐字稿分层（.ans-sec），探针验证分层和交互
const DESKTOP_PROBE = `(() => {
  const cards = document.querySelectorAll('#answers .answer-card');
  const card = cards[cards.length - 1];
  if (!card) return { cards: 0, NO_CARDS: true };
  const out = {};
  out.cards = cards.length;
  out.q = card.querySelector('.answer-q').textContent;
  out.sections = [...card.querySelectorAll('.ans-sec')].map((s) => s.className.replace('ans-sec ', ''));
  out.secTags = [...card.querySelectorAll('.sec-tag')].map((t) => t.textContent.trim());
  out.keylines = card.querySelectorAll('.keyline').length;
  out.firstKeyline = (card.querySelector('.keyline') || {}).textContent || '';
  out.foldArrow = !!card.querySelector('.fold-arrow');
  out.fullTextLen = card.querySelector('.answer-body').textContent.length;
  out.jumpHidden = document.getElementById('jump-latest').hidden;
  return out;
})()`;

const PHONE_PROBE = `(() => {
  const cards = document.querySelectorAll('#answers .answer-card');
  const a = cards[cards.length - 1];
  if (!a) return { cards: 0, NO_CARDS: true };
  const body = a.querySelector('.answer-body');
  return {
    cards: cards.length,
    sections: [...a.querySelectorAll('.ans-sec')].map((s) => s.className.replace('ans-sec ', '')),
    secTags: [...a.querySelectorAll('.sec-tag')].map((t) => t.textContent.trim()),
    keylines: a.querySelectorAll('.keyline').length,
    firstKeyline: (a.querySelector('.keyline') || {}).textContent || '',
    foldArrow: !!a.querySelector('.fold-arrow'),
    text: body.textContent.slice(0, 24),
  };
})()`;

(async () => {
  // 看门狗：探针一旦抛错，原来的写法会让 Electron 永远挂着（require 到 GUI 就没法 Ctrl-C 收尸），
  // 这里强制超时退出并把已抓到的渲染层日志打出来，方便定位是探针错还是页面错。
  const watchdog = setTimeout(() => {
    console.log('SMOKE_TIMEOUT ' + JSON.stringify({ logs }, null, 2));
    app.exit(2);
  }, 45000);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/state')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ts: 1,
        history: [],
        answer: ANSWER,
        pending: false,
        // 回答流（2026-10-11）：手机端主区只认 answers 数组，每问一张卡片
        answers: [{ q: '你怎么看这个排期？', text: ANSWER, err: false, pending: false }],
        autoAsk: true,
        // 对话记录覆盖层只放人说的话（k: iv/me），AI 条目会被跳过
        conv: [{ k: 'iv', t: '10:00:00', text: '你怎么看这个排期？' }],
        qstate: '',
      }));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(ROOT, 'renderer', 'phone.html')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  await app.whenReady();
  const result = {};

  // --- desktop surface: real preload + real renderer, deltas sent from the main process
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    logs.push(first && typeof first === 'object' && 'message' in first ? first.level + ': ' + first.message : args[1] + ': ' + args[2]);
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1000));
  // 对话流里 AI 正文是提问时才创建的一条条目，所以必须走真实的 asr → fireAsk 链路，
  // 不能凭空往 askId 0 灌 delta（那样 .answer-text 根本不存在，探针会直接抛）。
  win.webContents.send('asr:text', { id: 'interviewer', definite: ['你怎么看这个排期？'], partial: '' });
  await new Promise((r) => setTimeout(r, 1400)); // 问句判停阈值 900ms
  const askId = (asks[0] || {}).askId;
  for (const chunk of ANSWER.match(/[\s\S]{1,12}/g)) {
    win.webContents.send('llm:delta', { askId, delta: chunk });
    await new Promise((r) => setTimeout(r, 30));
  }
  win.webContents.send('llm:delta', { askId, done: true });
  await new Promise((r) => setTimeout(r, 900)); // 手机同步是 500ms 节流，等它真的发出去
  result.desktop = await win.webContents.executeJavaScript(DESKTOP_PROBE);
  // 折叠交互（P0-2）：点「逐字稿 · 可照念」标签 → 收起 → 再点 → 展开
  result.fold = await win.webContents.executeJavaScript(`(() => {
    const tag = document.querySelector('#answers .answer-card:last-child .sec-tag.foldable');
    if (!tag) return { NO_FOLD: true };
    tag.click();
    const sec = tag.closest('.ans-sec');
    const collapsedAfterClick = sec.classList.contains('collapsed');
    tag.click();
    return { collapsedAfterClick, restored: !sec.classList.contains('collapsed') };
  })()`);
  // 回到最新（P0-3）：先把窗口压矮制造真实溢出（900px 高内容根本滚不动，按钮不出现是对的），
  // 再滚到顶 → 按钮出现 → 点它 → 回到底部且按钮收起
  win.setBounds({ height: 320 });
  await new Promise((r) => setTimeout(r, 350));
  result.jump = await win.webContents.executeJavaScript(`(async () => {
    const feed = document.getElementById('answers');
    const scrollable = feed.scrollHeight > feed.clientHeight;
    // 压矮窗口后 scrollTop 已被重置为 0——先滚到底再回顶，确保产生真实的 scroll 事件
    feed.scrollTop = feed.scrollHeight;
    await new Promise((r) => setTimeout(r, 150));
    feed.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 250));
    const btn = document.getElementById('jump-latest');
    const shownAfterScrollUp = !btn.hidden;
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const atBottomAfterClick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    return { scrollable, shownAfterScrollUp, atBottomAfterClick, hiddenAfterClick: btn.hidden };
  })()`);
  const lastSync = syncs.filter((s) => s.answer).pop() || {};
  result.desktopSyncsNewlines = {
    syncCount: syncs.length,
    hasBreak: String(lastSync.answer || '').includes('\n'),
    answerEqualsModelText: String(lastSync.answer || '') === ANSWER,
    // 回答流字段：手机端主区的真正数据源，全文必须一字不差
    answersSynced: String(((lastSync.answers || []).slice(-1)[0] || {}).text || '') === ANSWER,
    answersCount: (lastSync.answers || []).length,
    autoAskSynced: lastSync.autoAsk === true,
    // conv 只放人说的话（iv/me），AI 不再进对话流
    convKinds: (lastSync.conv || []).map((e) => e.k),
  };
  fs.writeFileSync('/tmp/answer-desktop.png', (await win.webContents.capturePage()).toPNG());

  // --- phone surface: served over http so the relative /api/state fetch works
  const pwin = new BrowserWindow({ show: false, width: 390, height: 816, useContentSize: true });
  pwin.webContents.on('console-message', (...args) => {
    const first = args[0];
    logs.push(first && typeof first === 'object' && 'message' in first ? 'phone ' + first.level + ': ' + first.message : 'phone ' + args[1] + ': ' + args[2]);
  });
  await pwin.loadURL(`http://127.0.0.1:${port}/phone.html?t=TEST_TOKEN`);
  await new Promise((r) => setTimeout(r, 1500));
  result.phone = await pwin.webContents.executeJavaScript(PHONE_PROBE);
  fs.writeFileSync('/tmp/answer-phone.png', (await pwin.webContents.capturePage()).toPNG());

  console.log('SMOKE_RESULT ' + JSON.stringify({ result, askId, askCount: asks.length, logs }, null, 2));
  clearTimeout(watchdog);
  server.close();
  app.exit(0);
})().catch((err) => {
  console.log('SMOKE_THROW ' + (err && err.message) + '\nlogs=' + JSON.stringify(logs));
  app.exit(3);
});
