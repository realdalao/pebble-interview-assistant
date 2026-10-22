// recorder.cjs — 每场面试的落盘管理（主进程专用，依赖 electron.app）。
// 一个会话 = interview-logs/<时间戳>/ 文件夹，内含：
//   transcript.jsonl        原始记录（机器可读，也喂给软件内「记录」回放）
//   audio.wav              双声道原始录音（L=面试官 16k / R=我 16k，全程）
//   transcript-full.html   三栏转录（含 AI 参考回答）
//   transcript-conversation.html  两栏转录（仅面试官 + 我）
// 两路 PCM 先各写一份临时 .pcm（按绝对帧定位，静音处补零），结束时再交错成 WAV，
// 这样两声道时基对齐、内存占用 O(1)（不把整场录音都装在内存里）。

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { buildTranscriptHtml } = require('./transcript.cjs');

const RATE = 16000; // 16k，与 ASR 同源
let current = null; // { id, dir, jsonlFd, ivFd, meFd, ivWrite, meWrite, startTs }

function logErr(e) { try { console.log('[rec]', String((e && e.stack) || e).slice(0, 240)); } catch (_) {} }

function recordDir() {
  return path.join(app.getPath('userData'), 'interview-logs');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// 懒创建会话：无论「开始面试」「第一条文字」「第一帧音频」谁先到，都复用同一时间戳文件夹
function ensureSession() {
  if (current) return current;
  const id = stamp();
  const dir = path.join(recordDir(), id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const jsonlFd = fs.openSync(path.join(dir, 'transcript.jsonl'), 'a');
  // 'w+' 才可读回（结束时要读临时 pcm 交错成 WAV）
  const ivFd = fs.openSync(path.join(dir, '.iv.pcm'), 'w+');
  const meFd = fs.openSync(path.join(dir, '.me.pcm'), 'w+');
  current = { id, dir, jsonlFd, ivFd, meFd, ivWrite: 0, meWrite: 0, startTs: Date.now() };
  console.log('[rec] session start', id, dir);
  return current;
}

function readEntries(p) {
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}

// 把任意文本清洗成合法文件夹名片段：非法字符→空格、折叠空白、截断到 maxLen
function sanitizeForName(s, maxLen) {
  return String(s)
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// 无 AI 时的兜底标题（仅当 AI 主题生成不可用才走到）：取首句前 24 字
function deriveSlug(entries) {
  const pick = (kinds) => {
    for (const e of entries) {
      if (kinds.includes(e.kind) && e.text) {
        const t = sanitizeForName(e.text, 24);
        if (t) return t;
      }
    }
    return '';
  };
  return pick(['question', 'interviewer']) || pick(['me']);
}

// 读取当前会话已落盘的记录（不结束会话），供主进程先拿去生成 AI 标题
function peekEntries() {
  if (!current) return null;
  return readEntries(path.join(current.dir, 'transcript.jsonl'));
}

// 重命名文件夹，目标已存在则追加 -2 / -3 避免覆盖（同一秒内结束且首句相同才可能撞）
function safeRename(oldDir, newDir) {
  if (oldDir === newDir) return newDir;
  let target = newDir;
  let i = 2;
  while (fs.existsSync(target)) { target = newDir + '-' + i; i++; }
  try { fs.renameSync(oldDir, target); return target; } catch (err) { logErr(err); return oldDir; }
}

function append(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const s = ensureSession();
  for (const e of entries) {
    try { fs.writeSync(s.jsonlFd, JSON.stringify(e) + '\n'); } catch (err) { logErr(err); }
  }
}

// ArrayBuffer / Buffer → Int16 小端样本数组（避免 Node Buffer 池/byteOffset 陷阱，逐字节读最稳）
function toInt16(pcm) {
  const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  const n = Math.floor(buf.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

// 把某声道的一帧 PCM 写到它的临时文件：按「绝对帧位置」落盘，迟到/早到都不串时基；
// 该声道两帧之间的空档填零（即该声道当时的静音）。
function addAudio(channel, pcm) {
  const s = ensureSession();
  const samples = toInt16(pcm);
  if (!samples.length) return;
  const fd = channel === 'me' ? s.meFd : s.ivFd;
  const w = channel === 'me' ? s.meWrite : s.ivWrite;
  // 以绝对帧定位；clamp 到当前游标之后，避免迟到/乱序分块回写覆盖已落盘的样本
  const startFrame = Math.max(w, Math.round((Date.now() - s.startTs) / 1000 * RATE));
  const gap = startFrame - w; // 该声道相对于上次的空档（静音），应为 ≥0
  try {
    if (gap > 0) {
      let remaining = gap;
      let base = w;
      while (remaining > 0) {
        const n = Math.min(remaining, RATE * 60); // 单个补零块上限 60s，循环覆盖更长空档
        fs.writeSync(fd, Buffer.alloc(n * 2), 0, n * 2, base * 2);
        base += n;
        remaining -= n;
      }
    }
    const pos = Math.max(w, startFrame) * 2;
    const buf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    fs.writeSync(fd, buf, 0, buf.length, pos);
    const end = Math.max(w, startFrame) + samples.length;
    if (channel === 'me') s.meWrite = end; else s.ivWrite = end;
  } catch (err) { logErr(err); }
}

// 两路临时 pcm → 流式交错成 16k/16bit/立体声 WAV（L=面试官 / R=我），逐块读回，内存 O(块)
function writeWav(outPath, ivFd, meFd, ivWrite, meWrite, total) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + total * 4, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // 2 声道
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28); // byte rate = sr*ch*bytes
  header.writeUInt16LE(4, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write('data', 36);
  header.writeUInt32LE(total * 4, 40);

  const out = fs.openSync(outPath, 'w');
  fs.writeSync(out, header, 0, 44);
  const FR = RATE * 2; // 2s 一块
  const ivBuf = Buffer.alloc(FR * 2);
  const meBuf = Buffer.alloc(FR * 2);
  const inter = Buffer.alloc(FR * 4);
  let ivPos = 0;
  let mePos = 0;
  while (ivPos < total || mePos < total) {
    const need = Math.min(FR, total - Math.max(ivPos, mePos));
    ivBuf.fill(0);
    meBuf.fill(0);
    const ivRead = Math.min(need, ivWrite - ivPos);
    if (ivRead > 0) fs.readSync(ivFd, ivBuf, 0, ivRead * 2, ivPos * 2);
    const meRead = Math.min(need, meWrite - mePos);
    if (meRead > 0) fs.readSync(meFd, meBuf, 0, meRead * 2, mePos * 2);
    for (let i = 0; i < need; i++) {
      inter.writeInt16LE(ivBuf.readInt16LE(i * 2), i * 4);
      inter.writeInt16LE(meBuf.readInt16LE(i * 2), i * 4 + 2);
    }
    fs.writeSync(out, inter, 0, need * 4);
    ivPos += need;
    mePos += need;
  }
  fs.closeSync(out);
}

// 结束一场：收尾 WAV + 两个 HTML + 清理临时文件；空场（无记录无音频）直接删文件夹。
// titleOverride：主进程用 AI 总结好的整场主题（可能含公司/岗位），优先用作文件夹名与 HTML 标题；
// 不传或清洗后为空时回退到 deriveSlug（首句兜底）。
function endSession(titleOverride) {
  const s = current;
  if (!s) return null;
  current = null;
  try { fs.closeSync(s.jsonlFd); } catch (_) {}
  const total = Math.max(s.ivWrite, s.meWrite);
  const entries = readEntries(path.join(s.dir, 'transcript.jsonl'));
  if (entries.length === 0 && total === 0) {
    try { fs.closeSync(s.ivFd); fs.closeSync(s.meFd); } catch (_) {}
    try { fs.unlinkSync(path.join(s.dir, '.iv.pcm')); } catch (_) {}
    try { fs.unlinkSync(path.join(s.dir, '.me.pcm')); } catch (_) {}
    try { fs.rmdirSync(s.dir); } catch (_) {}
    return null;
  }
  try {
    if (total > 0) writeWav(path.join(s.dir, 'audio.wav'), s.ivFd, s.meFd, s.ivWrite, s.meWrite, total);
  } catch (err) { logErr(err); }
  try { fs.closeSync(s.ivFd); fs.closeSync(s.meFd); } catch (_) {}
  try { fs.unlinkSync(path.join(s.dir, '.iv.pcm')); } catch (_) {}
  try { fs.unlinkSync(path.join(s.dir, '.me.pcm')); } catch (_) {}
  // 命名优先级：AI 主题标题 > 首句兜底；都带时间戳前缀以保排序与防重
  const aiTitle = titleOverride ? sanitizeForName(titleOverride, 40) : '';
  const slug = aiTitle || deriveSlug(entries);
  if (slug) {
    const newDir = safeRename(s.dir, path.join(recordDir(), s.id + '_' + slug));
    if (newDir !== s.dir) { s.dir = newDir; s.id = path.basename(newDir); }
  }
  const hTitle = aiTitle || slug || '面试记录';
  try {
    fs.writeFileSync(path.join(s.dir, 'transcript-full.html'), buildTranscriptHtml(entries, { includeAi: true, title: hTitle }));
    fs.writeFileSync(path.join(s.dir, 'transcript-conversation.html'), buildTranscriptHtml(entries, { includeAi: false, title: hTitle }));
  } catch (err) { logErr(err); }
  console.log('[rec] session end', s.id, 'entries', entries.length, 'audioFrames', total, 'aiTitle', !!aiTitle);
  return s.dir;
}

module.exports = { ensureSession, append, addAudio, endSession, peekEntries, recordDir };

// Private local diagnostics are separate from transcripts/HTML. Never write credentials.
// Capture the active session so late completions cannot create a new interview.
function diagnosticWriter(meta) {
  const session = ensureSession();
  const requestId = require('crypto').randomUUID();
  return event => {
    if (current !== session) return;
    try { fs.appendFileSync(path.join(session.dir, 'answer-diagnostics.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...meta, requestId, ...event }) + '\n', { mode: 0o600 }); } catch (e) { logErr(e); }
  };
}
module.exports.diagnosticWriter = diagnosticWriter;
