const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const scratch=path.resolve(__dirname,'../../../work/payment-tests-'+process.pid);process.env.REPORTS_DIR=scratch;
const reports=require('../lib/reports');const {handlePayments,configured,publicConfig}=require('../lib/payments');
const {Readable}=require('node:stream');
const request=(url,body)=>Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),{url,method:body?'POST':'GET'});
async function invoke(url,body){let result;await handlePayments(request(url,body),{},(_res,status,data)=>{result={status,...data};});return result;}

test('Configuration trims copied values, defaults to test only, and exposes no secrets',()=>{
  const fields=['YOOKASSA_MODE','YOOKASSA_SHOP_ID','YOOKASSA_SECRET_KEY','PUBLIC_URL'];
  const before=Object.fromEntries(fields.map(field=>[field,process.env[field]]));
  try{
    process.env.YOOKASSA_MODE=' TEST ';process.env.YOOKASSA_SHOP_ID=' 1485993 ';
    process.env.YOOKASSA_SECRET_KEY=' test_unit_secret ';process.env.PUBLIC_URL=' https://kinavapro.ru ';
    assert.equal(configured(),true);assert.deepEqual(publicConfig().paymentSetup,[]);
    assert.ok(!JSON.stringify(publicConfig()).includes('test_unit_secret'));
    delete process.env.YOOKASSA_MODE;delete process.env.PUBLIC_URL;
    assert.equal(configured(),true,'Test key can infer test mode, with the canonical return URL');
    process.env.YOOKASSA_MODE='live';assert.equal(configured(),false);
    assert.deepEqual(publicConfig().paymentSetup,[{field:'YOOKASSA_MODE',reason:'invalid'}]);
    process.env.YOOKASSA_MODE='test';delete process.env.YOOKASSA_SECRET_KEY;
    assert.deepEqual(publicConfig().paymentSetup,[{field:'YOOKASSA_SECRET_KEY',reason:'missing'}]);
    process.env.YOOKASSA_SECRET_KEY='live_secret';assert.equal(configured(),false);
  }finally{for(const field of fields)if(before[field]===undefined)delete process.env[field];else process.env[field]=before[field];}
});
test('Test-only API, idempotency, pending/canceled/amount tampering and verified grant',async()=>{
  const original=global.fetch;const old={...process.env};
  try{
    process.env.YOOKASSA_MODE='test';process.env.YOOKASSA_SHOP_ID='1391549';process.env.YOOKASSA_SECRET_KEY='live_not_allowed';process.env.PUBLIC_URL='https://kinavapro.ru';assert.equal(configured(),false);
    const token=await reports.create({url:'https://example.ru',checks:Array.from({length:6},(_,i)=>({id:'legal-'+i,group:'legal',status:'failed',fix:'SECRET PLAN',evidence:'SECRET EVIDENCE '+i}))});
    assert.equal((await invoke('/api/payments',{reportToken:token})).status,503);
    process.env.YOOKASSA_SECRET_KEY='test_fake_for_unit_test';assert.equal(configured(),true);
    let phase='pending',amount='179.00',calls=0;
    global.fetch=async(url,options)=>{
      if(options.method==='POST'){calls++;const payload=JSON.parse(options.body);assert.equal(payload.amount.value,'179.00');assert.equal(options.headers['Idempotence-Key'],(await reports.read(token)).orderKey);}
      return {ok:true,json:async()=>({id:'test-payment',test:true,status:phase,paid:phase==='succeeded',amount:{value:amount,currency:'RUB'},metadata:{report_token:token},confirmation:{confirmation_url:'https://yoomoney.ru/checkout/payments/v2/contract?orderId=test'}})};
    };
    const [a,b]=await Promise.all([invoke('/api/payments',{reportToken:token}),invoke('/api/payments',{reportToken:token})]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(calls,1);
    assert.equal((await invoke('/api/payments',{reportToken:token})).status,200);assert.equal(calls,1);
    let preview=await invoke('/api/report?token='+token);assert.equal(preview.paid,false);assert.equal(preview.audit.checks[0].fix,undefined);
    assert.equal(preview.audit.checks.length,3);assert.equal(preview.audit.access.hiddenLegal,3);assert.ok(!JSON.stringify(preview).includes('SECRET EVIDENCE 5'));
    phase='succeeded';amount='1.00';assert.equal((await invoke('/api/report?token='+token)).paid,false);
    amount='179.00';const unlocked=await invoke('/api/report?token='+token);assert.equal(unlocked.paid,true);assert.equal(unlocked.audit.checks[0].fix,'SECRET PLAN');
    const record=await reports.read(token);record.paid=false;await reports.write(token,record);phase='canceled';assert.equal((await invoke('/api/report?token='+token)).canceled,true);assert.equal((await reports.read(token)).paymentId,null);
    assert.equal((await invoke('/api/report?token=../../secret')).status,404);
    const freeToken=await reports.create({checks:[{id:'small',group:'legal',status:'failed',fix:'FREE PLAN'}]});
    assert.equal((await invoke('/api/payments',{reportToken:freeToken})).free,true);assert.equal(calls,1,'No charge created for a small report');
    assert.equal((await invoke('/api/report?token='+freeToken)).audit.checks[0].fix,'FREE PLAN');
  }finally{global.fetch=original;for(const key of ['YOOKASSA_MODE','YOOKASSA_SHOP_ID','YOOKASSA_SECRET_KEY','PUBLIC_URL'])if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];if(scratch.startsWith(path.resolve(__dirname,'../../../work')+path.sep))await fs.rm(scratch,{recursive:true,force:true});}
});
