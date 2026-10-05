const reports=require('./reports');
const mail=require('./mail');
const {createHash}=require('node:crypto');
const PRICE='179.00';
const locks=new Map();
function settings(){
  const secretKey=(process.env.YOOKASSA_SECRET_KEY||'').trim();
  return {
    mode:(process.env.YOOKASSA_MODE||(/^test_/.test(secretKey)?'test':'')).trim().toLowerCase(),
    shopId:(process.env.YOOKASSA_SHOP_ID||'').trim(),secretKey,
    publicUrl:(process.env.PUBLIC_URL||'https://kinavapro.ru').trim()
  };
}
function configurationIssues(){
  const config=settings();const issues=[];
  if(config.mode!=='test')issues.push({field:'YOOKASSA_MODE',reason:config.mode?'invalid':'missing'});
  if(!/^\d+$/.test(config.shopId))issues.push({field:'YOOKASSA_SHOP_ID',reason:config.shopId?'invalid':'missing'});
  if(!/^test_\S+$/.test(config.secretKey))issues.push({field:'YOOKASSA_SECRET_KEY',reason:config.secretKey?'invalid':'missing'});
  try{const url=new URL(config.publicUrl);if(url.protocol!=='https:'||url.username||url.password)throw new Error();}
  catch{issues.push({field:'PUBLIC_URL',reason:'invalid'});}
  return issues;
}
const configured=()=>configurationIssues().length===0;
function publicConfig(){return {paymentMode:configured()?'test':'unavailable',paymentSetup:configurationIssues(),price:PRICE,metrikaId:/^\d+$/.test(process.env.METRIKA_ID||'')?process.env.METRIKA_ID:null};}
async function provider(endpoint,options={}){
  const config=settings();
  const response=await fetch('https://api.yookassa.ru/v3/'+endpoint,{...options,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(config.shopId+':'+config.secretKey).toString('base64'),...options.headers}});
  if(!response.ok)throw new Error('YooKassa request failed');return response.json();
}
async function jsonBody(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw new Error('Payload too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function withLock(token,operation){
  const previous=locks.get(token)||Promise.resolve();
  const task=previous.catch(()=>{}).then(operation);locks.set(token,task);
  try{return await task;}finally{if(locks.get(token)===task)locks.delete(token);}
}
function confirmed(payment,record,token){
  return payment.id===record.paymentId&&payment.test===true&&payment.status==='succeeded'&&payment.paid===true&&payment.amount?.value===PRICE&&payment.amount?.currency==='RUB'&&payment.metadata?.report_token===token;
}
async function grant(record,token){
  record.paid=true;record.paidAt=Date.now();record.expiresAt=Math.max(record.expiresAt,record.paidAt+30*86400000);
  await reports.write(token,record);
}
async function handlePayments(req,res,sendJson){
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/payments/webhook'){
    if(req.method!=='POST')return sendJson(res,405,{error:'Нужен POST'});
    let data;try{data=await jsonBody(req);}catch{return sendJson(res,400,{error:'Некорректное уведомление'});}
    if(data.event!=='payment.succeeded')return sendJson(res,200,{received:true});
    const token=data.object?.metadata?.report_token;
    if(!/^[a-f0-9]{48}$/.test(token||'')||!/^[a-f0-9-]{36}$/i.test(data.object?.id||''))return sendJson(res,400,{error:'Некорректное уведомление'});
    if(!configured())return sendJson(res,503,{error:'Оплата недоступна'});
    await withLock(token,async()=>{
      const record=await reports.read(token);
      if(!record||record.paid||record.paymentId!==data.object.id)return;
      const payment=await provider('payments/'+encodeURIComponent(record.paymentId));
      if(confirmed(payment,record,token))await grant(record,token);
    });
    return sendJson(res,200,{received:true});
  }
  if(url.pathname==='/api/report/email'){
    if(req.method!=='POST')return sendJson(res,405,{error:'Нужен POST'});
    let data;try{data=await jsonBody(req);}catch{return sendJson(res,400,{error:'Некорректный запрос'});}
    const email=typeof data.email==='string'?data.email.trim():'';
    if(email.length>254||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))return sendJson(res,400,{error:'Укажите корректный email'});
    const output=await withLock(data.reportToken,async()=>{
      const record=await reports.read(data.reportToken);
      if(!record||record.expiresAt<Date.now())return {status:404,error:'Срок доступа к отчёту истёк'};
      if(!record.paid&&record.paymentId&&configured()){
        const payment=await provider('payments/'+encodeURIComponent(record.paymentId));
        if(confirmed(payment,record,data.reportToken))await grant(record,data.reportToken);
      }
      if(!record.paid)return {status:403,error:'Отправка полного отчёта доступна после подтверждённой оплаты'};
      if(!mail.reportEmailConfigured())return {status:503,error:'Отправка на почту пока недоступна. Скачайте отчёт или сохраните ссылку.'};
      const emailHash=createHash('sha256').update(email.toLowerCase()).digest('hex');
      const deliveries=record.deliveries||[];
      if(deliveries.some(item=>item.emailHash===emailHash))return {status:200,sent:true,alreadySent:true};
      if(deliveries.length>=3)return {status:429,error:'Лимит отправки достигнут. Скачайте отчёт на сайте.'};
      try{await mail.notifyReport({email,audit:record.audit,expiresAt:record.expiresAt,reportUrl:new URL('/?report='+data.reportToken,settings().publicUrl).href});}
      catch{return {status:503,error:'Не удалось отправить письмо. Отчёт доступен на сайте; попробуйте позже.'};}
      record.deliveries=[...deliveries,{emailHash,sentAt:Date.now()}];await reports.write(data.reportToken,record);
      return {status:200,sent:true};
    });
    const {status,...payload}=output;return sendJson(res,status,payload);
  }
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
      const payment=await provider('payments',{method:'POST',headers:{'Idempotence-Key':record.orderKey},body:JSON.stringify({amount:{value:PRICE,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:new URL('/?report='+data.reportToken,settings().publicUrl).href},description:'Тестовый отчёт KinavaPro',metadata:{report_token:data.reportToken}})});
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
      if(confirmed(payment,record,token)){await grant(record,token);}
      else if(payment.status==='canceled'){record.paymentId=null;record.confirmationUrl=null;record.orderKey=require('node:crypto').randomUUID();await reports.write(token,record);return {status:200,paid:false,canceled:true,audit:reports.preview(record.audit,token)};}
    }
    return {status:200,paid:record.paid,test:record.paid,reportEmailAvailable:record.paid&&mail.reportEmailConfigured(),paymentPending:!record.paid&&Boolean(record.paymentId),expiresAt:record.expiresAt,audit:record.paid?reports.full(record.audit,token):reports.preview(record.audit,token)};
  });
  const {status,...payload}=output;sendJson(res,status,payload);
}
module.exports={handlePayments,publicConfig,configured};
