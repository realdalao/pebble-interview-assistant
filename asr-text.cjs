const { stripFinalPrefix } = require('./renderer/qdetect.js');
// Each socket owns its decoder. ASR full results contain ALL final sentences;
// the renderer receives ONLY new finals and the current unfinished suffix.
function createAsrDecoder() {
  let delivered = 0, committed = [];
  return result => {
    const utterances = Array.isArray(result.utterances) ? result.utterances : [];
    const finals = utterances.filter(u => u.definite).map(u => String(u.text || ''));
    if (utterances.length && finals.length < delivered) return { definite: [], partial: '', partialIsTail: true };
    // A full result must not move its watermark backwards on an out-of-order packet.
    const fresh = finals.slice(delivered);
    delivered = Math.max(delivered, finals.length);
    if (finals.length) committed = finals;
    let partial = utterances.filter(u => !u.definite).map(u => u.text || '').join('');
    if (!partial && typeof result.text === 'string') {
      const tail = stripFinalPrefix(result.text, committed);
      // Some full packets omit the pending utterance object, but keep its tail
      // in result.text. Never send the entire history if its prefix was revised.
      if (!committed.length || tail !== result.text) partial = tail;
    }
    return { definite: fresh, partial: String(partial), partialIsTail: true };
  };
}
module.exports = { createAsrDecoder };
