// 双方实际定稿：近期原文 + 异步累计摘要。摘要失败时保留待处理原文。
function createConversationContext(maxChars = 6000, maxEntries = 60, summarize = null) {
  let entries = [], archived = [], originals = [], summary = '', busy = false, epoch = 0;
  async function compact() {
    if (busy || !summarize || !archived.length) return;
    const generation = epoch;
    const batch = [];
    for (const line of archived) {
      if (batch.length && batch.join('\n').length + line.length > 6000) break;
      batch.push(line);
    }
    busy = true;
    let success = false;
    try {
      const result = await summarize({ summary, text: batch.join('\n') });
      if (generation !== epoch) return;
      if (result && result.ok && typeof result.summary === 'string' && result.summary.trim()) {
        summary = result.summary.trim();
        archived.splice(0, batch.length);
        success = true;
      }
    } catch (_) { /* 原文保留，下次追加时重试 */ }
    finally {
      if (generation === epoch) {
        busy = false;
        if (success && archived.length) void compact();
      }
    }
  }
  return {
    append(id, text) {
      if (id !== 'interviewer' && id !== 'me') return;
      const content = String(text || '').trim();
      if (!content) return;
      const label = id === 'me' ? '我：' : '面试官：';
      originals.push(label + content);
      // 超长定稿拆片，保留开头，避免单条发言截断丢事实。
      const size = Math.max(1, maxChars - label.length);
      for (let i = 0; i < content.length; i += size) entries.push(label + content.slice(i, i + size));
      while (entries.length > maxEntries || entries.join('\n').length > maxChars) archived.push(entries.shift());
      void compact();
    },
    text() {
      return [summary && '本场早期对话累计摘要（可能遗漏细节，以实际发言为准）：\n' + summary,
        archived.length && '早期实际发言（摘要处理中或暂不可用）：\n' + archived.join('\n'),
        entries.length && '近期双方实际发言：\n' + entries.join('\n')].filter(Boolean).join('\n\n');
    },
    // Exact originals are the evidence store; summaries are navigation only.
    evidence() { return originals.join('\n'); },
    clear() { epoch++; entries = []; archived = []; originals = []; summary = ''; busy = false; },
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createConversationContext };
