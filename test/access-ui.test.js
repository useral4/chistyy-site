const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {load}=require('cheerio');
const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');

function ui() {
  const events=[], message={}, state={tab:'growth'};
  const context=vm.createContext({
    Array,state,paymentPolling:false,encodeURIComponent,
    accessDialog:{close:()=>events.push('close'),showModal:()=>events.push('dialog')},
    showView:(view,label)=>events.push({view,label}),
    restoreReport:async token=>{events.push({report:token});},
    history:{replaceState:(_,__,url)=>events.push({url})},
    document:{querySelector:()=>message}
  });
  vm.runInContext(source.slice(source.indexOf('async function openSavedReport('),source.indexOf("document.querySelectorAll('[data-access-open]')")),context);
  return {context,events,message,state};
}

test('Restoring a personal link with one saved report opens its snapshot without a new audit or package chooser',async()=>{
  const {context,events,state}=ui();
  await context.openAccessDestination({reports:[{token:'a'.repeat(48)}]});
  assert.ok(events.some(event=>event.report==='a'.repeat(48)));
  assert.equal(events.includes('dialog'),false);
  assert.equal(context.paymentPolling,true);
  assert.equal(state.tab,'fines');
  assert.equal(events.at(-1).url,'/?report='+'a'.repeat(48));
});

test('Multiple saved reports require an explicit choice; empty packages show a concrete next action',async()=>{
  const {context,events,message}=ui();
  await context.openAccessDestination({reports:[{token:'a'.repeat(48)},{token:'b'.repeat(48)}]});
  assert.ok(events.includes('dialog'));
  assert.equal(events.some(event=>event.report),false);
  assert.match(message.textContent,/Вводить адрес сайта повторно не нужно/);
  await context.openAccessDestination({reports:[]});
  assert.match(message.textContent,/Проверить сайт/);
});

test('The package panel exposes saved report links directly instead of hiding them inside details',()=>{
  const container={}, status={};
  const context=vm.createContext({
    accessPasses:[{name:'Один сайт',active:true,expiresAt:Date.now()+86400000,used:1,limit:1,remaining:0,domains:['example.ru'],reports:[{token:'c'.repeat(48),url:'https://example.ru/',checkedAt:'2026-10-09T10:00:00Z'}]}],
    escapeHtml:value=>String(value),document:{querySelector:selector=>selector==='[data-access-passes]'?container:status}
  });
  vm.runInContext(source.slice(source.indexOf('function renderAccessPasses()'),source.indexOf('async function refreshAccess()')),context);
  context.renderAccessPasses();
  const $=load(container.innerHTML);
  assert.equal($('details a').length,0);
  assert.equal($('.access-pass__reports a').attr('href'),'/?report='+'c'.repeat(48));
  assert.equal($('.access-pass__reports a strong').text(),'Открыть отчёт');
  assert.equal($('[data-access-check]').length,1);
  assert.match($('[data-access-copy]').text(),/на пакет/);
});

test('Report URLs pasted into the access form open the report rather than restoring package credentials',()=>{
  const handler=source.slice(source.indexOf("document.querySelector('[data-access-restore]').addEventListener"),source.indexOf("document.querySelectorAll('[data-plan-start]')"));
  assert.match(handler,/if\(link\.searchParams\.get\('access'\)\)await openAccessDestination/);
  assert.match(handler,/else await openSavedReport\(token\)/);
});
