const fs=require('node:fs/promises');
const path=require('node:path');
const nodemailer=require('nodemailer');
let transport;
async function notifyLead(request,directory){
  if(!process.env.SMTP_HOST||!process.env.LEADS_EMAIL||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD)return false;
  transport ||= nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:(process.env.SMTP_PORT||'465')==='465',requireTLS:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:15000});
  await transport.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:process.env.LEADS_EMAIL,replyTo:request.email,subject:`Заявка KinavaPro ${request.id}`,text:`Услуга: ${request.service}\nСайт: ${request.website}\nИмя: ${request.name}\nEmail: ${request.email}\nЗадача: ${request.message}\nНомер: ${request.id}`});
  await fs.writeFile(path.join(directory,request.id+'.sent'),new Date().toISOString(),{mode:0o600});return true;
}
function reportEmailConfigured(){return Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD);}
async function notifyReport({email,audit,reportUrl,passExpiresAt,accessUrl}){
  if(!reportEmailConfigured())throw new Error('Отправка почты не настроена');
  transport ||= nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:(process.env.SMTP_PORT||'465')==='465',requireTLS:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:15000});
  await transport.sendMail({
    from:process.env.SMTP_FROM||process.env.SMTP_USER,to:{address:email},subject:'Ваш полный отчёт KinavaPro',
    text:`Полный отчёт по сайту ${audit.url} приложен к письму.\n\nОткрыть отчёт: ${reportUrl}\nКупленный отчёт остаётся доступным после окончания пакета.\n${accessUrl?`\nЛичная ссылка для восстановления пакета: ${accessUrl}\nНовые проверки в пакете доступны до ${new Date(passExpiresAt).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}.\n`:''}\nЛичные ссылки дают доступ к вашим результатам и пакету — не передавайте их посторонним.`,
    attachments:[{filename:'kinavapro-report.txt',content:require('./report-export').reportText(audit),contentType:'text/plain; charset=utf-8'}]
  });
}
module.exports={notifyLead,notifyReport,reportEmailConfigured};
