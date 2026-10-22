// File operations shared by the isolated credential worker and unit tests.
const fs = require('node:fs');
const path = require('node:path');
function operate(task, storage) {
  if (task.op === 'read') {
    if (!fs.existsSync(task.path)) return { missing: true };
    const stat = fs.statSync(task.path);
    if (stat.size > 256000) throw new Error('INVALID_CACHE');
    const config = JSON.parse(storage.decryptString(fs.readFileSync(task.path)));
    return { config };
  }
  if (task.op !== 'write' || !task.config || typeof task.config !== 'object') throw new Error('INVALID_OPERATION');
  // Encrypt before touching an existing cache. A denied Keychain operation must
  // not truncate or replace the user's current credentials/profile.
  const encrypted = storage.encryptString(JSON.stringify(task.config));
  fs.mkdirSync(path.dirname(task.path), { recursive: true, mode: 0o700 });
  const temporary = task.path + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, task.path);
  } finally { try { fs.unlinkSync(temporary); } catch (_) {} }
  return { saved: true };
}
module.exports = { operate };
