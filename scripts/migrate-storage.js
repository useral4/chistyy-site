const fs = require('node:fs/promises');
const path = require('node:path');
const storage = require('../lib/storage');

async function migrate(root) {
  if(!storage.enabled())throw new Error('Set DATABASE_URL for the destination database');
  if(!root)throw new Error('Pass the source REPORTS_DIR as the first argument');
  const source=path.resolve(root), counts={report:0,pass:0,existing:0};
  await storage.initialize();
  for(const [namespace,directory] of [['report',source],['pass',path.join(source,'passes')]]) {
    let names;
    try{names=await fs.readdir(directory);}catch(error){if(error.code==='ENOENT'&&namespace==='pass')continue;throw error;}
    for(const name of names.filter(name=>/^[a-f0-9]{48}\.json$/.test(name))) {
      const value=JSON.parse(await fs.readFile(path.join(directory,name),'utf8')), token=name.slice(0,-5);
      if(namespace==='report'&&(!value.audit||typeof value.createdAt!=='number'))throw new Error('Invalid report file');
      if(namespace==='pass'&&(!Array.isArray(value.domains)||!['single','specialist','agency'].includes(value.planId)))throw new Error('Invalid pass file');
      await storage.lock(namespace,token,async()=>{
        const existing=await storage.read(namespace,token);
        if(existing) {
          if(JSON.stringify(existing)!==JSON.stringify(value)) {
            const {isDeepStrictEqual}=require('node:util');
            if(!isDeepStrictEqual(existing,value))throw new Error('Destination contains a conflicting record; migration stopped without overwriting it');
          }
          counts.existing++;return;
        }
        await storage.write(namespace,token,value);counts[namespace]++;
      });
    }
  }
  return counts;
}

if(require.main===module)migrate(process.argv[2]).then(counts=>console.log(JSON.stringify(counts))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>storage.close());
module.exports={migrate};
