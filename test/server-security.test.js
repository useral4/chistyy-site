const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kinava-security-'));
process.env.REPORTS_DIR=root;
process.env.METRICS_TOKEN='m'.repeat(48);
const gate=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve};};
let held,fetches=0,browserAvailable=true;
require('../lib/safe-fetch').fetchText=async (input,timeout,options={})=>{
  const url=new URL(input);
  if(url.pathname==='/budget')options.onBytes?.(17*1024*1024);
  if(url.pathname==='/'){fetches++;if(held)await held.promise;}
  return {ok:true,status:200,contentType:'text/html',finalUrl:url.href,text:'<html><body>Test</body></html>',headers:{}};
};
require('../lib/browser-audit').inspectBrowser=async()=>({available:browserAvailable,html:'<html><body>Test</body></html>',analyticsBeforeConsent:[],cookies:[]});
const {server}=require('../server');
let base;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{held?.resolve();await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});

test('Static caching uses ETags while private links and API responses are never cached', async()=>{
  const page=await fetch(base+'/');
  assert.equal(page.status,200);
  assert.match(page.headers.get('cache-control'),/must-revalidate/);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-frame-options'),'DENY');
  const tag=page.headers.get('etag');
  assert.ok(tag);
  assert.equal((await fetch(base+'/',{headers:{'If-None-Match':tag}})).status,304);
  const privatePage=await fetch(base+'/?report='+'a'.repeat(48),{headers:{'If-None-Match':tag}});
  assert.equal(privatePage.status,200);
  assert.equal(privatePage.headers.get('cache-control'),'no-store');
  assert.equal(privatePage.headers.get('etag'),null);
  const head=await fetch(base+'/assets/empty.webp',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/..%5c.env')).status,403);
  assert.equal((await fetch(base+'/%E0%A4%A')).status,400);
  assert.equal((await fetch(base+'/styles.css',{method:'POST'})).status,405);
});

test('Health endpoints expose no secrets; metrics require the operator bearer key',async()=>{
  const health=await fetch(base+'/healthz');assert.deepEqual(await health.json(),{status:'ok'});
  assert.equal((await fetch(base+'/readyz')).status,200);
  assert.equal((await fetch(base+'/metrics')).status,404);
  assert.equal((await fetch(base+'/metrics',{headers:{Authorization:'Bearer wrong'}})).status,404);
  const metrics=await fetch(base+'/metrics',{headers:{Authorization:'Bearer '+process.env.METRICS_TOKEN}});
  assert.equal(metrics.status,200);
  const text=await metrics.text();assert.match(text,/kinava_audits_waiting 0/);assert.doesNotMatch(text,/mmmm|report=|access=/);
});

test('Concurrent users get a real queue position and both receive browser-complete reports',async()=>{
  held=gate();fetches=0;
  const first=await fetch(base+'/api/audit?url=https://example.ru/',{headers:{Accept:'application/x-ndjson'}});
  const firstText=first.text();
  const second=await fetch(base+'/api/audit?url=https://example.ru/',{headers:{Accept:'application/x-ndjson'}});
  const reader=second.body.getReader(), decoder=new TextDecoder();
  let text='';
  while(!text.includes('"queuePosition":1'))text+=decoder.decode((await reader.read()).value,{stream:true});
  assert.equal(fetches,1);
  const metrics=await fetch(base+'/metrics',{headers:{Authorization:'Bearer '+process.env.METRICS_TOKEN}});
  assert.match(await metrics.text(),/kinava_audits_waiting 1/);
  held.resolve();held=null;
  while(true){const {value,done}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});}
  reader.releaseLock();
  const results=[await firstText,text].map(value=>value.trim().split('\n').map(JSON.parse).find(event=>event.type==='result').audit);
  assert.equal(fetches,2);
  assert.ok(results.every(audit=>audit.facts.browserChecked));
});

test('Closing a queued connection removes its job without fetching the target',async()=>{
  held=gate();fetches=0;
  const first=await fetch(base+'/api/audit?url=https://example.ru/',{headers:{Accept:'application/x-ndjson'}}), firstText=first.text();
  const cancel=new AbortController();
  const second=await fetch(base+'/api/audit?url=https://example.ru/',{headers:{Accept:'application/x-ndjson'},signal:cancel.signal});
  const reader=second.body.getReader();
  await reader.read();cancel.abort();
  await reader.cancel().catch(()=>{});
  for(let attempt=0;attempt<20;attempt++){
    const response=await fetch(base+'/metrics',{headers:{Authorization:'Bearer '+process.env.METRICS_TOKEN}});
    if((await response.text()).includes('kinava_audits_waiting 0'))break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  held.resolve();held=null;await firstText;
  assert.equal(fetches,1);
});

test('Required browser failure ends the stream without saving or false completion',async()=>{
  process.env.BROWSER_REQUIRED='1';browserAvailable=false;
  const beforeFiles=fs.readdirSync(root);
  try {
    const response=await fetch(base+'/api/audit?url=https://example.ru/',{headers:{Accept:'application/x-ndjson'}});
    const events=(await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).type,'error');
    assert.ok(!events.some(event=>event.type==='result'||event.percent===100));
    assert.deepEqual(fs.readdirSync(root),beforeFiles);
  }finally{delete process.env.BROWSER_REQUIRED;browserAvailable=true;}
});

test('A transfer-budget violation rejects the audit instead of returning a manual-review report',async()=>{
  const response=await fetch(base+'/api/audit?url=https://example.ru/budget');
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/объём/);
});
