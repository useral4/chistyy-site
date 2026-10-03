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
function preview(audit,token){return {...audit,reportToken:token,checks:audit.checks.map(check=>({...check,fix:undefined}))};}
module.exports={read,write,create,preview};
