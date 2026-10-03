const {test}=require('node:test');const assert=require('node:assert/strict');
const {preview,full}=require('../lib/reports');
const make=n=>({checks:[...Array.from({length:n},(_,i)=>({id:'legal-'+i,group:'legal',status:'failed',title:'Private '+i,evidence:'Evidence '+i,fix:'Fix '+i,severity:'medium'})),{id:'manual',group:'legal',status:'review',fix:'Manual'},{id:'seo',group:'seo',status:'failed',fix:'SEO'}]});
test('0–5 legal failures are free; six or more expose only three; reviews and SEO are not sold',()=>{
 for(let n=0;n<=5;n++){const p=preview(make(n),'token');assert.equal(p.access.full,true);assert.equal(p.checks.length,n+2);assert.equal(p.access.hiddenLegal,0);}
 const p=preview(make(6),'token');assert.equal(p.access.full,false);assert.equal(p.access.hiddenLegal,3);assert.equal(p.checks.length,5);
 for(const id of ['legal-3','legal-4','legal-5'])assert.ok(!JSON.stringify(p).includes(id));
 assert.equal(p.checks.find(c=>c.id==='seo').fix,'SEO');assert.equal(p.checks.find(c=>c.id==='manual').fix,'Manual');
 const unlocked=full(make(6),'token');assert.equal(unlocked.access.full,true);assert.equal(unlocked.checks.length,8);assert.equal(unlocked.checks[5].fix,'Fix 5');
});
