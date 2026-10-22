const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
function createCredentialClient({ root, binary, packaged, userData, appData, spawnWorker = spawn, timeoutMs = 12000 }) {
  const cache = path.join(userData, 'ark.enc');
  const active = new Map();
  function run(task, relay = false) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-credentials-'));
    const env = { ...process.env, PEBBLE_CREDENTIAL_STATE: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const args = ['--no-sandbox', ...(packaged ? [] : [root]), '--credential-worker', ...(relay ? ['--relay-identity'] : [])];
    return new Promise((resolve, reject) => {
      let child, settled = false, text = '';
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (child) active.delete(child);
        if (error && child) child.kill('SIGKILL');
        fs.rmSync(temporary, { recursive: true, force: true });
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('KEYCHAIN_TIMEOUT')), timeoutMs);
      try { child = spawnWorker(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch (_) { finish(new Error('CREDENTIAL_WORKER_FAILED')); return; }
      active.set(child, finish);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        text += chunk;
        if (text.length > 256000) finish(new Error('INVALID_CREDENTIAL_RESPONSE'));
      });
      child.stderr.resume();
      child.on('error', () => finish(new Error('CREDENTIAL_WORKER_FAILED')));
      child.on('close', () => {
        if (settled) return;
        try {
          const line = text.split('\n').find(line => line.startsWith('PEBBLE_CREDENTIAL '));
          const result = JSON.parse(line.slice('PEBBLE_CREDENTIAL '.length));
          if (!result.ok) throw new Error('KEYCHAIN_UNAVAILABLE');
          finish(null, result);
        } catch (_) { finish(new Error('KEYCHAIN_UNAVAILABLE')); }
      });
      child.stdin.on('error', () => finish(new Error('CREDENTIAL_WORKER_FAILED')));
      child.stdin.end(JSON.stringify(task));
    });
  }
  return {
    close: () => { for (const finish of [...active.values()]) finish(new Error('CREDENTIAL_WORKER_CANCELLED')); },
    read: () => run({ op: 'read', path: cache }),
    write: config => run({ op: 'write', path: cache, config }),
    importRelay: () => run({ op: 'read', path: path.join(appData, 'screen-relay-lab/model.enc') }, true),
  };
}
// Serialize read-modify-save so simultaneous model/profile/JD changes cannot
// overwrite one another. Publish new state only after the encrypted save succeeds.
function createConfigUpdater({ get, set, save }) {
  let queue = Promise.resolve();
  return patch => {
    const operation = queue.then(async () => {
      const current = get();
      if (!current) return { ok: false, error: '方舟凭据未就绪' };
      const next = { ...current, ...patch };
      await save(next); set(next);
      return { ok: true };
    });
    queue = operation.catch(() => {});
    return operation.catch(() => ({ ok: false, error: '加密保存未完成：请检查钥匙串授权后重试' }));
  };
}
module.exports = { createCredentialClient, createConfigUpdater };
