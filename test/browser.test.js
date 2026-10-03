const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspectBrowser,analyticsRequest}=require('../lib/browser-audit');

test('Fresh browser detects a JS cookie banner, records early analytics and blocks private network access',async()=>{
 const html=`<html><body><form><input type=email><input type=checkbox checked></form><script>
 document.body.insertAdjacentHTML('beforeend','<div id="cookie-banner">Cookie <button>Принять</button><button>Только необходимые</button></div>');
 document.querySelector('input[type=checkbox]').checked=false;
 fetch('https://mc.yandex.ru/watch/1').catch(()=>{});
 fetch('http://127.0.0.1/private').then(()=>document.body.dataset.leaked='yes').catch(()=>{});
 </script></body></html>`;
 const result=await inspectBrowser({finalUrl:'https://example.ru/',ok:true,status:200,text:html,contentType:'text/html'},[],{settleMs:500});
 assert.equal(result.available,true);assert.equal(result.bannerVisible,true);assert.equal(result.refusalVisible,true);
 assert.deepEqual(result.analyticsBeforeConsent,['https://mc.yandex.ru/watch/1']);assert.equal(result.blockedRequests,1);
 assert.ok(!result.html.includes('data-leaked'));assert.ok(!/type="checkbox" checked/.test(result.html));
 assert.equal(analyticsRequest('https://mc.yandex.ru.evil.com/watch/1'),false);
});
