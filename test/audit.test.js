const {test}=require('node:test');const assert=require('node:assert/strict');
const {analyzeHtml}=require('../server');const {enhanceAudit}=require('../lib/audit-engine');const {publicAddress,fetchText}=require('../lib/safe-fetch');
function audit(html,extra={}){return enhanceAudit({html,robots:'User-agent: *\nAllow: /\nSitemap: https://example.ru/sitemap.xml',sitemap:'<urlset><url><loc>https://example.ru/</loc></url></urlset>',targetUrl:new URL('https://example.ru'),profile:'lead',timing:{status:200,responseMs:100,finalUrl:'https://example.ru',contentType:'text/html',headers:{}},...extra},analyzeHtml);}
const check=(a,id)=>a.checks.find(c=>c.id===id);
test('Mentions of 152-FZ and privacy do not stand in for a policy link',()=>{
  const a=audit('<form><input type=email></form><p>152-ФЗ. Политика конфиденциальности нужна.</p>');
  assert.equal(check(a,'privacy-policy').status,'failed');
  assert.equal(check(a,'cookie-consent').status,'review');
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
