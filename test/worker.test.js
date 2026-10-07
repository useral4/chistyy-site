const {test,before,after} = require('node:test');
const assert=require('node:assert/strict');
process.env.BROWSER_WORKER_KEY='w'.repeat(48);
let targets=[];
require('../lib/safe-fetch').fetchText=async url=>{targets.push(url);return {ok:true,status:200,contentType:'text/html',finalUrl:url,text:'<html>Test</html>',headers:{}};};
require('../lib/browser-audit').inspectBrowser=async()=>({available:true,html:'<html>Test</html>',bannerVisible:true,refusalVisible:true,analyticsBeforeConsent:[],cookies:[],blockedRequests:0});
const {server}=require('../worker'), {inspectRemote}=require('../lib/browser-client');
let base;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;process.env.BROWSER_WORKER_URL=base;});
after(async()=>{await new Promise(resolve=>server.close(resolve));delete process.env.BROWSER_WORKER_URL;});

test('Worker requires its separate secret and never accepts unauthenticated target requests',async()=>{
  const response=await fetch(base+'/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://example.ru/'})});
  assert.equal(response.status,403);assert.equal(targets.length,0);
  assert.equal((await fetch(base+'/metrics')).status,404);
});

test('Worker client sends only the target URL, not reports, cookies or application credentials',async()=>{
  const result=await inspectRemote('https://example.ru/');
  assert.equal(result.available,true);assert.equal(result.bannerVisible,true);
  assert.deepEqual(targets,['https://example.ru/']);
  assert.equal(result.html,'<html>Test</html>');
  assert.equal(Object.hasOwn(result,'reportToken'),false);
});

test('Worker rejects non-HTTP targets and oversized request bodies',async()=>{
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+process.env.BROWSER_WORKER_KEY};
  assert.equal((await fetch(base+'/inspect',{method:'POST',headers,body:JSON.stringify({url:'file:///etc/passwd'})})).status,400);
  assert.equal((await fetch(base+'/inspect',{method:'POST',headers,body:'x'.repeat(5000)})).status,400);
});
