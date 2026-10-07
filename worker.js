const http = require('node:http');
const {AuditQueue} = require('./lib/audit-queue');
const {authorized} = require('./lib/operations');
const {fetchText} = require('./lib/safe-fetch');
const {inspectBrowser} = require('./lib/browser-audit');

const queue = new AuditQueue({maxWaiting:4,waitMs:60000});
const respond = (res,status,data) => {
  if(res.destroyed) return;
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
};

async function inspect(req,res) {
  if(!authorized(req,process.env.BROWSER_WORKER_KEY)) return respond(res,403,{error:'Forbidden'});
  if(req.method!=='POST'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) return respond(res,400,{error:'Invalid request'});
  let url;
  try {
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw new Error();chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    url=new URL(body.url);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error();
  }catch{return respond(res,400,{error:'Invalid request'});}
  const controller=new AbortController(), signal=controller.signal;
  const abort=()=>{if(!res.writableEnded)controller.abort();};
  res.once('close',abort);
  let release,deadline;
  try {
    release=await queue.acquire({signal});
    deadline=setTimeout(()=>controller.abort(),30000);
    const page=await fetchText(url.href,12000,{signal});
    if(!page.ok||!/text\/html|application\/xhtml/i.test(page.contentType))throw new Error();
    const result=await inspectBrowser(page,[],{signal});
    signal.throwIfAborted();
    respond(res,200,result);
  }catch{return respond(res,503,{error:'Browser unavailable'});}
  finally{clearTimeout(deadline);res.removeListener('close',abort);release?.();}
}

const server=http.createServer((req,res)=>{
  if(req.url==='/healthz'&&req.method==='GET')return respond(res,queue.closed?503:200,{status:queue.closed?'stopping':'ok'});
  if(req.url==='/inspect')return inspect(req,res).catch(()=>respond(res,503,{error:'Browser unavailable'}));
  respond(res,404,{error:'Not found'});
});
server.headersTimeout=10000;server.requestTimeout=10000;server.maxConnections=16;
if(require.main===module){
  if(!process.env.BROWSER_WORKER_KEY||process.env.BROWSER_WORKER_KEY.length<32||!process.env.BROWSER_EXECUTABLE_PATH||process.env.BROWSER_WORKER_URL)throw new Error('Worker requires a private key and sandboxed browser executable');
  server.listen(Number(process.env.PORT||4180),'0.0.0.0');
  const stop=()=>{queue.close();server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>process.exit(1),35000).unref();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
module.exports={server};
