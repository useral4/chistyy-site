(() => {
  const banner=document.querySelector('[data-cookie-banner]');
  const key='kinava-cookie-choice-v1';
  let choice=null,config=null,loaded=false;
  try {const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&Date.now()-saved.at<180*86400000)choice=saved.choice;}catch{}
  function startAnalytics(){
    if(loaded||choice!=='accepted'||!config?.metrikaId)return;
    loaded=true;
    window.ym=window.ym||function(){(window.ym.a=window.ym.a||[]).push(arguments);};window.ym.l=Date.now();
    const script=document.createElement('script');script.src='https://mc.yandex.ru/metrika/tag.js';script.async=true;document.head.append(script);
    window.ym(Number(config.metrikaId),'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:false});
  }
  function choose(value){choice=value;try{localStorage.setItem(key,JSON.stringify({choice:value,at:Date.now()}));}catch{}banner.hidden=true;
    if(value==='accepted')startAnalytics();else if(loaded)window.location.reload();
  }
  if(!choice)banner.hidden=false;
  document.querySelector('[data-cookie-accept]')?.addEventListener('click',()=>choose('accepted'));
  document.querySelector('[data-cookie-decline]')?.addEventListener('click',()=>choose('declined'));
  document.querySelector('[data-cookie-settings]')?.addEventListener('click',()=>{banner.hidden=false;document.querySelector('[data-cookie-decline]').focus();});
  fetch('/api/config').then(r=>r.json()).then(value=>{config=value;startAnalytics();}).catch(()=>{});
})();
