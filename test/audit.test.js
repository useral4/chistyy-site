const {test}=require('node:test');const assert=require('node:assert/strict');
const {analyzeHtml}=require('../server');const {enhanceAudit,collectResources}=require('../lib/audit-engine');const {publicAddress,fetchText}=require('../lib/safe-fetch');
function audit(html,extra={}){return enhanceAudit({html,robots:'User-agent: *\nAllow: /\nSitemap: https://example.ru/sitemap.xml',sitemap:'<urlset><url><loc>https://example.ru/</loc></url></urlset>',targetUrl:new URL('https://example.ru'),profile:'lead',timing:{status:200,responseMs:100,finalUrl:'https://example.ru',contentType:'text/html',headers:{}},...extra},analyzeHtml);}
const check=(a,id)=>a.checks.find(c=>c.id===id);
test('Mentions of 152-FZ and privacy do not stand in for a policy link',()=>{
  const a=audit('<form><input type=email></form><p>152-ФЗ. Политика конфиденциальности нужна.</p>');
  assert.equal(check(a,'privacy-policy').status,'failed');
  assert.equal(check(a,'cookie-consent').status,'skipped');
});
test('Accessible policy does not substitute for a cookie banner',()=>{
  const a=audit('<form><input type=email></form><a href="/privacy">Политика конфиденциальности</a><script>ym(123,"init",{})</script>',{resources:[{kind:'privacy',ok:true,text:'<h1>Политика обработки персональных данных</h1><p>Оператор персональных данных</p>',contentType:'text/html'}]});
  assert.equal(check(a,'privacy-policy').status,'passed');
  assert.equal(check(a,'cookie-consent').status,'failed');
  assert.equal(a.summary.fineMax,300000,'Consent/cookie same possible composition is not counted twice');
});
test('Each form is checked; required unrelated checkbox does not satisfy consent',()=>{
  const a=audit('<form><input type=email><label><input type=checkbox required>Согласен на обработку персональных данных</label></form><form><input type=email><label><input type=checkbox required>Получать новости</label></form>');
  assert.equal(check(a,'form-consent').status,'failed');assert.match(check(a,'form-consent').evidence,/без.*: 1/);
});
test('Preselected consent is flagged and registry/localization remain unknown',()=>{
  const a=audit('<form><input type=email><label><input type=checkbox required checked>Согласен на обработку персональных данных</label></form><p>Уведомление Роскомнадзор</p>');
  assert.equal(check(a,'form-consent').status,'failed');assert.equal(check(a,'operator-notice').status,'review');assert.equal(check(a,'data-localization').status,'review');assert.equal(check(a,'data-localization').fineMax,0);
});
test('Local JS analytics is recognized and service copy is not advertising',()=>{
  const a=audit('<p>Исправляем маркировку рекламы и ERID</p>',{resources:[{kind:'script',ok:true,text:'ym(123,"init",{})'}]});
  assert.equal(check(a,'cookie-consent').status,'failed');assert.equal(check(a,'ad-marking').status,'passed');
});
test('Reordered meta attributes and decorative empty alt are valid',()=>{
  const a=audit('<title>Проверка сайта по требованиям и SEO</title><meta content="'+('Достаточно длинное описание страницы сайта и преимуществ услуги. ').repeat(2)+'" name="description"><h1>Проверка</h1><img src="x" alt="">');
  assert.equal(check(a,'description').status,'passed');assert.equal(check(a,'image-alt').status,'passed');
});
test('HTML sitemap error pages, blocking robots, HTTP noindex and malformed JSON-LD are detected',()=>{
  const a=audit('<script type="application/ld+json">{bad}</script>',{robots:'User-agent: *\nDisallow: /',sitemap:'<html>404</html>',timing:{status:200,responseMs:100,finalUrl:'https://example.ru',headers:{'x-robots-tag':'noindex'}}});
  for(const id of ['sitemap','robots-access','meta-robots-index','schema'])assert.equal(check(a,id).status,'failed');
});
test('Internal, mapped and reserved IP ranges are forbidden',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.31.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  await assert.rejects(fetchText('http://127.0.0.1'),/адреса/);
});

test('Contact page forms are checked, including insecure GET and bundled/marketing consent',()=>{
 const a=audit('<h1>Главная</h1>',{resources:[{kind:'page',ok:true,url:'https://example.ru/contact',text:'<form action="http://example.ru/send" method="get"><input type="email"><label><input type="checkbox" required>Согласен на обработку персональных данных и принимаю оферту</label><label><input type="checkbox" checked>Рекламная рассылка</label></form>'}]});
 for(const id of ['form-transport','form-url-data','consent-document','consent-separate','marketing-choice'])assert.equal(check(a,id).status,'failed',id);
 assert.equal(a.facts.dataFormCount,1);assert.match(check(a,'form-transport').locations[0].url,/contact/);assert.deepEqual(check(a,'form-transport').locations[0].forms,[1]);
});
test('Missing policy creates no invented policy-section failures; optional marketing and POST are valid',()=>{
 const a=audit('<form method="post" action="/send"><input type="email"><label><input type="checkbox" required>Согласен на обработку персональных данных <a href="/consent">Согласие</a></label><label><input type="checkbox">Рекламная рассылка</label></form>');
 for(const id of ['form-transport','form-url-data','consent-document','consent-separate','marketing-choice'])assert.equal(check(a,id).status,'passed',id);
 for(const id of ['policy-purposes','policy-data','policy-contact','policy-rights','policy-retention'])assert.equal(check(a,id).status,'skipped',id);
});
test('Analytics banner with acceptance only is distinguished from one allowing refusal',()=>{
 const banner='<script>ym(123,"init",{})</script><div id="cookie-banner">Cookie <button>Принять</button>';
 assert.equal(check(audit(banner+'</div>'),'cookie-refusal').status,'failed');
 assert.equal(check(audit(banner+'<button>Только необходимые</button></div>'),'cookie-refusal').status,'passed');
});
test('Modern blank links are not presented as SEO failures',()=>{
 const a=audit('<a href="https://external.ru" target="_blank">External</a>');
 assert.equal(check(a,'external-link-safety'),undefined);
});

test('Readable policy is checked as a document, excluding the application form and recognizing equivalent wording',()=>{
 const a=audit('<a href="/privacy">Политика конфиденциальности</a>',{resources:[{kind:'privacy',url:'https://example.ru/privacy',ok:true,text:'<h1>Политика обработки персональных данных</h1><p>Мы обрабатываем данные: имя и контакты, для связи и исполнения договора. Срок хранения — до достижения цели. Можно отозвать согласие.</p><form><input type=email><p>Категории субъектов. Контакт privacy@example.ru</p></form>'}]});
 for(const id of ['policy-purposes','policy-data','policy-retention','policy-rights'])assert.equal(check(a,id).status,'passed',id);
 assert.equal(check(a,'policy-contact').status,'failed','Email inside an unrelated request form is not the policy contact');
 assert.equal(check(a,'policy-contact').fineMax,0);
});

test('Operator details are checked on contacts and footer with INN checksum validation',()=>{
 const html='<form><input type=email></form><a href="/contact">Контакты</a>';
 const resource=inn=>({kind:'page',url:'https://example.ru/contact',ok:true,text:'<footer>Оператор. ИНН '+inn+'</footer>'});
 assert.equal(check(audit(html,{resources:[resource('212416070437')]}),'company-details').status,'passed');
 assert.equal(check(audit(html,{resources:[resource('212416070438')]}),'company-details').status,'failed');
});

test('Order terms and broken downloadable documents produce concrete findings',()=>{
 const html='<h1>Сайт</h1><p>Услуга 5000 ₽</p><a href="/terms">Оферта</a>';
 const resources=[{kind:'offer',url:'https://example.ru/terms',ok:true,text:'<h1>Оферта</h1><p>Юридический текст добавим позже</p>'},{kind:'offer',url:'https://example.ru/docs/offer.pdf',ok:false,status:404,text:''}];
 const a=audit(html,{resources});
 assert.equal(check(a,'offer-return').status,'failed');assert.equal(check(a,'document-links').status,'failed');
 assert.equal(check(a,'document-links').locations[0].url,'https://example.ru/docs/offer.pdf');
 const complete=audit(html,{resources:[{kind:'offer',url:'https://example.ru/terms',ok:true,text:'<h1>Оферта</h1><p>Порядок оплаты: банковской картой. Срок оказания услуги 3 дня. Возврат денег по запросу на email.</p>'}]});
 assert.equal(check(complete,'offer-return').status,'passed');
});

test('Consent text by a button and linked labels are checked instead of ignored',()=>{
 const a=audit('<form><input type=email><p>Нажимая кнопку, вы соглашаетесь с обработкой персональных данных.</p></form>');
 assert.equal(check(a,'consent-document').status,'failed');
 const b=audit('<form><input type=email><input type=checkbox id=c required><label for=c>Согласен на обработку ПДн. <a href="/consent">Текст согласия</a></label></form>');
 assert.equal(check(b,'form-consent').status,'passed');assert.equal(check(b,'consent-document').status,'passed');
});

test('Contact and policy pages reveal nested consent and PDF links while external site navigation is excluded',async()=>{
 const seen=[];
 const pages={
  'https://example.ru/contact':'<a href="/consent">Согласие на обработку ПДн</a>',
  'https://example.ru/privacy':'<a href="/docs/privacy.pdf">Скачать PDF политики</a><a href="https://outside.ru/contact">Контакты</a><script src="https://outside.ru/app.js"></script>',
  'https://example.ru/consent':'<h1>Согласие</h1>'
 };
 const resources=await collectResources({finalUrl:'https://example.ru/',text:'<a href="/contact">Контакты</a><a href="/privacy">Политика конфиденциальности</a>'},async url=>{seen.push(url);return {ok:!!pages[url],status:pages[url]?200:404,finalUrl:url,contentType:'text/html',text:pages[url]||''};});
 assert.equal(resources.find(r=>r.url==='https://example.ru/docs/privacy.pdf').status,404);
 assert.equal(resources.find(r=>r.url==='https://example.ru/consent').kind,'consent');assert.ok(!seen.some(url=>url.includes('outside.ru')));
});

test('Browser observations override static cookie assumptions, with no double-counted sanctions',()=>{
 const html='<script>ym(1,"init",{})</script><div class="cookie-banner">Cookie <button>Принять</button></div>';
 const b={available:true,bannerVisible:false,refusalVisible:false,blockedRequests:0,analyticsBeforeConsent:['https://mc.yandex.ru/watch/1']};
 const a=audit(html,{browser:b});assert.equal(check(a,'cookie-consent').status,'failed');assert.equal(check(a,'analytics-before-consent').status,'failed');assert.equal(a.summary.fineMax,300000);
 const good=audit(html,{browser:{...b,bannerVisible:true,refusalVisible:true,analyticsBeforeConsent:[]}});
 assert.equal(check(good,'cookie-consent').status,'passed');assert.equal(check(good,'cookie-refusal').status,'passed');assert.equal(check(good,'analytics-before-consent').status,'passed');
});
