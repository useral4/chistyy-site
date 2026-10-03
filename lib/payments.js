const reports=require('./reports');
const PRICE='179.00';
const locks=new Map();
const configured=()=>process.env.YOOKASSA_MODE==='test'&&/^\d+$/.test(process.env.YOOKASSA_SHOP_ID||'')&&/^test_/.test(process.env.YOOKASSA_SECRET_KEY||'')&&/^https:\/\//.test(process.env.PUBLIC_URL||'');
function publicConfig(){return {paymentMode:configured()?'test':'unavailable',price:PRICE,metrikaId:/^\d+$/.test(process.env.METRIKA_ID||'')?process.env.METRIKA_ID:null};}
async function provider(endpoint,options={}){
  const response=await fetch('https://api.yookassa.ru/v3/'+endpoint,{...options,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(process.env.YOOKASSA_SHOP_ID+':'+process.env.YOOKASSA_SECRET_KEY).toString('base64'),...options.headers}});
  if(!response.ok)throw new Error('YooKassa request failed');return response.json();
}
async function jsonBody(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw new Error('Payload too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function withLock(token,operation){if(locks.has(token))return locks.get(token);const task=operation();locks.set(token,task);try{return await task;}finally{locks.delete(token);}}
async function handlePayments(req,res,sendJson){
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/payments'){
    if(req.method!=='POST')return sendJson(res,405,{error:'Нужен POST'});
    let data;try{data=await jsonBody(req);}catch{return sendJson(res,400,{error:'Некорректная заявка на оплату'});}
    const output=await withLock(data.reportToken,async()=>{
      const record=await reports.read(data.reportToken);
      if(!record||record.expiresAt<Date.now())return {status:404,error:'Отчёт истёк. Запустите проверку заново.'};
      if(reports.access(record.audit).full)return {status:200,free:true,audit:reports.full(record.audit,data.reportToken)};
      if(!configured())return {status:503,error:'Тестовая ЮKassa ещё не настроена на сервере. Реальные платежи отключены.'};
      if(record.paid)return {status:200,paid:true};
      if(record.paymentId&&record.confirmationUrl)return {status:200,confirmationUrl:record.confirmationUrl,test:true};
      const payment=await provider('payments',{method:'POST',headers:{'Idempotence-Key':record.orderKey},body:JSON.stringify({amount:{value:PRICE,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:new URL('/?report='+data.reportToken,process.env.PUBLIC_URL).href},description:'Тестовый отчёт KinavaPro',metadata:{report_token:data.reportToken}})});
      if(payment.test!==true)throw new Error('Only test payments allowed');
      const confirmation=new URL(payment.confirmation?.confirmation_url||'');
      if(confirmation.protocol!=='https:'||!/(?:^|\.)(?:yookassa\.ru|yoomoney\.ru)$/.test(confirmation.hostname))throw new Error('Invalid payment redirect');
      record.paymentId=payment.id;record.confirmationUrl=confirmation.href;await reports.write(data.reportToken,record);
      return {status:201,confirmationUrl:confirmation.href,test:true};
    });
    const {status,...payload}=output;return sendJson(res,status,payload);
  }
  if(req.method!=='GET')return sendJson(res,405,{error:'Нужен GET'});
  const token=url.searchParams.get('token');
  const output=await withLock(token,async()=>{
    const record=await reports.read(token);if(!record||record.expiresAt<Date.now())return {status:404,error:'Отчёт не найден или истёк'};
    if(!record.paid&&record.paymentId&&configured()){
      const payment=await provider('payments/'+encodeURIComponent(record.paymentId));
      if(payment.test===true&&payment.status==='succeeded'&&payment.paid===true&&payment.amount?.value===PRICE&&payment.amount?.currency==='RUB'&&payment.metadata?.report_token===token){record.paid=true;await reports.write(token,record);}
      else if(payment.status==='canceled'){record.paymentId=null;record.confirmationUrl=null;record.orderKey=require('node:crypto').randomUUID();await reports.write(token,record);return {status:200,paid:false,canceled:true,audit:reports.preview(record.audit,token)};}
    }
    return {status:200,paid:record.paid,paymentPending:!record.paid&&Boolean(record.paymentId),expiresAt:record.expiresAt,audit:record.paid?reports.full(record.audit,token):reports.preview(record.audit,token)};
  });
  const {status,...payload}=output;sendJson(res,status,payload);
}
module.exports={handlePayments,publicConfig,configured};
