// 面试辅助 v0.1 — 渲染层：采集(48k→16k 降采样) + 界面
const CHANNELS = [
  { id: 'interviewer', name: '面试官', deviceId: undefined, state: {} },
  { id: 'me', name: '我', deviceId: undefined, state: {} },
];
const SAMPLES_PER_CHUNK = 3200; // 200ms @16k

const banner = document.getElementById('banner');

// ---- 手机镜像：状态快照（回答流 + 对话流 + 当前状态），节流上报主进程 ----
const phone = { queue: [], partial: '', mepartial: '', answer: '', answerErr: false, pending: false, qstate: '', qpreview: '', autoAsk: true, dirty: false };
const recQueue = []; // 面试记录事件队列：{t, kind, text}，随同步节流增量发主进程落盘
// 手机也走对话流（2026-09-30）：条目 {k:'iv'|'me'|'ai', t, text}，与桌面同一套语义。
// 全量发而不是增量：手机随时可能断线重连，增量要补洞，全量最省心（上限 120 条）。
let phoneConv = [];
function pushPhoneConv(item) {
  phoneConv.push(item);
  if (phoneConv.length > 120) phoneConv = phoneConv.slice(-120);
  phone.dirty = true;
  return item;
}
let lastPhoneCtlKey = ''; // 声道开关/模型变化才置脏，别让 500ms 轮询空转推全量
setInterval(() => {
  const live = {
    interviewer: toggleBtn('interviewer').classList.contains('on'),
    me: toggleBtn('me').classList.contains('on'),
  };
  const ctlKey = (live.interviewer ? 'i' : '') + (live.me ? 'm' : '') + '|' + modelSelect.value;
  if (ctlKey !== lastPhoneCtlKey) { lastPhoneCtlKey = ctlKey; phone.dirty = true; }
  if (!phone.dirty && !recQueue.length) return;
  phone.dirty = false;
  window.assist.phoneSync({
    newLines: phone.queue.splice(0),
    partial: phone.partial,
    mepartial: phone.mepartial, // 手机端底部字幕行：我说的话实时灰字
    answer: phone.answer,
    answerErr: phone.answerErr,
    pending: phone.pending,
    // 回答流（2026-10-11）：手机端和桌面同构，每问一张卡片按顺序铺，新回答追加不覆盖
    answers: answers.slice(-20).map((a) => ({ q: a.q, text: a.full, err: a.err, pending: a.pending })),
    autoAsk: phone.autoAsk,
    conv: phoneConv,
    qstate: phone.qstate,
    qpreview: phone.qpreview,
    answerQ: answerQText,
    live,
    models: { all: [...modelSelect.options].map((o) => o.value), current: modelSelect.value },
    newRec: recQueue.splice(0),
  });
}, 500);

let bannerTimer = null;
function showBanner(msg) {
  banner.textContent = msg;
  banner.hidden = false;
  // 信息类提示 10s 自动收起（用户反馈常驻横幅碍事）；凭据就绪等主动 hidden 不受影响
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.hidden = true; }, 10000);
}
function showCredentialError(message) {
  showBanner(message); clearTimeout(bannerTimer);
  const retry = document.createElement('button');
  retry.textContent = '重新读取凭据'; retry.style.marginLeft = '12px';
  retry.addEventListener('click', async () => {
    retry.disabled = true; retry.textContent = '读取中…';
    const result = await window.assist.retryCredentials();
    if (!result.ok) showCredentialError(result.error || '凭据读取失败，请重试');
  });
  banner.appendChild(retry);
}


// 对话流（2026-09-30 用户要求）：不再分双声道两栏，所有内容按时间插进 #conv 一条流里。
const conv = document.getElementById('conv');
const convEmpty = document.getElementById('conv-empty');

function statusOf(id) {
  return document.getElementById('dot-' + id);
}
// 「正在说」的灰字：作为该声道的一条活动条目挂在流末尾，定稿到了就删掉换成正式条目
function partialEl(id) {
  let el = document.getElementById('live-' + id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'live-' + id;
    el.className = 'conv-item live ' + (id === 'me' ? 'me' : 'iv');
    conv.appendChild(el);
  }
  return el;
}
function dropPartial(id) {
  const el = document.getElementById('live-' + id);
  if (el) el.remove();
}
// 定稿 → 对话流追加。同一人连续说的几段并进同一个气泡（60 秒内），换人才开新气泡——
// 这样对话天然是「面试官一段 / 你一段」的回合结构，谁的话对应谁一目了然（2026-10-10 用户反馈）。
let lastTurn = null; // { id, el, phone, ts }：当前回合气泡及其手机端条目
const TURN_MERGE_MS = 60000;
function appendConv(id, text, time) {
  dropPartial(id);
  convEmpty.hidden = true;
  const ts = time || now();
  if (lastTurn && lastTurn.id === id && Date.now() - lastTurn.ts < TURN_MERGE_MS) {
    lastTurn.el.appendChild(document.createTextNode('\n' + text)); // pre-wrap 直接成行
    lastTurn.phone.text += '\n' + text; // 手机端同一个条目跟着长
    lastTurn.ts = Date.now();
  } else {
    const phoneEntry = pushPhoneConv({ k: id === 'me' ? 'me' : 'iv', t: ts, text });
    const el = document.createElement('div');
    el.className = 'conv-item ' + (id === 'me' ? 'me' : 'iv');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = ts; // 合并气泡显示回合开始时间
    el.appendChild(t);
    el.appendChild(document.createTextNode(text));
    conv.appendChild(el);
    lastTurn = { id, el, phone: phoneEntry, ts: Date.now() };
  }
  conv.scrollTop = conv.scrollHeight;
}
function hintEl() {
  return convEmpty;
}
function toggleBtn(id) {
  return document.getElementById('tog-' + id);
}
function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// ---- 设备探测与路由自检 ----
async function detectDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const bh = devs.find((d) => d.kind === 'audioinput' && /BlackHole/i.test(d.label));
  if (!bh && srcSelect.value === 'blackhole') {
    // 只在用户真的选了 BlackHole 时才警告：默认走屏幕采集，没装 BlackHole 也能用
    showBanner('未检测到 BlackHole：「面试官」声道不可用。需安装 BlackHole，并在「音频 MIDI 设置」创建多输出设备（显示器 + BlackHole 2ch）设为默认输出。');
  } else {
    const outs = await navigator.mediaDevices.enumerateDevices(); // 输出自检交给系统，无法从 renderer 拿默认输出；提示用户确认
  }
  CHANNELS[0].deviceId = bh ? bh.deviceId : null;
  CHANNELS[1].deviceId = undefined; // 系统默认麦克风
}

// ---- 采集管线 ----
async function startChannel(ch) {
  // 2026-10-12 外放回声修复：「我」的声道是真实麦克风——面试官声音从扬声器出来
  // 会被它再收一遍、转写成我的回答。开系统 AEC/NS 压掉绝大部分（Chrome 的 AEC 参考
  // 系统输出混音，同一台机器外放的场景正好对症）。BlackHole 是虚拟环路、只有系统
  // 在放的内容，开 AEC 反而有害，保持直通。
  const audio = ch.deviceId
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (ch.deviceId) audio.deviceId = { exact: ch.deviceId };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(8192, 1, 1);
  proc.onaudioprocess = (e) => feed(ch, e.inputBuffer.getChannelData(0));
  src.connect(proc);
  proc.connect(ctx.destination);
  ch.state = { stream, ctx, src, proc, buf: [], lastSignalTs: Date.now() };
  await window.assist.startChannel(ch.id, 'blackhole');
}

// 屏幕采集（SCK）音源：不开麦克风，音频由主进程的 sckcap 助手送进 ASR
async function startSckChannel(ch) {
  ch.state = { sck: true, lastSignalTs: Date.now() };
  await window.assist.startChannel(ch.id, 'sck');
}

// 电平表状态独立存，屏幕采集时没有麦克风 stream 也能用
const meterSt = { interviewer: {}, me: {} };

// 电平表：-60dBFS..0dB 映射 0..100%，峰值保持缓慢回落
function updateMeter(id, rms, st) {
  if (!st.meterFill) {
    st.meterFill = document.getElementById('meter-' + id);
    st.meterPeak = document.getElementById('peak-' + id);
  }
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  st.meterPeakPct = Math.max((st.meterPeakPct || 0) * 0.94, pct);
  st.meterFill.style.width = pct.toFixed(1) + '%';
  st.meterFill.className = 'meter-fill' + (pct > 92 ? ' clip' : pct > 70 ? ' hot' : '');
  st.meterPeak.style.left = 'calc(' + st.meterPeakPct.toFixed(1) + '% - 1px)';
}

function feed(ch, f32) {
  const st = ch.state;
  let sum = 0;
  // 48k -> 16k：3 点平均降采样
  const n = Math.floor(f32.length / 3);
  for (let i = 0; i < n; i++) {
    const v = (f32[i * 3] + f32[i * 3 + 1] + f32[i * 3 + 2]) / 3;
    const s = Math.max(-1, Math.min(1, v));
    sum += v * v;
    st.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  // 无声诊断：连接正常但 5 秒无信号 → 先自动修路由，修不好再给手动指引
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms > 0.01) st.lastSignalTs = Date.now();
  updateMeter(ch.id, rms, meterSt[ch.id]);
  const noSig = document.getElementById('nosig-' + ch.id);
  if (st.lastSignalTs && Date.now() - st.lastSignalTs > 5000 && rms <= 0.01) {
    noSig.hidden = false;
    if (ch.id === 'interviewer') {
      // 已诊断过就沿用结论，不做重复尝试（自动切换在这台 Mac 上本就不生效）
      if (st.routeMsg) noSig.textContent = st.routeMsg;
      else if (!st.fixTried) {
        st.fixTried = true;
        noSig.textContent = '没收到声音——正在检查系统输出…';
        window.assist.fixRoute().then((r) => {
          const msg = routeMsg(r);
          st.routeMsg = msg || '已把系统输出切回「多输出设备」，几秒内应恢复。';
          if (msg) showFixBtn(r.missing);
          noSig.textContent = st.routeMsg;
        });
      }
    } else {
      noSig.textContent = '连接正常但没听到你说话：检查麦克风是否被遮挡/静音。';
    }
  } else {
    noSig.hidden = true;
    if (rms > 0.01) st.fixTried = false; // 信号恢复，重置自动修复标记
  }
  while (st.buf.length >= SAMPLES_PER_CHUNK) {
    const chunk = new Int16Array(st.buf.splice(0, SAMPLES_PER_CHUNK));
    window.assist.sendAudio(ch.id, chunk.buffer);
  }
}

async function stopChannel(ch) {
  const st = ch.state;
  if (st.proc) st.proc.disconnect();
  if (st.src) st.src.disconnect();
  if (st.ctx) await st.ctx.close();
  if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
  const ms = meterSt[ch.id];
  if (ms.meterFill) { ms.meterFill.style.width = '0%'; ms.meterPeak.style.left = '0%'; }
  ch.state = {};
  await window.assist.stopChannel(ch.id);
}

// ---- UI 事件 ----
// 「声音设置」按钮：自动切换失效时给用户一个直达入口，并预先检查一次路由
const fixBtn = document.getElementById('fix-btn');
function showFixBtn(missing) {
  fixBtn.hidden = false;
  fixBtn.textContent = missing ? '音频 MIDI 设置' : '声音设置';
  fixBtn.onclick = () => (missing ? window.assist.openMidi() : window.assist.openSound());
}

// 音源：屏幕采集（ScreenCaptureKit，默认；不用虚拟声卡、不用多输出设备）/ BlackHole（虚拟声卡，兜底）
// 默认给 sck：实测整屏捕获可拿到全系统混音（对照 afplay 峰值 0.4316，与 BlackHole 的 0.432 一致），
// 且不必把系统输出改成聚合设备（音量键不失效、不用改腾讯会议设置）。代价是首次要授权屏幕录制。
const srcSelect = document.getElementById('src-select');
srcSelect.value = localStorage.ivSource || 'sck';
const chSrcEl = document.getElementById('ch-src');
function syncSrcLabel() {
  if (chSrcEl) chSrcEl.textContent = srcSelect.value === 'sck' ? '屏幕采集 · 系统声音' : 'BlackHole · 系统声音';
}
syncSrcLabel();
srcSelect.addEventListener('change', () => { localStorage.ivSource = srcSelect.value; syncSrcLabel(); });

function routeMsg(r) {
  if (r.missing) return '系统里没有「多输出设备」——先点「音频 MIDI 设置」创建一个（成员勾上你的显示器/音箱 + BlackHole 2ch），再在「声音」里选它为输出。';
  if (!r.changed) return '系统输出当前是「' + r.now + '」。面试官声道靠它进 BlackHole，而本机不允许程序化切换聚合设备，请点「声音设置」手动改成「多输出设备」。';
  return '';
}

async function checkRouteUpfront() {
  const r = await window.assist.fixRoute();
  const msg = routeMsg(r);
  if (!msg) return;
  showFixBtn(r.missing);
  showBanner(msg);
}

// 每个声道的开/停抽成函数，主按钮和单声道按钮共用同一条路——
// 主按钮负责「一键都起来」，单声道按钮退化成失败时的重试入口。
async function startOne(ch) {
  const btn = toggleBtn(ch.id);
  if (btn.classList.contains('on')) return;
  // 开第一个声道即视为一场面试开始：开新会话（若有未收尾的旧场会先自动收尾）
  if (!anyChannelOn()) {
    stopAnswer();
    window.assist.sessionStart();
    recQueue.push({ t: now(), kind: 'diagnostic', code: 'mode-start', text: `面试开始｜${autoAsk ? '自动识别开启' : '手动模式'}｜默认作答语言=中文` });
    echoFilter.clear();
    conversationContext.clear();
    answerLanguage = 'zh';
    answerLanguageReason = 'default';
    sessionReferenceAnswers = [];
    ctxHistory = [];
    qBuf = [];
    ivPartial = '';
    lastFired = '';
    userAsked = false;
    phone.qpreview = '';
    lastAsk = null;
    arkRetryPending = false;
    clearTimeout(qTimer);
  }
  const source = ch.id === 'interviewer' ? srcSelect.value : 'blackhole';
  if (source === 'blackhole' && ch.deviceId === null) throw new Error('输入设备不存在');
  btn.disabled = true;
  try {
    if (source === 'sck') await startSckChannel(ch);
    else await startChannel(ch);
    lastTurn = null; // 新一场从头开回合，别并进上一场的尾巴
    btn.classList.add('on'); // 图标按钮：状态靠 .on 配色，不换文字
    hintEl().hidden = true;
    if (ch.id === 'interviewer' && source === 'blackhole') checkRouteUpfront();
  } finally {
    btn.disabled = false;
  }
}
async function stopOne(ch) {
  const btn = toggleBtn(ch.id);
  if (!btn.classList.contains('on')) return;
  await stopChannel(ch);
  btn.classList.remove('on'); // 图标按钮：状态靠 .on 配色，不换文字
  dropPartial(ch.id);
  document.getElementById('nosig-' + ch.id).hidden = true;
  statusOf(ch.id).className = 'dot';
  // 所有声道都关了 = 一场结束：先把还没同步的最后一批记录落盘，再收尾存档（写 WAV + 三栏 HTML）
  if (!anyChannelOn()) {
    clearTimeout(qTimer); qBuf = []; ivPartial = '';
    stopAnswer();
    echoFilter.flush(true);
    if (recQueue.length) window.assist.recordFlush(recQueue.splice(0));
    window.assist.sessionEnd().then((dir) => {
      if (dir) showBanner('本场面试存档已保存（含全程录音 + 三栏转录），可在「记录」里查看');
    });
  }
}

CHANNELS.forEach((ch) => {
  const btn = toggleBtn(ch.id);
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('on')) {
      await stopOne(ch);
      renderMainToggle();
      return;
    }
    try {
      await startOne(ch);
    } catch (err) {
      showBanner('「' + ch.name + '」启动失败：' + (err && err.message));
    }
    renderMainToggle();
  });
});

// 一键开始/结束（2026-09-30）：真实使用里两个声道永远要一起开，让用户点两次是纯摩擦。
// 单个声道失败不拖累另一个，失败信息汇总成一条横幅，让用户知道该重试哪一个。
const mainToggle = document.getElementById('main-toggle');
function anyChannelOn() {
  return CHANNELS.some((c) => toggleBtn(c.id).classList.contains('on'));
}
function renderMainToggle() {
  const on = anyChannelOn();
  mainToggle.textContent = on ? '结束面试' : '开始面试';
  mainToggle.classList.toggle('on', on);
}
// IPC 错误会带着「Error invoking remote method 'xxx': Error: 」的包装前缀，用户不需要看这些
function cleanErr(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
// 一键开始/结束抽成函数：桌面按钮和手机端「开始/结束面试」共用同一条路（2026-10-10）
async function toggleInterview() {
  if (anyChannelOn()) {
    for (const ch of CHANNELS) await stopOne(ch);
    renderMainToggle();
    return;
  }
  mainToggle.disabled = true;
  const failed = [];
  for (const ch of CHANNELS) {
    try { await startOne(ch); } catch (err) { failed.push(ch.name + '：' + cleanErr(err)); }
  }
  mainToggle.disabled = false;
  renderMainToggle();
  if (failed.length) showBanner('没能全部启动：' + failed.join('；') + '。可以在工具条上单独重试对应声道。');
}
mainToggle.addEventListener('click', toggleInterview);
// 手机端遥控：只转发指令，开声道/采音频的动作仍全部发生在电脑上（声音不出本机）
window.assist.onPhoneCmd((action) => {
  if (action === 'toggle-interview') toggleInterview();
  else if (action === 'toggle-autoask') toggleAutoAsk();
});
renderMainToggle();

function commitMyUtterance(text, time) {
  conversationContext.append('me', text);
  appendConv('me', text, time);
  recQueue.push({ t: time, kind: 'me', text });
}
const echoFilter = createEchoFilter(commitMyUtterance);
setInterval(() => echoFilter.flush(), 150);

window.assist.onText((p) => {
  const dot = statusOf(p.id);
  if (typeof p.level === 'number') { // 屏幕采集：电平由主进程算好送回
    updateMeter(p.id, p.level, meterSt[p.id]);
    const ch = CHANNELS.find((c) => c.id === p.id);
    if (ch && ch.state && p.level > 0.01) ch.state.lastSignalTs = Date.now();
    return;
  }
  if (p.sckStatus) {
    const msg = {
      denied: '屏幕录制未授权：请到「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」给 SCKCap 打开开关，然后重新开始。',
      asleep: '拿不到屏幕内容：显示器处于休眠或锁屏状态，唤醒屏幕后重新开始即可。',
      started: '屏幕采集已启动（整屏捕获，含全系统混音）。',
      silent: '采集已启动但还没收到声音：请确认确实有声音在播放（先放一段音乐试一下）。',
    }[p.sckStatus];
    if (msg) showBanner(msg);
    return;
  }
  if (p.status) {
    dot.className = 'dot ' + (p.status === 'live' ? 'live' : p.status);
    if (p.status === 'error' && p.error) showBanner('声道异常：' + p.error);
    return;
  }
  if (p.definite && p.definite.length) {
    for (const t of p.definite) {
      // 外放回声守卫：面试官声音从扬声器进麦克风被转写成「我」的话——
      // 与面试官历史/未定稿高度重合的直接丢弃，不进对话流不进记录
      const time = now();
      if (p.id === 'me') { echoFilter.enqueue(t, time); continue; }
      conversationContext.append(p.id, t); // 仅纳入过滤回声后的双方定稿，AI 回答不进入上下文
      appendConv(p.id, t, time); // 对话流：按时间插进同一条流
      recQueue.push({ t: time, kind: p.id, text: t }); // 双声道定稿都进记录
      if (p.id === 'interviewer') { phone.queue.push({ t: time, text: t }); phone.dirty = true; }
    }
    // 定稿后清掉已被定稿覆盖的灰字前缀
    const remain = p.partialIsTail ? (p.partial || '') : stripFinalPrefix(p.partial || '', p.definite);
    if (remain) { const el = partialEl(p.id); el.textContent = remain; }
    else dropPartial(p.id);
    if (p.id === 'interviewer') {
      echoFilter.partial(remain);
      phone.partial = remain; ivPartial = remain; phone.dirty = true;
      // 先清除本次已定稿的灰字，再判定是否问完，避免旧灰字迫使完整问句等待静音。
      for (const t of p.definite) {
        echoFilter.interviewer(t);
        onInterviewerUtterance(t);
      }
      ivLastActive = Date.now(); // 刚说完一句：浮窗靠这个时间戳撑过句间停顿
      ivLastLine = p.definite[p.definite.length - 1];
      renderQState(undefined, qByContent);
      renderIvFloat();
    } else if (p.id === 'me') {
      if (echoFilter.isEcho(remain)) { dropPartial('me'); }
      phone.mepartial = echoFilter.isEcho(remain) ? '' : remain; phone.dirty = true; // 手机端底部「我的话语」字幕行
    }
  } else if (typeof p.partial === 'string') {
    const partial = partialEl(p.id);
    const incomingPartial = p.partialIsTail || p.id !== 'interviewer' ? p.partial : stripFinalPrefix(p.partial, ctxHistory);
    const visiblePartial = p.id === 'me' && echoFilter.isEcho(incomingPartial) ? '' : incomingPartial;
    partial.textContent = visiblePartial;
    if (!p.partial) dropPartial(p.id);
    if (p.id === 'interviewer') {
      echoFilter.partial(incomingPartial);
      phone.partial = incomingPartial; ivPartial = incomingPartial; phone.dirty = true;
      if (p.partial.trim()) ivLastActive = Date.now();
      renderIvFloat();
      // 又开口了 → 撤掉「内容已判定」的那次触发，交给静音兜底，别在他补充时抢答
      if (String(incomingPartial || '').trim()) {
        scheduleFire(pendingKind(qBuf, incomingPartial), false);
      } else {
        renderQState(pendingKind(qBuf, p.partial), qByContent);
      }
    } else if (p.id === 'me') {
      phone.mepartial = visiblePartial; phone.dirty = true; // 手机端底部「我的话语」字幕行
    }
  }
});

// ---- 答案层：面试官定稿问题 → 防抖 → 方舟流式回答 ----
const conversationContext = createConversationContext(6000, 60, (payload) => window.assist.summarizeContext(payload));
let ctxHistory = []; // 面试官历史发言，仅供回声判断
let qBuf = []; // 防抖窗口内累积的问题
let answerLanguage = 'zh'; // 明确指令优先；无指令时跟随最新问题的语言
let answerLanguageReason = 'default';
let qTimer = null;
let qByContent = false; // 当前这个定时器是「内容拍板」还是「静音兜底」——灰字回来时要据此撤掉内容触发
let askId = 0;
let ivPartial = ''; // 面试官声道当前未定稿的灰字（判停时可能还没切成定稿）
let lastFired = ''; // 最近一次已发送的问题（判停后 ASR 迟到的定稿要跟它对账）
let userAsked = false; // 本次提问是否用户手动触发（手机按钮/桌面按钮/快捷键）：决定新卡片要不要带走视口
let firedAt = 0; // 上次发送时间，用于迟到定稿的宽限窗口
const SILENCE_MS = 1300; // 静音判停阈值：没声音超过这么久且有未发送内容 → 视为问完
const REFIRE_GRACE_MS = 4000; // 判停后这段时间内到的定稿视为同一条问题的迟到补全

function normText(s) {
  return String(s).replace(/[\s，。？！、,.?!：:；;·…—~"'""'']/g, '');
}

function recentEvidence(text, maxChars = 9000) {
  const lines = String(text || '').split('\n').filter(Boolean);
  const picked = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (picked.length && size + lines[i].length + 1 > maxChars) break;
    picked.push(lines[i]); size += lines[i].length + 1;
  }
  return picked.reverse().join('\n');
}

// 扫读锚点行：编号大纲行 + 「大纲：/逐字稿：」标题行（旧的「要点：」兼容旧记录）。
// 桌面实时流、归档回放、手机端三处共用同一个正则，改这里就够。
const ANSWER_KEYLINE_RE = /^(要点：|大纲：|逐字稿：|英文大纲：|英文逐字稿：|题目中文：|中文翻译：|\d+\s*[.、．])/;

// AI 回答流（2026-10-11 用户方案）：不再单框替换——整个主区是回答的上下滚动列表，
// 每问一张卡片按顺序往下铺，新回答追加，绝不把没看完的旧回答顶走。
// 流式跟滚有前提：只有用户本来贴着底部才自动滚到底，往上翻旧回答时不拽视口。
const answersEl = document.getElementById('answers');
const answersEmpty = document.getElementById('answers-empty');
let answers = []; // { q, full, err, pending, el, qEl, bodyEl, stateEl }
let sessionReferenceAnswers = []; // 本场 AI 参考情境，仅用于避免复用案例，绝不进入候选人事实库
let curAns = null; // 当前正在生成/最新的那张卡片
let answerQText = ''; // 最近一次提问原文，随手机同步走（手机端 answerQ 字段仍保留）
const ANSWERS_CAP = 30; // 卡片上限，防止一场超长面试把 DOM 撑爆（记录里全量都有）
function answersNearBottom() {
  return answersEl.scrollHeight - answersEl.scrollTop - answersEl.clientHeight < 80;
}
function answersScrollBottom() {
  answersEl.scrollTop = answersEl.scrollHeight;
}
function addAnswerCard(question, follow) {
  answersEmpty.hidden = true;
  const card = document.createElement('div');
  card.className = 'answer-card anim'; // 入场动效（prefers-reduced-motion 下自动停）
  const head = document.createElement('div');
  head.className = 'answer-head';
  head.appendChild(document.createTextNode('AI 参考回答'));
  const stateEl = document.createElement('span');
  stateEl.className = 'answer-state';
  stateEl.textContent = '生成中…';
  head.appendChild(stateEl);
  const q = String(question || '').trim();
  const qEl = document.createElement('div');
  qEl.className = 'answer-q';
  qEl.hidden = !q;
  qEl.textContent = q ? '针对：' + q : '';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'answer-body';
  card.append(head, qEl, bodyEl);
  answersEl.appendChild(card);
  if (answers.length >= ANSWERS_CAP) answers.shift().el.remove();
  const item = { requestedAt: Date.now(), firstTokenMs: null, q, full: '', err: false, pending: true, el: card, qEl, bodyEl, stateEl };
  answers.push(item);
  // 2026-10-12 用户反馈「正在看的回答被新答案顶走」：新卡片出现不再自动滚——
  // 原地追加 + 亮「回到最新」，你看到哪就停在哪。只有用户自己点的提问才跟过去。
  if (follow) answersScrollBottom();
  updateJumpLatest();
  return item;
}
// 回到最新（P0-3）：翻旧回答且有内容时亮出按钮，点了直接回底部
const jumpLatest = document.getElementById('jump-latest');
function updateJumpLatest() {
  jumpLatest.hidden = answers.length === 0 || answersNearBottom();
}
answersEl.addEventListener('scroll', updateJumpLatest, { passive: true });
jumpLatest.addEventListener('click', () => { answersScrollBottom(); updateJumpLatest(); });
// 分层渲染（P0-2）：「大纲：」「逐字稿：」各自成块——大纲浅蓝底扫读，逐字稿独立
// 内衬 + 可折叠照念；没有段头的散行走无底色兜底块。实时流、手机端、归档回放共用。
// opts: { foldable, startCollapsed, onFold(collapsed) }
function buildAnswerSections(bodyEl, text, opts) {
  const o = opts || {};
  bodyEl.textContent = '';
  const lines = String(text).split('\n');
  if (!String(text).trim()) return;
  let cur = null; // { type, body }
  const startSec = (type, title) => {
    const sec = document.createElement('div');
    sec.className = 'ans-sec ans-' + type;
    if (title) {
      const tag = document.createElement('div');
      tag.className = 'sec-tag' + (type === 'script' && o.foldable ? ' foldable' : '');
      tag.appendChild(document.createTextNode(title));
      if (type === 'script' && o.foldable) {
        const arrow = document.createElement('span');
        arrow.className = 'fold-arrow';
        arrow.textContent = o.startCollapsed ? '▸' : '▾';
        tag.appendChild(arrow);
        tag.addEventListener('click', () => {
          const collapsed = sec.classList.toggle('collapsed');
          arrow.textContent = collapsed ? '▸' : '▾';
          if (o.onFold) o.onFold(collapsed);
        });
        if (o.startCollapsed) sec.classList.add('collapsed');
      }
      sec.appendChild(tag);
    }
    const body = document.createElement('div');
    body.className = 'sec-body';
    sec.appendChild(body);
    bodyEl.appendChild(sec);
    cur = { type, body };
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('大纲：')) { startSec('outline', '大纲'); continue; }
    if (t.startsWith('逐字稿：')) { startSec('script', '逐字稿 · 可照念'); continue; }
    if (t.startsWith('题目中文：')) { startSec('question-translation', '题目中文'); continue; }
    if (t.startsWith('英文大纲：')) { startSec('outline', '英文大纲'); continue; }
    if (t.startsWith('英文逐字稿：')) { startSec('script', '英文逐字稿 · 可照念'); continue; }
    if (t.startsWith('中文翻译：')) { startSec('translation', '中文翻译'); continue; }
    if (!cur) startSec('plain', '');
    const holder = cur.body;
    if (holder.childNodes.length) holder.appendChild(document.createElement('br'));
    // 逐字稿是照念的整段散文，编号高亮只在非逐字稿段生效
    if (cur.type !== 'script' && ANSWER_KEYLINE_RE.test(t)) {
      const b = document.createElement('b');
      b.className = 'keyline';
      b.textContent = line;
      holder.appendChild(b);
    } else {
      holder.appendChild(document.createTextNode(line));
    }
  }
}

function paintAnswer(item, text) {
  buildAnswerSections(item.bodyEl, text, { foldable: true, startCollapsed: item.scriptFold || false, onFold: (c) => { item.scriptFold = c; } });
}

// 面试官语音浮窗（2026-10-11 用户方案）：只在对方说话时盖在上方，停口自动收走；
// 转写照常进对话流（后台一直记录），「对话记录」按钮随时手动调出完整流。
// 句间停顿有 2.5s 余量：灰字清空但人还没接着说时浮窗不闪，保留最后一句定稿。
const ivFloat = document.getElementById('iv-float');
const ivFloatText = document.getElementById('iv-float-text');
let ivLastActive = 0; // 面试官最后一次发声（灰字或定稿）的时刻
let ivLastLine = ''; // 最后一句定稿：停顿间隙里浮窗显示它，避免闪烁
const IV_FLOAT_LINGER_MS = 2500;
function renderIvFloat() {
  const text = ivPartial.trim();
  const show = generating ? false : (!!text || Date.now() - ivLastActive < IV_FLOAT_LINGER_MS);
  ivFloat.hidden = !show;
  if (!show) return;
  // 半透明悬浮窗钉在工具条正下方：top 每次按工具条真实底边算，窗口缩放也不遮按钮
  const barRect = document.querySelector('.bar').getBoundingClientRect();
  ivFloat.style.top = Math.round(barRect.bottom + 8) + 'px';
  ivFloatText.textContent = text || ivLastLine;
  if (text) ivFloat.scrollTop = ivFloat.scrollHeight;
}

// 顶栏图标按钮（2026-10-11 用户反馈：图标代替文字，说明放 title 悬停可见）
// 注意 autoAsk 必须声明在这个块之前：renderAutoAsk() 在下面就会被立即执行一次（TDZ 教训）
let autoAsk = localStorage.autoAsk !== '0'; // 默认开：检测到问题自动生成回答
const autoaskBtn = document.getElementById('autoask-btn');
function renderAutoAsk() {
  autoaskBtn.classList.toggle('state-off', !autoAsk);
  autoaskBtn.title = autoAsk
    ? '自动识别：开——检测到问题自动生成回答'
    : '自动识别：关——只记录对方发言，由你点「就问这个」决定什么时候回答';
  if (phone.autoAsk !== autoAsk) { phone.autoAsk = autoAsk; phone.dirty = true; }
}
function toggleAutoAsk() {
  autoAsk = !autoAsk;
  localStorage.autoAsk = autoAsk ? '1' : '0';
  if (!autoAsk) clearTimeout(qTimer); // 关掉的一瞬撤掉已挂的自动触发
  recQueue.push({ t: now(), kind: 'diagnostic', code: 'mode-change', text: `自动识别${autoAsk ? '开启' : '关闭'}` });
  renderAutoAsk();
  renderQState(pendingKind(qBuf, ivPartial));
}
autoaskBtn.addEventListener('click', toggleAutoAsk);
renderAutoAsk();

const convBtn = document.getElementById('conv-btn');
let convShown = localStorage.convOpen !== '0'; // 默认展开：对话记录作为右侧侧栏常驻，手动收起后记住
function renderConvView() {
  // 对话记录：桌面为右侧常驻侧栏、手机为全屏覆盖层；hidden 即收起，主区永远是回答流——
  // 这样「我」和面试官的发言常驻可见，又能在需要全屏看回答时一键收起
  conv.hidden = !convShown;
  convBtn.classList.toggle('state-on', convShown);
}
function closeConv() { if (convShown) { convShown = false; renderConvView(); localStorage.convOpen = '0'; } }
convBtn.addEventListener('click', () => { convShown = !convShown; renderConvView(); localStorage.convOpen = convShown ? '1' : '0'; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConv(); });
renderConvView();

// 回答长度三档，默认「简洁」（手机一屏能读完），localStorage 持久化
let ansLen = localStorage.ansLen || 'short';
const lenSwitch = document.getElementById('len-switch');
function renderLen() {
  for (const b of lenSwitch.querySelectorAll('button')) b.classList.toggle('on', b.dataset.len === ansLen);
}
lenSwitch.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  ansLen = b.dataset.len;
  localStorage.ansLen = ansLen;
  renderLen();
});
renderLen();

function onInterviewerUtterance(text) {
  ctxHistory.push(text);
  const detected = selectCurrentQuestion(text, false);
  if (/(英语语言能力|英语口语|用英文作答|用英语作答|请用英语|answer (?:in|using) English|respond in English|speak in English)/i.test(text)) {
    answerLanguage = 'en'; answerLanguageReason = 'explicit-interviewer-instruction';
  } else if (/(英语语言能力|中文作答|用中文回答|请用中文|answer (?:in|using) Chinese|respond in Chinese|speak in Chinese)/i.test(text)) {
    answerLanguage = 'zh'; answerLanguageReason = 'explicit-interviewer-instruction';
  } else if (detected) {
    // 没有明确语言指令时，每题跟随题目主要语言；纯听力陈述不会被当成问题处理。
    const latinCount = (detected.match(/[A-Za-z]/g) || []).length;
    const hanCount = (detected.match(/[\u4e00-\u9fff]/g) || []).length;
    answerLanguage = latinCount > Math.max(12, hanCount * 1.2) ? 'en' : 'zh';
    answerLanguageReason = 'inferred-from-question-language';
  }
  recQueue.push({ t: now(), kind: 'diagnostic', code: 'question-decision', text: `面试官定稿｜${autoAsk ? '自动' : '手动'}模式｜${detected ? '识别为问题' : '未触发'}｜语言=${answerLanguage}(${answerLanguageReason})｜${String(text).slice(0, 180)}` });
  if (autoAsk && isNonQuestion(text)) {
    // A backchannel during the stitching window leaves that question's timer intact.
    if (!isBackchannel(text) || !qBuf.length) { clearTimeout(qTimer); qByContent = false; }
    if (!isBackchannel(text)) qBuf = [];
    renderQState();
    return;
  }
  if (ctxHistory.join(' ').length > 1500) ctxHistory = ctxHistory.slice(-6);
  // 判停后 ASR 迟到的定稿对账：完全重复 → 吞掉；是已发问题的前缀延伸（灰字滞后，
  // 定稿把句子补全了）→ 用完整问题重发，旧回答按 askId 自动作废。手动模式下没有
  // 「已发问题」这回事，直接当普通发言累积。
  const nf = normText(text), lf = normText(lastFired);
  if (autoAsk && lf && Date.now() - firedAt < REFIRE_GRACE_MS) {
    if (lf.includes(nf) && nf.length >= 6) return;
    if (nf.startsWith(lf)) { qBuf = []; fireAsk(text); return; }
  }
  qBuf.push(text);
  // 手动模式下没有自动发射来清空 qBuf，一场长面试会无限涨——超长就丢最老的，
  // 「就问这个」永远只发最近的内容（正常模式每次 fireAsk 都清空，不受影响）
  if (qBuf.join('').length > 800) qBuf = qBuf.slice(-3);
  // 手动模式：只累积，不定时器，状态条讲清楚「已记录、等你发令」
  if (!autoAsk) { clearTimeout(qTimer); renderQState('manual'); return; }
  // 拍板依据换成内容（2026-09-30）：最后一句本身就是完整问句 → 只等一个很短的拼接窗口；
  // 否则才退回静音阈值兜底。灰字非空说明还有话没定稿，这时不抢发。
  const kind = pendingKind(qBuf, ivPartial);
  const byContent = !ivPartial.trim() && !!contentFireDelay(qBuf, ivPartial);
  scheduleFire(kind, byContent);
}

// 定时器集中在这里管：内容触发和静音兜底共用一个槽位，谁后设谁生效
function scheduleFire(kind, byContent) {
  clearTimeout(qTimer);
  qByContent = !!byContent;
  qTimer = setTimeout(() => fireAsk(ivPartial), byContent ? CONTENT_FIRE_MS : silenceThreshold(kind));
  renderQState(kind, qByContent);
}

// 判停状态条：告诉用户「现在为什么还没发答案」，并给一个手动触发按钮兜底
const qBar = document.getElementById('q-bar');
const qStateEl = document.getElementById('q-state');
const stopBtn = document.getElementById('stop-answer');
const askNowBtn = document.getElementById('ask-now');
let generating = false; // 有回答正在流式生成
// 「关闭自动识别问题」开关的行为逻辑见上面 autoask 块：关掉后系统只记录对方发言、
// 不再自动触发回答，什么时候要答案由用户点「就问这个」（或 ⌃⌥Space / 手机端 ⚡）自己判断。
function renderQState(kind, byContent) {
  const hasPending = qBuf.length > 0 || !!ivPartial.trim();
  // 手动模式（2026-10-11 开关）：系统只记录不抢答，状态条要把这个约定讲清楚
  let label = autoAsk
    ? stateLabel(kind || pendingKind(qBuf, ivPartial), hasPending, !!byContent)
    : (hasPending ? '手动模式：对方发言已记录，点「就问这个」生成回答' : '手动模式：AI 只在你点「就问这个」时回答');
  if (generating) label = '正在生成回答…';
  qStateEl.textContent = label;
  const previewEl = document.getElementById('q-preview');
  const pendingText = [qBuf.join(' '), ivPartial].filter(Boolean).join(' ').trim();
  const preview = pendingText ? (selectCurrentQuestion(pendingText, false) || pendingText) : '';
  const previewLabel = preview ? '待处理：' + preview : '';
  if (previewEl) previewEl.textContent = previewLabel;
  if (phone.qpreview !== previewLabel) { phone.qpreview = previewLabel; phone.dirty = true; }
  // 手动模式（P1-4）：琥珀边 + 「手动」徽标，不用悬停 ⚡ 也知道自动识别已关
  qBar.classList.toggle('manual', !autoAsk);
  document.getElementById('manual-badge').hidden = !!autoAsk;
  // 手机端状态条跟着变，但只有文案真的变了才标脏——静音循环每 200ms 调一次，无条件标脏会一直空转同步
  if (phone.qstate !== label) { phone.qstate = label; phone.dirty = true; }
  qBar.hidden = !label;
  stopBtn.hidden = !generating;   // 只在生成时出现
  askNowBtn.hidden = false;       // 生成中也亮着：点了就是打断当前回答、改问最新的
}
// 两个动作抽成函数：按钮和全局快捷键（⌃⌥Enter / ⌃⌥X）走同一条路
function askNow() {
  clearTimeout(qTimer);
  const pendingText = [qBuf.join(' '), ivPartial].filter(Boolean).join(' ').trim();
  const pendingQuestion = selectCurrentQuestion(pendingText, true) || lastFired;
  if (generating && normText(pendingQuestion) === normText(lastFired)) {
    recQueue.push({ t: now(), kind: 'diagnostic', code: 'duplicate-request', text: '手动触发与正在生成的问题相同，沿用当前请求' });
    renderQState('question');
    return;
  }
  userAsked = true; // 用户主动发问：新回答卡片可以带走视口（自己点的，跟过去是预期）
  // 生成中再催单 = 打断当前回答直接改问（2026-10-10 用户反馈）：先掐掉旧流，
  // 迟到的增量/完成事件按 askId 自动作废，不会污染新回答
  if (generating) {
    window.assist.cancelAsk(askId);
    generating = false;
  }
  fireAsk(ivPartial);
  renderQState('question');
}
function stopAnswer() {
  if (!generating) return; // 没在生成就没东西可停
  window.assist.cancelAsk(askId);
  generating = false;
  if (curAns) { curAns.pending = false; curAns.stateEl.textContent = '已停止'; }
  phone.pending = false; phone.dirty = true;
  renderQState();
}
// 手动触发：自动判停再聪明也有判错的时候，用户看着时机对了就自己按
document.getElementById('ask-now').addEventListener('click', askNow);
stopBtn.addEventListener('click', stopAnswer);
// 全局快捷键：会议全屏时窗口拿不到焦点，靠主进程转发过来
window.assist.onHotkey((action) => {
  if (action === 'stop') stopAnswer();
  else if (action === 'ask') askNow();
});

async function fireAsk(extra) {
  const parts = [];
  if (qBuf.length) parts.push(qBuf.join(' '));
  const tail = String(extra || '').trim();
  if (tail) parts.push(tail);
  qBuf = [];
  ivPartial = '';
  qByContent = false; // 已发出去，内容拍板这个状态也一起清掉
  renderQState(); // 已发出去，状态条收起
  const rawQuestion = parts.join(' ').trim() || (userAsked ? lastFired : '');
  const question = selectCurrentQuestion(rawQuestion, userAsked);
  if (!question) { recQueue.push({ t: now(), kind: 'diagnostic', code: 'question-dropped', text: `没有提取到可回答的问题：${rawQuestion.slice(0, 180)}` }); userAsked = false; return; }
  if (generating && normText(question) === normText(lastFired)) {
    recQueue.push({ t: now(), kind: 'diagnostic', code: 'duplicate-request', text: `重复问题沿用当前请求：${question.slice(0, 180)}` });
    userAsked = false;
    return;
  }
  if (!userAsked && normText(question) === normText(lastFired)) return;
  lastFired = question;
  firedAt = Date.now();
  recQueue.push({ t: now(), kind: 'question', text: question, rawQuestion, trigger: userAsked ? 'manual' : (isCompleteQuestion(question) ? 'complete-question' : 'silence-question') });
  echoFilter.flush();
  const focus = questionIntent(question);
  // Keep enough recent answer context to make repeated prompts and follow-ups
  // visibly different, while keeping the request bounded for live latency.
  const referenceHistory = sessionReferenceAnswers.slice(-8);
  const followup = { focus, isFollowup: referenceHistory.length > 0 && focus !== 'general' };
  lastAsk = { question, context: conversationContext.text(), facts: recentEvidence(conversationContext.evidence()), len: ansLen, followup, referenceHistory, answerLanguage, answerLanguageReason };
  recQueue.push({ t: now(), kind: 'diagnostic', code: 'answer-request', text: `生成请求｜焦点=${focus}｜语言=${answerLanguage}｜上下文=${lastAsk.context.length}字｜事实=${lastAsk.facts.length}字｜资料会按题目筛选` });
  launchAnswer(question, lastAsk.context, lastAsk.len, userAsked, lastAsk.facts, lastAsk);
  userAsked = false; // 跟随意图一次性消费：自动识别出的新回答不抢视口
}

// 发射回答的公共尾部：fireAsk 和「凭据晚到补答」共用，保证状态置位完全一致
function launchAnswer(question, context, len, follow, facts, metadata = {}) {
  // 新问题替换当前请求时，终止旧流，避免不可见的旧回答继续占用生成资源。
  if (generating) {
    window.assist.cancelAsk(askId);
    if (curAns) { curAns.pending = false; curAns.stateEl.textContent = '已被新问题替换'; }
  }
  askId += 1;
  curAns = addAnswerCard(question, follow); // 新卡片追加进回答流，旧回答原地保留
  answerQText = curAns.q;
  generating = true;
  ivLastActive = 0; // AI 开始生成：面试官浮窗立即收走（2026-10-10 用户方案）
  renderIvFloat();
  renderQState(); // 状态条切到「正在生成回答…」并亮出停止按钮
  phone.answer = ''; phone.answerErr = false; phone.pending = true; phone.dirty = true;
  window.assist.ask({ askId, question, context, facts, len, trigger: follow ? 'manual' : 'auto', followup: metadata.followup || {}, referenceHistory: metadata.referenceHistory || [], answerLanguage: metadata.answerLanguage || answerLanguage });
}

// 凭据晚到补答（2026-10-10 采纳）：提问时凭据还没导入好会吃一次「未找到方舟凭据」，
// 之前这问就废了。现在把问题留底，凭据一到就自动重发，不再要求用户重新说一遍。
let lastAsk = null;
let arkRetryPending = false;

// 静音判停（现在是**兜底**）：内容没拍板时，面试官声道没声音超过阈值且还有未发送内容 → 提问。
// 静音只确认提问已结束，不把背景陈述转成问题。
// 以及 ASR 一直不给句末标点的场景；正常问句由内容判定在 300ms 内就发了。
setInterval(() => {
  if (!autoAsk) return; // 手动模式：静音兜底也停，一切等用户发令
  const st = CHANNELS[0].state;
  if (!st || !st.lastSignalTs) return;
  if (!qBuf.length && !ivPartial.trim()) return;
  // 静音阈值同样按内容分档：问句几乎立刻发，背景/半句话要静音更久才发
  const kind = pendingKind(qBuf, ivPartial);
  if (Date.now() - st.lastSignalTs < silenceThreshold(kind)) { renderQState(kind, qByContent); return; }
  if (kind !== 'question' && !selectCurrentQuestion(ivPartial, false)) return;
  fireAsk(ivPartial);
}, 200);

window.assist.onLlmDelta((p) => {
  if (p.arkReady) { // 凭据晚到，解除「不可用」横幅并回填模型
    banner.hidden = true;
    window.assist.models().then((m) => fillModels(m.current));
    // 刚才因缺凭据失败的那问还在屏幕上挂着 → 自动补发（生成中就别抢，等下一问）
    if (arkRetryPending && lastAsk && !generating) {
      arkRetryPending = false;
      launchAnswer(lastAsk.question, lastAsk.context, lastAsk.len, false, lastAsk.facts, lastAsk);
    }
    return;
  }
  if (p.arkFailed) { // 导入失败不再静默：横幅说明原因，主进程 30s 后会自动重试一次
    showCredentialError(p.message || '凭据读取失败，请检查钥匙串授权后重试');
    return;
  }
  if (p.modelsChanged) { // 手机端切了模型：桌面下拉回填成新 current，别让轮询把旧值推回去
    window.assist.models().then((m) => fillModels(m.current));
    return;
  }
  if (p.askId !== askId) return; // 旧请求的迟到增量
  const item = curAns; // askId 校验过了，卡片就是当前这张
  if (p.stage) {
    item.stateEl.textContent = p.stage;
    phone.qstate = p.stage; phone.dirty = true;
    return;
  }
  if (p.error) {
    generating = false;
    item.err = true; item.pending = false;
    item.el.classList.add('err'); // 错误态做在卡片框上，红边一眼可见
    item.full = p.error;
    if (p.needArk) arkRetryPending = true; // 等凭据就绪自动补发
    paintAnswer(item, item.full);
    item.stateEl.textContent = '';
    phone.answer = p.error; phone.answerErr = true; phone.pending = false; phone.dirty = true;
    recQueue.push({ t: now(), kind: 'error', text: p.error });
    return;
  }
  if (p.delta) {
    if (item.firstTokenMs === null) {
      item.firstTokenMs = Date.now() - item.requestedAt;
      item.stateEl.textContent = '首字 ' + (item.firstTokenMs / 1000).toFixed(1) + ' 秒 · 生成中';
    }
    item.full += p.delta;
    const stick = answersNearBottom(); // 用户贴底才跟滚，翻旧回答时别拽走
    paintAnswer(item, item.full);
    if (stick) answersScrollBottom();
    updateJumpLatest();
    phone.answer = item.full; phone.dirty = true;
  }
  if (p.done) {
    generating = false;
    item.pending = false;
    item.stateEl.textContent = p.stopped ? '已停止' : (item.firstTokenMs === null ? '' : '首字 ' + (item.firstTokenMs / 1000).toFixed(1) + ' 秒');
    phone.pending = false; phone.dirty = true;
    renderQState();
    if (item.full) {
      recQueue.push({ t: now(), kind: 'answer', text: item.full });
      if (!p.stopped) sessionReferenceAnswers.push({ question: item.q, answer: item.full });
    }
  }
});

// 「我」的内容按时间穿插在流里，但面试时可以一键隐掉，只看面试官和 AI（图标开关）。
// 与「自动识别」同款逻辑：开启是常态（默认显示），点一下关闭；关闭态用 state-off 变暗 + 「关」角标。
const showMeBtn = document.getElementById('show-me');
let showMe = localStorage.showMe !== '0'; // 默认开：显示我说的话
function renderShowMe() {
  document.body.classList.toggle('hide-me', !showMe);
  showMeBtn.classList.toggle('state-off', !showMe); // 关闭态变暗，和「自动识别」一致
  showMeBtn.title = showMe
    ? '显示我说的话：开——对话里能看到我的每句话'
    : '显示我说的话：关——对话里只显示面试官，不显示我的话';
}
showMeBtn.addEventListener('click', () => {
  showMe = !showMe;
  localStorage.showMe = showMe ? '1' : '0';
  renderShowMe();
});
renderShowMe();

// 桌面字号调节（P1-7）：A−/A+ 调 --fs-adj，回答和对话一起缩，localStorage 持久化
let fsAdj = parseInt(localStorage.fsAdj || '0', 10) || 0;
function applyFsAdj() { document.body.style.setProperty('--fs-adj', fsAdj + 'px'); }
function bumpFs(d) {
  fsAdj = Math.max(-3, Math.min(6, fsAdj + d));
  localStorage.fsAdj = String(fsAdj);
  applyFsAdj();
}
document.getElementById('fs-minus').addEventListener('click', () => bumpFs(-1));
document.getElementById('fs-plus').addEventListener('click', () => bumpFs(1));
applyFsAdj();

document.getElementById('qr-btn').addEventListener('click', () => window.assist.showQr());
// ---- 记录：在软件里按场次列表 + 对话呈现（不再让人去翻 Markdown 文件）----
const recModal = document.getElementById('rec-modal');
const recList = document.getElementById('rec-list');
const recConv = document.getElementById('rec-conv');
const recMeta = document.getElementById('rec-meta');
const KIND_NAME = { interviewer: '面试官', me: '我', question: '问题', answer: 'AI 回答', error: '错误' };

function renderRecConv(entries) {
  recConv.textContent = '';
  if (!entries.length) {
    recConv.textContent = '（这一场没有记录内容）';
    return;
  }
  for (const e of entries) {
    if (e.kind === 'diagnostic') continue;
    const kind = e.kind === 'answer' ? 'ai' : (e.kind === 'me' ? 'me' : 'iv');
    const item = document.createElement('div');
    item.className = 'conv-item ' + kind;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = e.t || '';
    item.appendChild(t);
    if (kind === 'ai') {
      const head = document.createElement('div');
      head.className = 'ai-head';
      head.textContent = KIND_NAME[e.kind];
      item.appendChild(head);
      const body = document.createElement('div');
      body.className = 'answer-text';
      // 归档回放复用实时界面的分层渲染（大纲/逐字稿成块），不带折叠
      buildAnswerSections(body, String(e.text || ''), { foldable: false });
      item.appendChild(body);
    } else {
      item.appendChild(document.createTextNode(String(e.text || '')));
    }
    recConv.appendChild(item);
  }
  recConv.scrollTop = 0;
}

async function openRecords() {
  const list = await window.assist.recordList();
  recList.textContent = '';
  if (!list.length) {
    recList.textContent = '还没有记录（开始一场面试后会自动生成）';
    recConv.textContent = '';
    recMeta.textContent = '';
    recModal.hidden = false;
    return;
  }
  for (const s of list) {
    const item = document.createElement('button');
    item.className = 'rec-item';
    const title = document.createElement('strong');
    title.textContent = s.title;
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = s.when || s.id.replace(/^interview-/, '').replace(/\.jsonl$/, '').replace(/_/g, ' ');
    item.appendChild(title);
    item.appendChild(when);
    item.addEventListener('click', async () => {
      for (const el of recList.querySelectorAll('.rec-item')) el.classList.remove('on');
      item.classList.add('on');
      const entries = await window.assist.recordRead(s.id);
      renderRecConv(entries);
      recMeta.textContent = entries.length + ' 条';
    });
    recList.appendChild(item);
  }
  recModal.hidden = false;
  recList.querySelector('.rec-item').click();
}
document.getElementById('rec-btn').addEventListener('click', openRecords);
document.getElementById('rec-close').addEventListener('click', () => { recModal.hidden = true; });
document.getElementById('rec-folder').addEventListener('click', () => window.assist.openRecords());
recModal.addEventListener('click', (e) => { if (e.target === recModal) recModal.hidden = true; });

detectDevices();
// 模型切换：列表抄自 ScreenRelay 注册表；凭据晚到时 arkReady 分支会再回填一次
const modelSelect = document.getElementById('model-select');
function fillModels(current) {
  if (!current) return;
  if (!modelSelect.querySelector('option[value="' + current + '"]')) {
    const o = document.createElement('option');
    o.value = current;
    o.textContent = current;
    modelSelect.appendChild(o);
  }
  modelSelect.value = current;
}
modelSelect.addEventListener('change', async () => {
  const r = await window.assist.setModel(modelSelect.value);
  if (!r.ok) showBanner('切换模型失败：' + (r.error || '未知原因'));
});
window.assist.models().then((m) => {
  for (const id of m.all) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    modelSelect.appendChild(o);
  }
  if (!m.current) window.assist.arkStatus().then(status => {
    if (status.loading) showBanner('正在读取加密凭据，其他界面功能可正常使用…');
    else if (!status.ok) showCredentialError(status.error || '尚未读取到模型凭据，请配置模型后重试');
  });
  else fillModels(m.current);
});

// 我的档案：打开时从主进程取当前值，保存写回 ark.enc（只影响本应用）
const profileModal = document.getElementById('profile-modal');
const profileText = document.getElementById('profile-text');
const profileSaved = document.getElementById('profile-saved');
function closeProfile() { profileModal.hidden = true; }
document.getElementById('profile-btn').addEventListener('click', async () => {
  profileText.value = await window.assist.getProfile();
  profileSaved.textContent = '';
  profileModal.hidden = false;
  profileText.focus();
});
document.getElementById('profile-cancel').addEventListener('click', closeProfile);
profileModal.addEventListener('click', (e) => { if (e.target === profileModal) closeProfile(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !profileModal.hidden) closeProfile(); });
document.getElementById('profile-save').addEventListener('click', async () => {
  const r = await window.assist.setProfile(profileText.value);
  if (r.ok) {
    // 整份随发，不再截断；但每问都要重发一遍，所以长的代价要如实说在明面上
    profileSaved.textContent = profileText.value.length > 6000
      ? '已保存（档案会整份随每问发送，越长出答案越慢）'
      : '已保存';
    setTimeout(closeProfile, 400); // 保存完自动关闭，不用再点一次取消
  } else {
    profileSaved.textContent = r.error || '保存失败';
  }
});

// 目标岗位（2026-10-10）：每场面试可导入一份 JD，回答对着它优化。按钮带 ✓ 提示当前已设置。
const jdBtn = document.getElementById('jd-btn');
const jdModal = document.getElementById('jd-modal');
const jdText = document.getElementById('jd-text');
const jdSaved = document.getElementById('jd-saved');
function renderJdBadge(on) { // 图标按钮：已设置用绿点提示，说明都在 title 悬停里
  jdBtn.classList.toggle('has-jd', !!on);
  jdBtn.title = on
    ? '目标岗位：已设置（点击查看/修改，清除后恢复通用回答）'
    : '目标岗位：粘贴岗位介绍（JD），AI 回答对着这个岗位优化';
}
function closeJd() { jdModal.hidden = true; }
jdBtn.addEventListener('click', async () => {
  jdText.value = await window.assist.getJd();
  renderJdBadge(!!jdText.value.trim());
  jdSaved.textContent = '';
  jdModal.hidden = false;
  jdText.focus();
});
document.getElementById('jd-cancel').addEventListener('click', closeJd);
document.getElementById('jd-clear').addEventListener('click', async () => {
  const r = await window.assist.setJd('');
  if (r.ok) { renderJdBadge(false); jdText.value = ''; jdSaved.textContent = '已清除，回答恢复通用'; }
});
jdModal.addEventListener('click', (e) => { if (e.target === jdModal) closeJd(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !jdModal.hidden) closeJd(); });
document.getElementById('jd-save').addEventListener('click', async () => {
  const r = await window.assist.setJd(jdText.value);
  if (r.ok) {
    renderJdBadge(!!jdText.value.trim());
    jdSaved.textContent = '已保存（每条回答都会对着这个岗位优化）';
    setTimeout(closeJd, 600);
  } else {
    jdSaved.textContent = r.error || '保存失败';
  }
});
window.assist.getJd().then((v) => renderJdBadge(!!String(v || '').trim())); // 启动时回填按钮状态

// 原生窗口透明度 + 置顶，状态以主进程返回值为准。
const floatingBtn = document.getElementById('floating-btn');
function renderFloating(on) {
  floatingBtn.classList.toggle('state-on', on);
  floatingBtn.setAttribute('aria-pressed', String(on));
  floatingBtn.title = on
    ? '半透明置顶：开——点击恢复普通窗口'
    : '半透明置顶：关——点击开启 85% 不透明度并保持在最前面';
}
window.assist.floatingStatus().then(renderFloating).catch(() => {});
floatingBtn.addEventListener('click', async () => {
  floatingBtn.disabled = true;
  try {
    renderFloating(await window.assist.setFloating(floatingBtn.getAttribute('aria-pressed') !== 'true'));
  } catch (_) { showBanner('窗口悬浮切换失败，请重试'); }
  finally { floatingBtn.disabled = false; }
});

setInterval(() => {
  if (generating && curAns && curAns.pending && curAns.firstTokenMs === null) {
    curAns.stateEl.textContent = '等待首字 ' + ((Date.now() - curAns.requestedAt) / 1000).toFixed(1) + ' 秒';
  }
}, 200);
