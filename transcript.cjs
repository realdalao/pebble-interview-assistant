// transcript.cjs — 把一场面试的 JSONL 记录渲染成自包含的三栏 HTML。
// 纯函数、零依赖，可脱离 Electron 单测（与 prompt.cjs 同款约定）。
// 两种输出：
//   includeAi: true  → 面试官(左) / AI 参考回答(中) / 我(右)，三栏
//   includeAi: false → 面试官(左) / 我(右)，两栏（不含 AI 参考答案）

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 与渲染层 app.js 的 ANSWER_KEYLINE_RE 同款：扫读锚点行（编号大纲 / 大纲：/ 逐字稿：/ 要点：）
const KEYLINE_RE = /^(要点：|大纲：|逐字稿：|英文大纲：|英文逐字稿：|题目中文：|中文翻译：|\d+\s*[.、．])/;

// AI 回答按段头分层（大纲浅蓝 / 逐字稿可照念 / 散句兜底），与实时界面同构
function splitSections(text) {
  const lines = String(text).split('\n');
  const secs = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('题目中文：')) { cur = { type: 'question-translation', title: '题目中文', body: [] }; secs.push(cur); continue; }
    if (t.startsWith('英文大纲：')) { cur = { type: 'outline', title: '英文大纲', body: [] }; secs.push(cur); continue; }
    if (t.startsWith('英文逐字稿：')) { cur = { type: 'script', title: '英文逐字稿 · 可照念', body: [] }; secs.push(cur); continue; }
    if (t.startsWith('中文翻译：')) { cur = { type: 'translation', title: '中文翻译', body: [] }; secs.push(cur); continue; }
    if (t.startsWith('大纲：')) { cur = { type: 'outline', title: '大纲', body: [] }; secs.push(cur); continue; }
    if (t.startsWith('逐字稿：')) { cur = { type: 'script', title: '逐字稿 · 可照念', body: [] }; secs.push(cur); continue; }
    if (!cur) { cur = { type: 'plain', title: '', body: [] }; secs.push(cur); }
    cur.body.push(line);
  }
  return secs;
}

function renderAi(text) {
  const secs = splitSections(text);
  let h = '';
  for (const s of secs) {
    h += '<div class="sec sec-' + s.type + '">';
    if (s.title) h += '<div class="sec-tag">' + esc(s.title) + '</div>';
    h += '<div class="sec-body">';
    for (const ln of s.body) {
      if (s.type !== 'script' && KEYLINE_RE.test(ln.trim())) h += '<b class="keyline">' + esc(ln) + '</b><br>';
      else h += esc(ln) + '<br>';
    }
    h += '</div></div>';
  }
  return h;
}

// 按「回合」重建：面试官/问题开新回合；AI 答案进中栏；我的话进右栏。
// 'question' 是内部整合文本，与面试官原话重复，转录里跳过；'error' 作为中栏提示。
function buildRounds(entries) {
  const rounds = [];
  let cur = null;
  const push = () => { if (cur) rounds.push(cur); };
  for (const e of entries) {
    const k = e.kind;
    if (k === 'diagnostic') continue;
    if (k === 'interviewer') {
      push();
      cur = { iv: e.text, ai: '', me: [] };
    } else if (k === 'me') {
      if (!cur) cur = { iv: '', ai: '', me: [] };
      cur.me.push(e.text);
    } else if (k === 'answer') {
      if (!cur) cur = { iv: '', ai: '', me: [] };
      cur.ai += (cur.ai ? '\n' : '') + e.text;
    } else if (k === 'error') {
      if (!cur) cur = { iv: '', ai: '', me: [] };
      cur.ai += (cur.ai ? '\n' : '') + '[AI 错误] ' + e.text;
    }
    // 'question' 跳过（与 interviewer 重复）
  }
  push();
  return rounds;
}

function buildTranscriptHtml(entries, opts) {
  const includeAi = !!(opts && opts.includeAi);
  const custom = opts && opts.title ? String(opts.title) : '';
  const defaultTitle = includeAi ? '面试转录（含 AI 参考回答）' : '面试对话（不含 AI 参考回答）';
  const docTitle = custom || defaultTitle;
  const h1 = custom ? custom + (includeAi ? '（含 AI 参考回答）' : '（对话）') : defaultTitle;
  const rounds = buildRounds(entries || []);
  const colHead = includeAi
    ? '<th class="c-iv">面试官</th><th class="c-ai">AI 参考回答</th><th class="c-me">我</th>'
    : '<th class="c-iv">面试官</th><th class="c-me">我</th>';
  let rows = '';
  for (const r of rounds) {
    const iv = r.iv ? esc(r.iv).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
    const me = r.me.length ? esc(r.me.join('\n')).replace(/\n/g, '<br>') : '<span class="muted">—</span>';
    if (includeAi) {
      const ai = r.ai ? renderAi(r.ai) : '<span class="muted">—</span>';
      rows += '<tr><td class="c-iv">' + iv + '</td><td class="c-ai">' + ai + '</td><td class="c-me">' + me + '</td></tr>';
    } else {
      rows += '<tr><td class="c-iv">' + iv + '</td><td class="c-me">' + me + '</td></tr>';
    }
  }
  const ivW = includeAi ? '34' : '50';
  const meW = includeAi ? '34' : '50';
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(docTitle) + '</title><style>'
    + 'body{margin:0;background:#f7f6f2;color:#2a2e35;font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}'
    + 'h1{font-size:18px;margin:20px 24px 4px}.sub{margin:0 24px 16px;color:#6b6f76;font-size:13px}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th,td{border:1px solid #e2e0d9;vertical-align:top;padding:10px 12px}'
    + 'thead th{background:#ece9e1;position:sticky;top:0;text-align:left;font-size:13px}'
    + '.c-iv{width:' + ivW + '%}.c-ai{width:32%}.c-me{width:' + meW + '%}'
    + 'td.c-iv{background:#fbfaf7}.c-me{background:#f4f7fb}'
    + '.sec{margin:6px 0;border-radius:8px;overflow:hidden}.sec-outline{background:#eef4fb}.sec-script{background:#fff;border:1px solid #e2e0d9}.sec-translation,.sec-question-translation{background:#edf7f4;border:1px solid #d9eee8}'
    + '.sec-tag{font-size:12px;font-weight:600;color:#3a5a82;padding:4px 8px;background:#dde9f7}.sec-script .sec-tag{color:#7a5a1f;background:#fbf0d8}'
    + '.sec-body{padding:6px 10px}.keyline{color:#b3411f;font-weight:600}'
    + '.muted{color:#aaa}.foot{margin:18px 24px;color:#9a9da3;font-size:12px}'
    + '</style></head><body>'
    + '<h1>' + esc(h1) + '</h1>'
    + '<div class="sub">生成时间 ' + new Date().toLocaleString('zh-CN') + ' · 共 ' + rounds.length + ' 个回合 · 由 Pebble 自动记录</div>'
    + '<table><thead><tr>' + colHead + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + '<div class="foot">面试官=左' + (includeAi ? ' / AI 参考回答=中' : '') + ' / 我=右。本文件由 Pebble 自动生成，浏览器中可打印或导出 PDF。</div>'
    + '</body></html>';
}

module.exports = { buildTranscriptHtml, buildRounds };
