const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes,randomUUID}=require('node:crypto');
const root=path.resolve(process.env.REPORTS_DIR||path.join(__dirname,'../data/reports'));
const publicDir=path.resolve(__dirname,'../public');
if(root===publicDir||root.startsWith(publicDir+path.sep))throw new Error('REPORTS_DIR must be outside public');
const valid=token=>/^[a-f0-9]{48}$/.test(token||'');
async function read(token){if(!valid(token))return null;try{return JSON.parse(await fs.readFile(path.join(root,token+'.json'),'utf8'));}catch{return null;}}
async function write(token,value){if(!valid(token))throw new Error('Invalid report');await fs.mkdir(root,{recursive:true});const temporary=path.join(root,token+'.'+randomUUID()+'.tmp');await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,path.join(root,token+'.json'));}
async function create(audit){const token=randomBytes(24).toString('hex');await write(token,{audit,createdAt:Date.now(),expiresAt:Date.now()+7*86400000,orderKey:randomUUID(),paid:false});return token;}
const severity={high:0,medium:1,low:2};
function access(audit){
  const sorted=group=>audit.checks.filter(c=>c.group===group&&c.status==='failed').sort((a,b)=>(severity[a.severity]??9)-(severity[b.severity]??9)||(Number(b.fineMax)||0)-(Number(a.fineMax)||0));
  const legal=sorted('legal'),seo=sorted('seo');
  const hiddenLegal=legal.length>5?legal.length-3:0;
  const hiddenSeo=seo.length>5?seo.length-3:0;
  return {totalLegal:legal.length,visibleLegal:legal.length-hiddenLegal,hiddenLegal,totalSeo:seo.length,visibleSeo:seo.length-hiddenSeo,hiddenSeo,full:hiddenLegal+hiddenSeo===0,visibleIds:[...legal.slice(0,legal.length-hiddenLegal),...seo.slice(0,seo.length-hiddenSeo)].map(c=>c.id)};
}
function full(audit,token){const policy=access(audit);return {...audit,reportToken:token,access:{...policy,hiddenLegal:0,hiddenSeo:0,visibleLegal:policy.totalLegal,visibleSeo:policy.totalSeo,full:true}};}
function preview(audit,token){
  const policy=access(audit);
  const visible=new Set(policy.visibleIds);
  // Hidden findings never reach the browser, including title, evidence and remedy.
  return {...audit,reportToken:token,access:policy,checks:audit.checks.filter(c=>c.status!=='failed'||visible.has(c.id)).map(c=>({...c,fix:(c.group==='legal'?policy.hiddenLegal:policy.hiddenSeo)===0||c.status!=='failed'?c.fix:undefined}))};
}
const expired=record=>!record.paid&&record.expiresAt<=Date.now();
module.exports={read,write,create,preview,access,full,expired,directory:root};
