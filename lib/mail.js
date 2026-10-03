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
module.exports={notifyLead};
