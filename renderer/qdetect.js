// 面试官「问完了没有」的内容判断：把定稿句分成 问句 / 背景陈述 / 半句话 三类，
// 再按类别给不同的静音等待阈值（静音只是兜底，不再是唯一依据）。
// 单独成文件是为了能脱离界面跑单测（scripts/test-qdetect.cjs）。
// ASR 开了 enable_punc + show_utterances，所以定稿句带句末标点——这是最硬的判断信号。

// 均衡档（2026-09-30 用户选）：问句确认快，背景说明要多等，半句话最久。
// 注意：这三个值现在只是**兜底**——内容判定成立时按 CONTENT_FIRE_MS 走，不等静音。
var SILENCE_MS_BY_KIND = { question: 900, background: 2600, partial: 3200 };

// 内容判定成立后的拼接窗口（2026-09-30 用户选 300ms）：不是等静音，而是给 ASR 一个
// 把同一句话的后半段补上来的机会——窗口内来了新定稿就取消重判，避免把半句话抢发出去。
var CONTENT_FIRE_MS = 300;

var TERMINAL_PUNCT = /[。！？!?…]$/;
// 请求作答类：出现即算提问（除非是面试官自称要讲，见 selfNarrate）
var REQUEST_MARKERS = ['请介绍', '请谈谈', '请说说', '请举例', '请描述', '请解释',
  '介绍一下', '描述一下', '举一个例子', '举个例子', '解释一下', '谈一谈', '说一说', '讲一讲',
  '你怎么', '你如何', '你觉得', '你认为', '你的看法', '你的理解', '你是怎么',
  '说说你', '谈谈你', '讲讲你', '聊一聊你',
  '自我介绍', '做个介绍', '简单介绍', '具体说说', '具体讲讲', '重点说说', '重点讲讲',
  '说说新方法', '解释一下区别', '比较一下']; // 「请先做个自我介绍。」是面试开场第一句，不收就永远等不到提问
var EN_REQUEST = /\b(?:share|tell\s+me\s+about|describe|explain|walk\s+me\s+through|give\s+an?\s+example|talk\s+about|what|why|how|when|where|which|who|can\s+you|could\s+you)\b/i;
var EN_INSTRUCTION_ONLY = /^(?:please\s+)?(?:carefully\s+)?(?:check|read|look\s+at|listen\s+to|choose|select|answer|complete|follow)\b/i;
// 疑问词：只在句尾附近出现才算提问——“不管什么情况我们都要交付。”里的“什么”不是提问
var WH_MARKERS = ['为什么', '怎么', '怎样', '咋', '如何', '是否', '能不能', '可不可以',
  '会不会', '有没有', '哪些', '哪个', '哪里', '谁', '什么', '多少', '几'];
var TAIL_LEN = 6; // 句尾多少字内出现疑问词才算“问句收尾”

function hasAny(text, list) {
  for (var i = 0; i < list.length; i++) if (text.indexOf(list[i]) >= 0) return true;
  return false;
}

function classifySentence(s) {
  var text = String(s || '').trim();
  if (!text) return 'partial';
  // 英语面试题经常以 Share/Describe/Tell me about 开头且没有问号；
  // 先过滤考试流程说明，再识别真正要求候选人作答的句子。
  if (/\b[A-Za-z]{2,}\b/.test(text)) {
    var english = text.replace(/^[\s.。！？!?]+/, '');
    if (EN_INSTRUCTION_ONLY.test(english) && !EN_REQUEST.test(english.replace(/^.*?[。.!?]\s*/, ''))) return /[.!?。！？]$/.test(text) ? 'background' : 'partial';
    if (EN_REQUEST.test(english) && english.length >= 18) return 'question';
  }
  if (/[？?]$/.test(text)) return 'question'; // 问号最强，直接认定
  var ends = TERMINAL_PUNCT.test(text);
  // 自称叙述：“我先介绍一下背景。”是面试官自己要讲，不是请你讲。
  // 主语必须落在句首（允许「那/好，」这类口头前缀）——否则「请先做个自我介绍。」里的
  // “自我介绍”会被当成“我…介绍”，把开场第一句误判成背景（单测抓到过）
  var selfNarrate = /^[好嗯那，,、\s]*(我|我们|咱们|那我|我来)[^，。、？]{0,8}(介绍|谈|说|讲|描述|举|解释)/.test(text);
  if (selfNarrate) return ends ? 'background' : 'partial';
  if (hasAny(text, REQUEST_MARKERS)) return ends || text.length >= 8 ? 'question' : 'partial';
  // 面试官对着「你」发问：疑问词在句中也算数——「你为什么选择我们公司。」不会以疑问词收尾，
  // 但没有「你」的「不管什么情况都要交付。」仍然是陈述句，靠这条区分
  if (/你|您/.test(text) && hasAny(text, WH_MARKERS) && (ends || text.length >= 8)) return 'question';
  var tail = text.slice(-TAIL_LEN);
  if (hasAny(tail, WH_MARKERS)) return 'question';
  if (/[吗呢吧]$/.test(text)) return 'question';
  if (ends) return 'background'; // 说完整了、但不是在问 → 背景/陈述
  return 'partial'; // 连句末标点都没有 → 话没说完
}

// 当前这一轮未发送内容算哪一类：看最后一句定稿；没有定稿就看灰字
function pendingKind(sentences, partialText) {
  var list = Array.isArray(sentences) ? sentences : [];
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i]) return classifySentence(list[i]);
  }
  return partialText && String(partialText).trim() ? 'partial' : 'background';
}

function silenceThreshold(kind) {
  return SILENCE_MS_BY_KIND[kind] || SILENCE_MS_BY_KIND.background;
}

// 「内容是否已经构成一个完整的提问」——这是新的拍板依据，成立就不再等静音。
// 两条硬条件：①判为问句 ②有句末标点。缺标点说明 ASR 还在收尾，交给拼接窗口/静音兜底。
function isCompleteQuestion(sentence) {
  var text = String(sentence || '').trim();
  if (!text) return false;
  if (classifySentence(text) !== 'question') return false;
  return /[？?。！!…]$/.test(text);
}

// 返回「按内容就能发」的等待毫秒数；返回 0 表示内容还不足以拍板，交给静音兜底。
// 只看最后一句定稿：前面再长也是背景，决定「问没问完」的是最后那句。
function contentFireDelay(sentences, partialText) {
  var list = Array.isArray(sentences) ? sentences : [];
  for (var i = list.length - 1; i >= 0; i--) {
    if (!list[i]) continue;
    return isCompleteQuestion(list[i]) ? CONTENT_FIRE_MS : 0;
  }
  return 0;
}

// 状态提示文案：让用户知道「为什么还没发答案」
function stateLabel(kind, hasPending, byContent) {
  if (!hasPending) return '';
  if (kind === 'question') return byContent ? '问句已完整，即将作答…' : '已识别问题，确认中…';
  if (kind === 'partial') return '面试官还在说，等待句末…';
  return '背景说明中，等提问…';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifySentence, pendingKind, silenceThreshold, isCompleteQuestion, contentFireDelay, stateLabel, SILENCE_MS_BY_KIND, CONTENT_FIRE_MS };
}

// Silence is not an intent signal. Acknowledgements, employer descriptions and
// closing remarks never become automatic answer requests, even with a question mark.
function isBackchannel(text) {
  return /^[嗯哦噢啊好的是对呀了明白了解收到感谢谢谢，。！!？?\s]+$/.test(String(text || '').trim());
}
function isNonQuestion(text) {
  const s = String(text || '').trim();
  return !s || isBackchannel(s) || /^(?:嗯[，,\s]*)?(?:好[呀的，,\s]*)?(?:感谢你的分享|后续的反馈|那我这边.*没有什么问题|我们是纯线上|我们目前的工作地点|我们整体属于|核心是以|我们是以产品为主)/.test(s);
}
function stripFinalPrefix(text, finals) {
  let rest = String(text || '');
  const prefix = (finals || []).join('');
  // Match character-by-character while tolerating ASR punctuation/space revisions.
  const ignored = /[\s，。！？、,.!?：:；;]/;
  let i = 0, j = 0;
  while (i < prefix.length && j < rest.length) {
    if (ignored.test(prefix[i])) { i++; continue; }
    if (ignored.test(rest[j])) { j++; continue; }
    if (prefix[i] !== rest[j]) return rest;
    i++; j++;
  }
  while (i < prefix.length && ignored.test(prefix[i])) i++;
  if (i !== prefix.length) return rest;
  while (j < rest.length && ignored.test(rest[j])) j++;
  return rest.slice(j);
}
function selectCurrentQuestion(text, manual) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const sentences = raw.match(/[^。！？!?]+[。！？!?]?/g) || [];
  let last = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (!isNonQuestion(sentences[i]) && classifySentence(sentences[i]) === 'question') last = i;
  }
  if (last < 0) return manual ? raw : '';
  // Adjacent questions in the same turn form a compound question. An acknowledgement
  // or intervening declarative sentence separates stale questions from the new one.
  let start = last;
  while (start > 0 && !isNonQuestion(sentences[start - 1]) && classifySentence(sentences[start - 1]) === 'question') start--;
  // A short background immediately before this question is useful, but never import
  // another historical question. Cumulative ASR has already been removed upstream.
  if (start > 0 && !isNonQuestion(sentences[start - 1]) && sentences[start - 1].length < 180) start--;
  // 问号后的补充要求经常被 ASR 单独断成下一句（“说说区别及效果”）；
  // 保留这些限定，直到遇到新的独立问题或明显换话题。
  let end = last;
  for (let i = last + 1; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (!s) continue;
    if (classifySentence(s) === 'question') break;
    if (/^(?:请|重点|具体|尤其|同时|并且|以及|说说|讲讲|解释|比较|对比|谈谈|describe\b|explain\b|include\b|also\b|and\b)/i.test(s)) end = i;
    else if (end === i - 1 && s.length < 80 && /(?:区别|对比|效果|结果|原因|做法|过程|收获|如何|为什么|经历|准备|具体)/i.test(s)) end = i;
    else break;
  }
  return sentences.slice(start, end + 1).join('').trim();
}

function questionIntent(text) {
  var s = String(text || '');
  if (/另一个|再分享|其他案例|类似经历|换一个案例|another example|another experience/i.test(s)) return 'another-case';
  if (/动机|促使|为什么决定|为什么选择|出于什么|motivat|why did you/i.test(s)) return 'motivation';
  if (/区别|对比|比较|常规做法|新方法|difference|compare|compared with/i.test(s)) return 'comparison';
  if (/结果|效果|成果|影响|成效|outcome|result|impact/i.test(s)) return 'result';
  if (/收获|学到|反思|体会|经验|learn|takeaway|reflect/i.test(s)) return 'reflection';
  if (/努力|行动|怎么做|如何做|一步步|拆解|过程|具体做法|action|how did you/i.test(s)) return 'actions';
  return 'general';
}
if (typeof module !== 'undefined' && module.exports) {
  Object.assign(module.exports, { isBackchannel, isNonQuestion, stripFinalPrefix, selectCurrentQuestion, questionIntent });
}
