const fs = require('node:fs/promises');
const path = require('node:path');
const nodemailer = require('nodemailer');

function conditions(metrics, healthy, backupAt, now=Date.now()) {
  const values=Object.fromEntries(metrics.split('\n').filter(line=>/^kinava_/.test(line)).map(line=>{const [name,value]=line.split(' ');return [name,Number(value)];}));
  return [
    !healthy && 'Приложение или база данных не отвечает',
    values.kinava_audits_waiting>=5 && 'В очереди пять или больше проверок',
    values.kinava_process_resident_memory_bytes>700*1024*1024 && 'Память приложения превышает 700 МБ',
    (!backupAt||now-backupAt>3600000) && 'Нет успешной резервной копии за последний час'
  ].filter(Boolean);
}

async function run() {
  if(!process.env.METRICS_TOKEN||process.env.METRICS_TOKEN.length<32)throw new Error('Configure METRICS_TOKEN');
  const directory=process.env.OPS_DIR||'/var/lib/kinavapro/operations';
  let state={count:0,open:false,lastAlert:0}, backup;
  try{state=JSON.parse(await fs.readFile(path.join(directory,'monitor.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  try{backup=JSON.parse(await fs.readFile(path.join(directory,'backup.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  let healthy=false,metrics='';
  try {
    const base=process.env.MONITOR_BASE_URL||'http://127.0.0.1:'+Number(process.env.PORT||4173);
    const [health,response]=await Promise.all([
      fetch(base+'/readyz',{signal:AbortSignal.timeout(8000)}),
      fetch(base+'/metrics',{headers:{Authorization:'Bearer '+process.env.METRICS_TOKEN},signal:AbortSignal.timeout(8000)})
    ]);
    healthy=health.ok&&response.ok;
    if(response.ok)metrics=await response.text();
  }catch{}
  const issues=conditions(metrics,healthy,backup?.completedAt), now=Date.now();
  state.count=issues.length?state.count+1:0;
  const alert=issues.length&&(state.count>=3||!healthy)&&(!state.open||now-state.lastAlert>1800000);
  const recovery=!issues.length&&state.open;
  if(alert||recovery) {
    if(!process.env.OPS_EMAIL||!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD)throw new Error('Operator alert is pending: configure OPS_EMAIL and SMTP');
    const port=Number(process.env.SMTP_PORT||465);
    const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:15000});
    try {
      await transport.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:process.env.OPS_EMAIL,
        subject:recovery?'kinava: работа восстановлена':'kinava: требуется внимание к серверу',
        text:recovery?'Проверки состояния и резервного копирования снова проходят.':issues.join('\n')+'\nПроверьте журналы и состояние очереди. Это уведомление не содержит пользовательских адресов или ключей.'});
    }finally{transport.close();}
    state.open=Boolean(alert);state.lastAlert=now;
  }
  await fs.mkdir(directory,{recursive:true});
  const temporary=path.join(directory,'monitor.tmp');
  await fs.writeFile(temporary,JSON.stringify(state),{mode:0o600});
  await fs.rename(temporary,path.join(directory,'monitor.json'));
  console.log(issues.length?'Operations warning: '+issues.join('; '):'Operations checks passed');
}

if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={conditions};
