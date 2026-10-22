const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { operate } = require('../credential-io.cjs');
const { createCredentialClient, createConfigUpdater } = require('../credential-client.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const storage = { encryptString: text => Buffer.from('enc:' + text), decryptString: buf => buf.toString().slice(4) };
test('加密失败不改变旧缓存；成功原子保存并限制文件权限', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-cache-test-')); const file = path.join(dir, 'ark.enc');
  try {
    const original = { key: 'TEST_SECRET', profile: '自己的档案', jd: '岗位' };
    operate({op:'write',path:file,config:original}, storage);
    const before = fs.readFileSync(file);
    assert.throws(() => operate({op:'write',path:file,config:{profile:'不能覆盖'}}, { encryptString: () => {throw Error('denied');} }));
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(operate({op:'read',path:file}, storage).config, original);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir), ['ark.enc']);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('同时改模型、档案和JD按序合并；保存失败不伪报成功或丢内存档案', async () => {
  let state = {key:'TEST',model:'old',profile:'old',jd:'old'}; const saves=[];
  const update = createConfigUpdater({get:()=>state,set:next=>{state=next;},save:async next=>{saves.push(next);if(next.jd==='FAIL')throw Error('denied');}});
  const results = await Promise.all([update({model:'new'}),update({profile:'new-profile'}),update({jd:'new-jd'})]);
  assert.ok(results.every(r=>r.ok)); assert.deepEqual(state,{key:'TEST',model:'new',profile:'new-profile',jd:'new-jd'});
  assert.equal((await update({jd:'FAIL'})).ok,false);assert.equal(state.jd,'new-jd');
  assert.equal((await update({jd:'retry'})).ok,true);assert.equal(state.profile,'new-profile');
});
function mockSpawn(behavior) {
  return (binary,args,options) => {
    const child = new EventEmitter(); child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.kill=signal=>{child.killed=signal;};
    let text='';child.stdin.on('data',chunk=>{text+=chunk;});
    child.stdin.on('end',()=>behavior(child,JSON.parse(text),args,options));
    return child;
  };
}
function client(spawnWorker,timeoutMs=100) {return createCredentialClient({root:'/test/app',binary:'/test/Electron',packaged:false,userData:'/test/own',appData:'/test/data',spawnWorker,timeoutMs});}
test('子进程只用stdin传凭据，启动参数不含秘密，读取结果只在内存传回', async () => {
  const c = client(mockSpawn((child,task,args)=>{
    assert.ok(!JSON.stringify(args).includes('TEST_SECRET')); assert.ok(args.includes('--credential-worker'));
    assert.equal(task.path,'/test/own/ark.enc');
    child.stdout.end('PEBBLE_CREDENTIAL '+JSON.stringify({ok:true,config:{key:'TEST_SECRET'}})+'\n');
    setImmediate(()=>child.emit('close',0));
  }));
  assert.equal((await c.read()).config.key,'TEST_SECRET');c.close();
});
test('子进程卡在钥匙串时不阻塞主线程，超时杀掉且不给空档案兜底', async () => {
  let child;
  const c=client(mockSpawn(c=>{child=c;}),20);
  const pending=c.read(); let responsive=false;setImmediate(()=>{responsive=true;});
  await assert.rejects(pending,/KEYCHAIN_TIMEOUT/); assert.equal(responsive,true);assert.equal(child.killed,'SIGKILL');
});
test('退出时取消等待中的凭据操作', async () => {
  let child; const c=client(mockSpawn(c=>{child=c;}));
  const pending=c.read(); await tick();c.close();
  await assert.rejects(pending,/CANCELLED/);assert.equal(child.killed,'SIGKILL');
});
test('relay凭据只从独立身份和目录读取', async () => {
  const c=client(mockSpawn((child,task,args)=>{
    assert.ok(args.includes('--relay-identity'));assert.equal(task.path,'/test/data/screen-relay-lab/model.enc');
    child.stdout.end('PEBBLE_CREDENTIAL {"ok":true,"missing":true}\n');setImmediate(()=>child.emit('close',0));
  }));
  assert.equal((await c.importRelay()).missing,true);
});
test('隔离启动不迁移真实用户目录；正常安装包仍兼容旧目录', () => {
  const vm = require('node:vm');
  const code = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const block = code.slice(code.indexOf('if (app.isPackaged &&'), code.indexOf('\nconst SETROUTE'));
  const operations = [];
  const scope = { app:{isPackaged:true,getPath:()=>'/real'},process:{env:{ASSIST_USER_DATA:'/isolated'}},path,userDataDir:'/isolated',
    fs:{existsSync:p=>{operations.push(p);return !p.startsWith('/isolated');},mkdirSync(){},copyFileSync:(...a)=>operations.push(a),renameSync:(...a)=>operations.push(a)} };
  vm.runInNewContext(block,scope); assert.deepEqual(operations,[]);
  scope.process.env={}; vm.runInNewContext(block,scope);
  assert.ok(operations.some(op=>Array.isArray(op)&&op[0]==='/real/面试辅助/interview-logs'));
});
