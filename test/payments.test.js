const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const scratch=path.resolve(__dirname,'../../../work/payment-tests-'+process.pid);process.env.REPORTS_DIR=scratch;
const reports=require('../lib/reports');const {handlePayments,configured}=require('../lib/payments');
const {Readable}=require('node:stream');
const request=(url,body)=>Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),{url,method:body?'POST':'GET'});
async function invoke(url,body){let result;await handlePayments(request(url,body),{},(_res,status,data)=>{result={status,...data};});return result;}
test('Test-only API, idempotency, pending/canceled/amount tampering and verified grant',async()=>{
  const original=global.fetch;const old={...process.env};
  try{
    process.env.YOOKASSA_MODE='test';process.env.YOOKASSA_SHOP_ID='1391549';process.env.YOOKASSA_SECRET_KEY='live_not_allowed';process.env.PUBLIC_URL='https://kinavapro.ru';assert.equal(configured(),false);
    const token=await reports.create({url:'https://example.ru',checks:[{id:'title',status:'failed',fix:'SECRET PLAN'}]});
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
    phase='succeeded';amount='1.00';assert.equal((await invoke('/api/report?token='+token)).paid,false);
    amount='179.00';const unlocked=await invoke('/api/report?token='+token);assert.equal(unlocked.paid,true);assert.equal(unlocked.audit.checks[0].fix,'SECRET PLAN');
    const record=await reports.read(token);record.paid=false;await reports.write(token,record);phase='canceled';assert.equal((await invoke('/api/report?token='+token)).canceled,true);assert.equal((await reports.read(token)).paymentId,null);
    assert.equal((await invoke('/api/report?token=../../secret')).status,404);
  }finally{global.fetch=original;for(const key of ['YOOKASSA_MODE','YOOKASSA_SHOP_ID','YOOKASSA_SECRET_KEY','PUBLIC_URL'])if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];if(scratch.startsWith(path.resolve(__dirname,'../../../work')+path.sep))await fs.rm(scratch,{recursive:true,force:true});}
});
