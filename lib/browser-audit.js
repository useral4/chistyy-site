const {chromium}=require('playwright-core');
const {fetchText}=require('./safe-fetch');
const {inspectRemote}=require('./browser-client');

let busy=false;
const analyticsRequest=url=>/^https?:\/\/(?:[^/]+\.)?(?:mc\.yandex\.(?:ru|com)|google-analytics\.com|analytics\.google\.com)\/(?:watch|collect|g\/collect|j\/collect|r\/collect)(?:\/|\?|$)/i.test(url);

async function launchBrowser() {
  const env={PATH:process.env.PATH||'',SystemRoot:process.env.SystemRoot||'',TEMP:process.env.TEMP||'',TMP:process.env.TMP||''};
  const securityArgs=['--host-resolver-rules=MAP * ~NOTFOUND','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-background-networking','--js-flags=--max-old-space-size=96','--renderer-process-limit=1'];
  if(process.env.BROWSER_EXECUTABLE_PATH)return chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true,chromiumSandbox:true,env,args:securityArgs,timeout:10000});
  if(process.platform==='win32')return chromium.launch({channel:'msedge',headless:true,env,args:securityArgs,timeout:10000});
  const chromiumPackage=require('@sparticuz/chromium');
  const pack=chromiumPackage.default||chromiumPackage;
  pack.setGraphicsMode=false;
  const executablePath=await pack.executablePath();
  env.LD_LIBRARY_PATH=process.env.LD_LIBRARY_PATH||'';
  return chromium.launch({executablePath,headless:true,env,args:[...pack.args,...securityArgs],timeout:10000});
}

async function inspectBrowser(pageResource,resources,options={}) {
  if(process.env.BROWSER_WORKER_URL) {
    try{return await inspectRemote(pageResource.finalUrl,options.signal);}
    catch {options.signal?.throwIfAborted();return {available:false,reason:'Изолированный браузерный обработчик временно недоступен'};}
  }
  if(process.env.BROWSER_AUDIT==='off'||busy)return {available:false,reason:busy?'Браузерная проверка занята; выполнен анализ исходных страниц':'Браузерная проверка отключена'};
  busy=true;
  let browser,deadline;
  const abort=()=>browser?.close().catch(()=>{});
  options.signal?.addEventListener('abort',abort,{once:true});
  try{
    options.signal?.throwIfAborted();
    browser=await launchBrowser();
    options.signal?.throwIfAborted();
    deadline=setTimeout(()=>browser.close().catch(()=>{}),20000);
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false});
    const cache=new Map([pageResource,...resources].filter(r=>r.ok).map(r=>[r.finalUrl||r.url,r]));
    const signals=new Set();let requestCount=0,bytes=0,blocked=0;
    const getResource=options.fetchResource||fetchText;
    let downloaded=0;
    // Every browser request is fulfilled through DNS-pinned public-only fetches.
    // Chromium itself cannot resolve hosts; WebSockets and non-GET requests are blocked.
    await context.routeWebSocket('**/*',socket=>socket.close());
    await context.route('**/*',async route=>{
      const request=route.request(),url=request.url();
      if(analyticsRequest(url)){signals.add(url.split('?')[0]);await route.abort();return;}
      if(request.method()!=='GET'||!['document','script','stylesheet','xhr','fetch'].includes(request.resourceType())){await route.abort();return;}
      if(++requestCount>64){blocked++;await route.abort();return;}
      try{
        const response=cache.get(url)||await getResource(url,4000,{binary:true,signal:options.signal,onBytes(count){downloaded+=count;if(downloaded>12*1024*1024)throw new Error('Browser transfer budget exceeded');}});
        if(response.finalUrl&&response.finalUrl!==url){await route.fulfill({status:302,headers:{location:response.finalUrl}});return;}
        const body=response.body||Buffer.from(response.text||'');bytes+=body.length;
        if(bytes>12*1024*1024){blocked++;await route.abort();return;}
        const headers={};for(const [key,value] of Object.entries(response.headers||{}))if(!/^(?:content-length|content-encoding|transfer-encoding|connection)$/i.test(key))headers[key]=Array.isArray(value)?value.join('\n'):String(value);
        const contentType=response.body?(response.contentType||'text/plain'):(response.contentType||'text/plain').replace(/;\s*charset=[^;]+/i,'')+'; charset=utf-8';
        headers['content-type']=contentType;
        await route.fulfill({status:response.status||200,headers,body});
      }catch{blocked++;await route.abort().catch(()=>{});}
    });
    const page=await context.newPage();
    await page.goto(pageResource.finalUrl,{waitUntil:'domcontentloaded',timeout:12000});
    await page.waitForTimeout(options.settleMs??3500);
    const snapshot=await page.evaluate(()=>{
      const visible=el=>{const style=getComputedStyle(el);return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&el.getClientRects().length>0;};
      const candidates=[...document.querySelectorAll('[id],[class],[data-cookie-banner]')].filter(el=>
        /cookie[-_ ]?(?:banner|consent|notice)|(?:banner|consent|notice)[-_ ]?cookie/i.test((el.id||'')+' '+el.className)||el.hasAttribute('data-cookie-banner'));
      const banners=candidates.filter(el=>visible(el)&&/cookie|куки/i.test(el.textContent)&&[...el.querySelectorAll('button,a,input[type=button]')].some(visible));
      const refusal=banners.some(el=>[...el.querySelectorAll('button,a,input[type=button]')].some(control=>visible(control)&&/отказ|отклон|только необходим|без аналитик|reject|decline|necessary only/i.test(control.textContent+' '+(control.value||''))));
      // Exclude forms inside unopened dialogs or hidden screens from this snapshot.
      const html=document.documentElement.cloneNode(true);
      const originalForms=[...document.querySelectorAll('form')];
      [...html.querySelectorAll('form')].forEach((form,i)=>{
        if(!visible(originalForms[i])){form.remove();return;}
        const boxes=[...originalForms[i].querySelectorAll('input[type=checkbox]')];
        [...form.querySelectorAll('input[type=checkbox]')].forEach((box,j)=>box.toggleAttribute('checked',boxes[j].checked));
      });
      return {html:html.outerHTML,bannerVisible:banners.length>0,refusalVisible:refusal};
    });
    if(Buffer.byteLength(snapshot.html)>2*1024*1024)throw new Error('Browser snapshot too large');
    return {available:true,...snapshot,analyticsBeforeConsent:[...signals],cookies:(await context.cookies()).map(cookie=>cookie.name),blockedRequests:blocked};
  }catch{return {available:false,reason:'Не удалось завершить браузерную проверку; выводы основаны на исходных страницах'};}
  finally{clearTimeout(deadline);options.signal?.removeEventListener('abort',abort);await browser?.close().catch(()=>{});busy=false;}
}

module.exports={inspectBrowser,analyticsRequest};
