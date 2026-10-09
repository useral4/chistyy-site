const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {load} = require('cheerio');
const {reportText, reportHtml} = require('../lib/report-export');
const {withFineRange} = require('../lib/fine-summary');
const audit = {
  url:'https://example.ru/',checkedAt:'2026-10-09T10:00:00Z',scope:'Главная страница и документы.',
  summary:{legalIssues:3,seoIssues:1},checks:[
    ...['form-consent','cookie-consent','analytics-before-consent'].map(id=>({id,group:'legal',title:id,status:'failed',fineMax:300000,evidence:'Найдено на странице',fix:'Исправить настройки',law:'КоАП РФ 13.11 ч. 1',locations:[{url:'https://example.ru/order',forms:[1]}]})),
    {id:'title',group:'seo',status:'review',title:'Заголовок страницы',evidence:'Проверьте вручную'}
  ]
};

test('Offline HTML has mobile styles, separate findings, Russian statuses and the same deduplicated risk',()=>{
  const html=reportHtml(audit), $=load(html);
  assert.equal($('html').attr('lang'),'ru');
  assert.equal($('meta[name="viewport"]').length,1);
  assert.equal($('article').length,4);
  assert.equal($('article h3').length,4);
  assert.equal($('article h4').filter((_,el)=>$(el).text()==='Как исправить').length,3);
  assert.match($('.risk').text(),/150\s000 ₽ – 300\s000 ₽/);
  assert.match($('.note').text(),/3 пункта отчёта; в оценке учтено один раз/);
  assert.match($('.status').last().text(),/Нужна ручная проверка/);
  assert.equal($('script,iframe,img,link').length,0);
  assert.match($('style').text(),/@media\(max-width:480px\)/);
});

test('Untrusted site evidence cannot inject HTML or active links into the downloaded report',()=>{
  const malicious={...audit,url:'javascript:alert(1)',checks:[{group:'legal',status:'failed',title:'</h3><script>alert(1)</script>',evidence:'<img src=x onerror=alert(1)>',source:'javascript:alert(1)',fix:'<iframe src=https://evil.test>'}]};
  const $=load(reportHtml(malicious));
  assert.equal($('script,img,iframe,[onerror]').length,0);
  assert.equal($('a[href^="javascript:"]').length,0);
  assert.match($('article').text(),/<script>alert\(1\)<\/script>/);
  assert.match($('meta[http-equiv="Content-Security-Policy"]').attr('content'),/default-src 'none'/);
});

test('Plain text is grouped, numbered and readable; browser and email use the same template',()=>{
  const text=reportText(audit);
  assert.match(text,/ЮРИДИЧЕСКИЕ РИСКИ/);
  assert.match(text,/SEO-ПРОВЕРКА/);
  assert.match(text,/1\. form-consent\nСтатус: Проблема/);
  assert.match(text,/Как исправить:\nИсправить настройки/);
  assert.match(text,/Дата проверки: .*13:00:00.*МСК/);
  const context=vm.createContext({URL, Intl, Date});
  vm.runInContext(fs.readFileSync(require.resolve('../public/report-export'),'utf8'),context);
  assert.equal(context.KinavaReport.reportHtml(withFineRange(audit)),reportHtml(audit));
});
