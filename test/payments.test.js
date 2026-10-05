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
    const [a,b]=await Promise.all([invoke('/api/payments',{reportToken:token}),invoke('/api/payments',{reportToken:token})]);assert.equal(a.status,201);assert.equal(b.status,200);assert.equal(a.confirmationUrl,b.confirmationUrl);assert.equal(calls,1);
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

test('Webhook verifies the provider payment and rejects forged entitlement data',async()=>{
  const original=global.fetch;const old={...process.env};
  try{
    process.env.YOOKASSA_MODE='test';process.env.YOOKASSA_SHOP_ID='1485993';process.env.YOOKASSA_SECRET_KEY='test_fake_for_unit_test';
    const token=await reports.create({url:'https://example.ru',checks:Array.from({length:6},(_,i)=>({id:'legal-'+i,group:'legal',status:'failed',fix:'PRIVATE FIX '+i}))});
    const record=await reports.read(token);record.paymentId='22d6d597-000f-5000-9000-145f6df21d6f';await reports.write(token,record);
    const notification={type:'notification',event:'payment.succeeded',object:{id:record.paymentId,metadata:{report_token:token},status:'succeeded',paid:true}};
    let payment={id:record.paymentId,test:true,status:'pending',paid:false,amount:{value:'179.00',currency:'RUB'},metadata:{report_token:token}};
    global.fetch=async()=>({ok:true,json:async()=>payment});
    assert.equal((await invoke('/api/payments/webhook',notification)).received,true);
    assert.equal((await reports.read(token)).paid,false,'Claimed success in a webhook is insufficient');
    payment={...payment,status:'succeeded',paid:true};
    for(const changes of [{id:'different-payment'},{test:false},{paid:false},{amount:{value:'1.00',currency:'RUB'}},{amount:{value:'179.00',currency:'USD'}},{metadata:{report_token:'different-token'}}]){
      const validPayment=payment;payment={...payment,...changes};
      await invoke('/api/payments/webhook',notification);assert.equal((await reports.read(token)).paid,false);
      payment=validPayment;
    }
    const [report,ack]=await Promise.all([invoke('/api/report?token='+token),invoke('/api/payments/webhook',notification)]);
    assert.equal(report.paid,true);assert.equal(ack.received,true);assert.equal(ack.audit,undefined,'Each queued operation gets its own response');
    const paid=await reports.read(token);assert.ok(paid.expiresAt>=paid.paidAt+30*86400000);assert.equal(report.audit.checks.length,6);
    await invoke('/api/payments/webhook',notification);assert.equal((await reports.read(token)).paidAt,paid.paidAt,'Duplicate webhook does not renew access');
  }finally{
    global.fetch=original;for(const field of ['YOOKASSA_MODE','YOOKASSA_SHOP_ID','YOOKASSA_SECRET_KEY'])if(old[field]===undefined)delete process.env[field];else process.env[field]=old[field];
    if(scratch.startsWith(path.resolve(__dirname,'../../../work')+path.sep))await fs.rm(scratch,{recursive:true,force:true});
  }
});

test('Email requires paid access and configured SMTP, with duplicate and recipient limits',async()=>{
  const mail=require('../lib/mail');const original=mail.notifyReport;const old={...process.env};
  const fields=['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','PUBLIC_URL'];
  try{
    process.env.PUBLIC_URL='https://kinavapro.ru';delete process.env.SMTP_HOST;
    const token=await reports.create({url:'https://example.ru',checks:Array.from({length:6},(_,i)=>({id:'legal-'+i,group:'legal',status:'failed',fix:'PRIVATE FIX '+i}))});
    const body={reportToken:token,email:'buyer@example.ru'};
    assert.equal((await invoke('/api/report/email',body)).status,403);
    assert.equal((await invoke('/api/report/email',{...body,email:'invalid'})).status,400);
    assert.equal((await invoke('/api/report/email',{...body,email:'one@example.ru,two@example.ru'})).status,400);
    const record=await reports.read(token);record.paid=true;await reports.write(token,record);
    assert.equal((await invoke('/api/report/email',body)).status,503);
    process.env.SMTP_HOST='smtp.example.ru';process.env.SMTP_USER='reports@example.ru';process.env.SMTP_PASSWORD='test_password';
    let calls=0;mail.notifyReport=async(data)=>{calls++;assert.equal(data.audit.checks[5].fix,'PRIVATE FIX 5');assert.equal(data.reportUrl,'https://kinavapro.ru/?report='+token);};
    const [first,duplicate]=await Promise.all([invoke('/api/report/email',body),invoke('/api/report/email',body)]);
    assert.equal(first.sent,true);assert.equal(duplicate.alreadySent,true);assert.equal(calls,1);
    assert.ok(!JSON.stringify(await reports.read(token)).includes(body.email),'Only recipient hashes are retained');
    mail.notifyReport=async()=>{throw new Error('SMTP unavailable');};
    assert.equal((await invoke('/api/report/email',{...body,email:'second@example.ru'})).status,503);
    assert.equal((await reports.read(token)).deliveries.length,1);
    mail.notifyReport=async()=>{calls++;};
    await invoke('/api/report/email',{...body,email:'second@example.ru'});await invoke('/api/report/email',{...body,email:'third@example.ru'});
    assert.equal((await invoke('/api/report/email',{...body,email:'fourth@example.ru'})).status,429);assert.equal(calls,3);
    assert.equal((await invoke('/api/report?token='+token)).reportEmailAvailable,true);
  }finally{
    mail.notifyReport=original;for(const field of fields)if(old[field]===undefined)delete process.env[field];else process.env[field]=old[field];
    if(scratch.startsWith(path.resolve(__dirname,'../../../work')+path.sep))await fs.rm(scratch,{recursive:true,force:true});
  }
});
