const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Permit global-unicast IPv6 only; mapped IPv4 and link-local ranges are excluded.
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0|2|10|20):/i.test(address);
}

async function fetchText(input, timeoutMs = 12000, options = {}) {
  const start = Date.now();
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  let url = new URL(input);
  for (let redirect = 0; redirect <= 5; redirect++) {
    signal.throwIfAborted();
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('Разрешены только публичные HTTP/HTTPS-сайты');
    const host = url.hostname.replace(/^\[|\]$/g,'');
    const addresses = net.isIP(host) ? [{address:host,family:net.isIP(host)}] : await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once:true});
      dns.lookup(host,{all:true}).then(resolve,reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(entry=>!publicAddress(entry.address))) throw new Error('Локальные и служебные адреса проверять нельзя');
    const remaining = timeoutMs - (Date.now()-start);
    if (remaining <= 0) throw new Error('Сайт не ответил вовремя');
    const selected = addresses[0];
    const result = await new Promise((resolve,reject)=>{
      const request = (url.protocol === 'https:' ? https : http).request(url, {
        signal,
        method:'GET', headers:{'User-Agent':'KinavaAuditBot/1.0 (+https://kinavapro.ru)','Accept':'text/html,application/xml,text/plain,*/*','Accept-Encoding':'identity'},
        // Pin the validated address, preventing DNS rebinding between validation and connection.
        lookup: (_host, options, callback)=> options.all ? callback(null,[selected]) : callback(null,selected.address,selected.family)
      }, response=>{
        if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
          response.destroy(); resolve({redirect:response.headers.location}); return;
        }
        const chunks=[]; let bytes=0;
        response.on('data',chunk=>{
          try {
            options.onBytes?.(chunk.length);
            bytes+=chunk.length;
            if(bytes>2*1024*1024) response.destroy(new Error('Страница превышает лимит 2 МБ'));
            else chunks.push(chunk);
          } catch(error) { response.destroy(error); }
        });
        response.on('error',reject);
        response.on('end',()=>{
          const contentType=response.headers['content-type']||'';
          let charset=/charset=([^;\s]+)/i.exec(contentType)?.[1]||'utf-8';
          let text; try {text=new TextDecoder(charset).decode(Buffer.concat(chunks));} catch {text=Buffer.concat(chunks).toString('utf8');}
          resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,text,contentType,
            ...(options.binary ? {body:Buffer.concat(chunks)} : {}),
            finalUrl:url.href,responseMs:Date.now()-start,headers:response.headers,
            cookieNames:(response.headers['set-cookie']||[]).map(value=>value.split('=')[0])});
        });
      });
      const timer=setTimeout(()=>request.destroy(new Error('Сайт не ответил вовремя')),remaining);
      request.on('error',reject);request.on('close',()=>clearTimeout(timer));request.end();
    });
    if (!result.redirect) return result;
    url=new URL(result.redirect,url);
  }
  throw new Error('Слишком много перенаправлений');
}
module.exports={fetchText,publicAddress};
