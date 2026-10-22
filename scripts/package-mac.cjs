// 打包面试辅助为 macOS .app：
// staging 拷贝（过滤运行时用不到的文件）→ electron-packager。
// 不用 asar：main.cjs 要 spawn native/setroute、native/sckcap.app 与 ark-import 子进程，
// 散文件布局免去 unpack 配置，路径行为与开发态完全一致。
const { cpSync, existsSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const staging = path.join(path.dirname(root), '.interview-assist-package-staging');
const output = path.join(root, 'release');
const APPNAME = 'Pebble'; // 显示名（对 Finder/Dock/菜单栏）；bundle id 保持 com.wuyibo.interview-assist；用钥匙串 Local Dev Signing 证书签名以保 TCC 授权跨重打包不丢
const ELECTRON_VERSION = '44.4.1';
const PACKAGER_VERSION = '20.3.0';

// native/ 只带运行时真正 spawn 的两个；其余是探针/实验产物
const nativeKeep = new Set(['setroute', 'sckcap.app', 'sckcap.swift']);
// assets/ 只带图标本体
const assetsKeep = new Set(['icon.png', 'icon.icns']);
const excludedAtRoot = new Set(['release', 'scripts', 'artifacts', '.git', 'node_modules/.package-lock.json', 'README.md', '启动.command', '.DS_Store', '.workbuddy']);

rmSync(staging, { recursive: true, force: true });
cpSync(root, staging, {
  recursive: true,
  filter(source) {
    const relative = path.relative(root, source);
    if (!relative) return true;
    const segs = relative.split(path.sep);
    if (excludedAtRoot.has(segs[0])) return false;
    // segs.length>1 才是目录内的子项；目录本身（segs[1] 为 undefined）必须放行，否则整个目录被丢
    if (segs.length > 1 && segs[0] === 'native' && !nativeKeep.has(segs[1])) return false;
    if (segs.length > 1 && segs[0] === 'assets' && !assetsKeep.has(segs[1])) return false;
    return path.basename(source) !== '.DS_Store';
  },
});

try {
  execFileSync('npx', [
    '--yes',
    `@electron/packager@${PACKAGER_VERSION}`,
    staging,
    APPNAME,
    '--platform=darwin',
    '--arch=arm64',
    `--electron-version=${ELECTRON_VERSION}`,
    `--out=${output}`,
    '--overwrite',
    '--app-bundle-id=com.wuyibo.interview-assist', // 不给的话这版 packager 会生成残缺的 "com.electron."
    '--asar=false', // 必须：native 二进制与 ark-import 要以真实文件被 spawn，asar 里跑不了
    '--prune=true', // 保留运行时依赖，排除开发用 Electron 等工具
    ...(existsSync(path.join(root, 'artifacts', `electron-v${ELECTRON_VERSION}-darwin-arm64.zip`))
      ? [`--electron-zip-dir=${path.join(root, 'artifacts')}`] : []),
  ], { cwd: root, stdio: 'inherit' });
  // --icon 选项在这版 packager 上探测不到 staging 里的图标（warning 后静默跳过），
  // 而 Info.plist 的 CFBundleIconFile 默认就是 electron.icns，直接覆盖最稳
  const appRes = path.join(output, `${APPNAME}-darwin-arm64`, `${APPNAME}.app`, 'Contents', 'Resources');
  cpSync(path.join(staging, 'assets', 'icon.icns'), path.join(appRes, 'electron.icns'));
  // packager 默认 ad-hoc 签名，其 designated requirement 只绑二进制 cdhash——
  // 每重新打包哈希就变，TCC（屏幕录制授权）按"签名身份"记账，于是每次重打包都被当成新 app 重新弹窗。
  // 改用钥匙串的自签名证书 "Local Dev Signing" 重签：requirement 改绑证书本身（certificate leaf = H"a5d4346c…"），
  // 与每版哈希无关，授权即可跨重打包持久化。bundle id 仍 com.wuyibo.interview-assist。
  const appPath = path.join(output, `${APPNAME}-darwin-arm64`, `${APPNAME}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', 'Local Dev Signing', '--identifier', 'com.wuyibo.interview-assist', appPath], { stdio: 'inherit' });
  console.log('[package] 已用 Local Dev Signing 证书重签（certificate leaf 固定身份，TCC 授权可跨重打包保留）');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
