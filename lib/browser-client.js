async function inspectRemote(url, signal) {
  const key = process.env.BROWSER_WORKER_KEY;
  if (!key || key.length < 32) return {available:false,reason:'Браузерный обработчик не настроен'};
  const endpoint = new URL('/inspect',process.env.BROWSER_WORKER_URL);
  if (!['http:','https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Invalid worker endpoint');
  const response = await fetch(endpoint,{
    method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
    body:JSON.stringify({url}),
    signal:AbortSignal.any([AbortSignal.timeout(90000),...(signal ? [signal] : [])])
  });
  if (!response.ok) throw new Error('Worker unavailable');
  const chunks=[]; let bytes=0;
  for await (const chunk of response.body) {
    bytes+=chunk.length;
    if(bytes>3*1024*1024) { await response.body.cancel().catch(()=>{}); throw new Error('Worker response too large'); }
    chunks.push(chunk);
  }
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(result.available!==true) return {available:false,reason:'Браузерная проверка не завершена'};
  if(typeof result.html!=='string'||!Array.isArray(result.analyticsBeforeConsent)||!Array.isArray(result.cookies)) throw new Error('Invalid worker result');
  return {
    available:true,html:result.html,bannerVisible:result.bannerVisible===true,refusalVisible:result.refusalVisible===true,
    analyticsBeforeConsent:result.analyticsBeforeConsent.filter(value=>typeof value==='string').slice(0,64),
    cookies:result.cookies.filter(value=>typeof value==='string').slice(0,128),
    blockedRequests:Number.isInteger(result.blockedRequests)?result.blockedRequests:1
  };
}

module.exports={inspectRemote};
