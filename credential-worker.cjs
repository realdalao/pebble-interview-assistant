// Browser-process safeStorage may synchronously wait on macOS Keychain. Keep it
// in this expendable Electron process, never in the window/IPC-owning process.
const { app, safeStorage } = require('electron');
const { operate } = require('./credential-io.cjs');
app.setName(process.argv.includes('--relay-identity') ? 'screen-relay-lab' : 'Pebble');
if (process.env.PEBBLE_CREDENTIAL_STATE) app.setPath('userData', process.env.PEBBLE_CREDENTIAL_STATE);
app.disableHardwareAcceleration();
const task = new Promise((resolve, reject) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { text += chunk; if (text.length > 256000) reject(new Error('INVALID_OPERATION')); });
  process.stdin.on('end', () => { try { resolve(JSON.parse(text)); } catch (_) { reject(new Error('INVALID_OPERATION')); } });
  process.stdin.on('error', reject);
});
Promise.all([app.whenReady(), task]).then(([, request]) => {
  if (app.dock) app.dock.hide();
  const value = operate(request, safeStorage);
  process.stdout.write('PEBBLE_CREDENTIAL ' + JSON.stringify({ ok: true, ...value }) + '\n', () => app.exit(0));
}).catch(() => {
  // Do not expose raw errors, ciphertext, credentials or file contents.
  process.stdout.write('PEBBLE_CREDENTIAL {"ok":false,"error":"KEYCHAIN_UNAVAILABLE"}\n', () => app.exit(1));
});
