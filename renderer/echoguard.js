// 回声守卫（2026-10-12 外放回声）：不开耳麦面试时，扬声器里的面试官声音会被麦克风
// 再收一遍、转写进「我」的声道。AEC（回声消除）能压掉大部分，但残留的尾部回声仍会
// 漏进来——这条守卫在内容层兜底：「我」的新定稿若与最近的面试官内容（历史窗口 +
// 未定稿）高度重合，按回声丢弃，不进对话流、不进面试记录。
// 纯函数零依赖，与 qdetect.js 同款：浏览器当普通脚本加载，node 里能 require 测试。
function normKey(s) {
  return String(s || '').replace(/[\s，。？！、,.?!：:；;·…—~"'“”‘’（）()【】[\]{}<>《》]/g, '');
}
// bigram Jaccard：同一段声音被 ASR 念两遍文本几乎一致（≥0.8），不同的话远低于此
function bigramSim(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set();
  const B = new Set();
  for (let i = 0; i + 1 < a.length; i++) A.add(a.slice(i, i + 2));
  for (let i = 0; i + 1 < b.length; i++) B.add(b.slice(i, i + 2));
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}
// meText：我的声道新定稿；recentIv：面试官定稿滚动窗口；ivPartial：面试官未定稿灰字
function isEcho(meText, recentIv, ivPartial) {
  const k = normKey(meText);
  if (k.length < 8) return false; // 太短不判：真实回答也可能只有几个字
  const history = (recentIv || []).map(normKey);
  const pool = [normKey(ivPartial)].concat(history, history.slice(-6).join('')).filter((s) => s.length >= 8);
  for (const b of pool) {
    if (b.includes(k)) return true; // 只丢整段重复；引用问题后接自己的回答时保留 // 整句被重复转写
    if (bigramSim(k, b) >= 0.62) return true; // 同一段声音两次识别的轻微差异
  }
  return false;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normKey, bigramSim, isEcho };
}

// 麦克风定稿稍后提交，给系统声道的异步 ASR 留出对账时间。
function createEchoFilter(commit, clock = Date.now) {
  let recent = [], pending = [], partial = '', partialAt = 0;
  function pool() {
    const now = clock();
    recent = recent.filter(item => now - item.at <= 12000);
    return recent.map(item => item.text);
  }
  return {
    interviewer(text) { recent.push({ text, at: clock() }); },
    partial(text) { partial = text || ''; partialAt = clock(); },
    isEcho(text) { return isEcho(text, pool(), clock() - partialAt <= 12000 ? partial : ''); },
    enqueue(text, time) { pending.push({ text, time, at: clock() }); },
    flush(force = false) {
      const due = [], waiting = [];
      for (const item of pending) (force || clock() - item.at >= 1800 ? due : waiting).push(item);
      pending = waiting;
      for (const item of due) if (!this.isEcho(item.text)) commit(item.text, item.time);
    },
    clear() { recent = []; pending = []; partial = ''; partialAt = 0; },
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports.createEchoFilter = createEchoFilter;
