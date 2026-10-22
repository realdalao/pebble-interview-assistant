// Replay the two previously blocked requests against the current model/policy.
// Reads only local diagnostics/config; never prints keys or private profile text.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const assert=require('node:assert/strict');
const {createCredentialClient}=require('../credential-client.cjs');
const {generateReferenceAnswer}=require('../grounded-answer.cjs');
const root=path.resolve(__dirname,'..');
const file=process.argv.find(a=>a.endsWith('.jsonl'));if(!file)throw Error('Supply local answer-diagnostics.jsonl');
const events=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
const ids=new Set(events.filter(e=>e.type==='error'&&/未通过事实核对/.test(e.error||'')).map(e=>e.requestId));
const requests=events.filter(e=>e.type==='request'&&ids.has(e.requestId));
const credentials=createCredentialClient({root,binary:path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),packaged:false,userData:path.join(os.homedir(),'Library/Application Support/interview-assist'),appData:path.join(os.homedir(),'Library/Application Support')});
(async()=>{
 try {
  const {config}=await credentials.read();
  const code=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
  const scope={fetch,TextDecoder,COMPATIBLE_MODELS:new Set(['deepseek-v4-1-flash-260910','glm-5-3-flash-260828','deepseek-v4-pro-ga-260813','deepseek-v4-flash-ga-260731','glm-5-2-260617']),COMPATIBLE_ENDPOINT:'https://ark.cn-beijing.volces.com/api/compatible/v1/messages'};
  vm.createContext(scope);
  vm.runInContext(code.slice(code.indexOf('async function sseLines('),code.indexOf('\nconst { createCredentialClient'))+'\n'+code.slice(code.indexOf('async function arkStream('),code.indexOf('// 用模型把整场对话总结')),scope);
  requests.push({question:'请举一个你主动改进视频设计的案例。',profile:'',jd:'AI内容创作岗位',facts:'',context:'',len:'normal',emptyProfile:true});
  const results=[];
  for(const request of requests){
   const started=Date.now();let firstTokenMs=null,calls=0;const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),45000);
   try{
    const answer=await generateReferenceAnswer({...request,signal:ac.signal,onDelta:()=>{if(firstTokenMs===null)firstTokenMs=Date.now()-started;},complete:async(messages,signal,onDelta)=>{calls++;let text='';await scope.arkStream(messages,delta=>{text+=delta;onDelta(delta);},signal,config);return text;}});
    assert.ok(answer.includes('大纲：')&&answer.includes('逐字稿：'));assert.ok(!/请补充材料|未通过事实核对|无法回答|没有可确认的信息/.test(answer));assert.equal(calls,1);
    const result={question:request.question,emptyProfile:!!request.emptyProfile,passed:true,calls,firstTokenMs,elapsedMs:Date.now()-started,answer};results.push(result);
    console.log(JSON.stringify({passed:true,emptyProfile:result.emptyProfile,calls,firstTokenMs,elapsedMs:result.elapsedMs}));
   } finally{clearTimeout(timer);}
  }
  fs.writeFileSync(path.join(root,'artifacts/reference-policy-20261020.json'),JSON.stringify({model:config.model,results},null,2),{mode:0o600});
 }finally{credentials.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
