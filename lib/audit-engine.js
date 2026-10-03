const cheerio = require('cheerio');
const {fetchText} = require('./safe-fetch');
const LAW_URL='https://www.consultant.ru/document/cons_doc_LAW_34661/1f421640c6775ff67079ebde06a7d2f6d17b96db/';
const privacyPattern=/политик[а-яё\s]*(?:конфиденциальност|обработк|персональн)|privacy|personal.data.policy/i;
const consentPattern=/соглас[а-яё\s]*(?:на\s+)?обработк[а-яё\s]*персональн|соглас[а-яё\s]*на\s+обработку\s+(?:указанных\s+)?данных/i;
const attr=(node,name)=>node.attr(name)||'';

async function collectResources(page) {
  const $=cheerio.load(page.text), base=new URL(page.finalUrl);
  const urls=new Map();
  $('script[src]').slice(0,8).each((_,el)=>{try{const url=new URL($(el).attr('src'),base);if(url.origin===base.origin)urls.set(url.href,'script');}catch{}});
  $('a[href]').each((_,el)=>{const link=$(el);if(privacyPattern.test(link.text()+' '+attr(link,'href'))){try{const url=new URL(attr(link,'href'),base);if(url.origin===base.origin && urls.size<12)urls.set(url.href,'privacy');}catch{}}});
  return await Promise.all([...urls].map(async([url,kind])=>{try{const response=await fetchText(url,5000);return {url,kind,...response};}catch{return {url,kind,ok:false,status:0,text:''};}}));
}

function enhanceAudit(options, legacy) {
  const {html,timing,robots='',sitemap='',resources=[]}=options;
  const $=cheerio.load(html);const audit=legacy(options);const base=new URL(timing.finalUrl||options.targetUrl.href);
  const checks=new Map(audit.checks.map(check=>[check.id,check]));
  const put=(id,group,title,status,evidence,fix,extra={})=>checks.set(id,{id,group,title,status,severity:status==='failed'?'medium':'low',fineMax:0,evidence,fix,...extra});
  const test=(id,title,ok,evidence,fix,extra={})=>put(id,'seo',title,ok?'passed':'failed',evidence,fix,extra);
  const meaningful=$.root().clone();meaningful.find('script,style,template,noscript').remove();
  const text=meaningful.text().replace(/\s+/g,' ').trim();
  const privacyLinks=$('a[href]').toArray().filter(el=>privacyPattern.test($(el).text()+' '+attr($(el),'href')) && !/^#?$/.test(attr($(el),'href')));
  const privacyDocs=resources.filter(r=>r.kind==='privacy');
  const readablePolicy=privacyDocs.some(r=>r.ok && !r.contentType?.includes('pdf') && privacyPattern.test(cheerio.load(r.text)('h1,h2,title').text()) && /оператор|персональн|data controller/i.test(cheerio.load(r.text)('body').text()) && !/проект документа|для тестовой версии|черновик/i.test(cheerio.load(r.text)('body').text()));
  const dataForms=$('form').toArray().filter(el=>$(el).find('input[type=email],input[type=tel],input[name*=name],textarea,input[name*=phone]').length);
  const badForms=dataForms.filter(el=>{
    const form=$(el);return !form.find('input[type=checkbox][required]').toArray().some(box=>{
      const label=$(box).closest('label'); const linked=$(box).attr('id') ? form.find('label').filter((_,l)=>$(l).attr('for')===$(box).attr('id')) : null;
      return consentPattern.test(label.text()+(linked?.text()||'')) && !$(box).is('[checked]');
    });
  });
  const scripts=$('script:not([type="application/ld+json"])').map((_,el)=>$(el).text()+' '+attr($(el),'src')).get().join('\n')+'\n'+resources.filter(r=>r.kind==='script'&&r.ok).map(r=>r.text).join('\n');
  const analytics=/mc\.yandex\.ru|googletagmanager\.com|google-analytics\.com|facebook\.net|\b(?:ym|gtag|fbq)\s*\(/i.test(scripts);
  const cookieCode=/document\.cookie|cookies?\.set\s*\(/i.test(scripts)||(timing.cookieNames||[]).length>0;
  const banners=$('[id],[class],[data-cookie-banner]').toArray().filter(el=>/cookie[-_ ]?(?:banner|consent|notice)|(?:banner|consent|notice)[-_ ]?cookie/i.test(attr($(el),'id')+' '+attr($(el),'class')) || $(el).is('[data-cookie-banner]'));
  const bannerPresent=banners.some(el=>$(el).find('button,input[type=button],a').length && /cookie|куки/i.test($(el).text()));
  const privacyStatus=readablePolicy?'passed':privacyLinks.length?'review':dataForms.length?'failed':'review';
  put('privacy-policy','legal','Доступная политика персональных данных',privacyStatus,readablePolicy?'Ссылка на политику ведёт на доступный документ с признаками политики оператора':privacyLinks.length?'Ссылка найдена, но содержание документа не удалось подтвердить':'Ссылка на политику персональных данных не найдена в HTML', 'Опубликуйте документ оператора и поставьте ссылки в футере и рядом с формами',{severity:'high',fineMax:privacyStatus==='failed'?60000:0,law:'152-ФЗ, ст. 18.1; КоАП РФ 13.11 ч. 3',sanctionGroup:'13.11.3',source:LAW_URL,condition:'Справочный предел для юридического лица при установленном нарушении обязанности публикации'});
  put('form-consent','legal','Согласие у каждой формы сбора данных',!dataForms.length?'passed':badForms.length?'failed':'passed',`Форм сбора контактных данных: ${dataForms.length}; без отдельного обязательного непредустановленного согласия: ${badForms.length}`, 'Проверьте правовое основание обработки; где нужно согласие, добавьте отдельный чекбокс и ссылку на текст согласия',{severity:'high',fineMax:badForms.length?300000:0,law:'152-ФЗ, ст. 6, 9; КоАП РФ 13.11 ч. 1',sanctionGroup:'13.11.1',source:LAW_URL,condition:'Отсутствие чекбокса само по себе не доказывает незаконную обработку: нужно проверить другие основания'});
  put('cookie-consent','legal','Cookie-баннер и аналитика',bannerPresent?'passed':analytics||cookieCode?'failed':'review',bannerPresent?'В HTML найден блок уведомления с управляющими элементами; фактический порядок запуска нужно проверить в браузере':analytics||cookieCode?`Баннер не найден; ${analytics?'в скриптах обнаружена аналитика':'есть запись cookie или Set-Cookie'}`:'Баннер не найден. Статический анализ не подтвердил запись cookie; подключаемые после действий скрипты требуют проверки', 'До согласия блокируйте необязательную аналитику, дайте отказ и выбор настроек; необходимые cookie опишите отдельно',{severity:'high',fineMax:!bannerPresent&&analytics?300000:0,law:'152-ФЗ, ст. 6, 9, 18.1; возможная применимость КоАП РФ 13.11 ч. 1',sanctionGroup:'13.11.1',source:LAW_URL,condition:'Отдельного автоматического штрафа за отсутствие баннера нет; зависит от фактической обработки данных'});
  put('cookie-policy','legal','Описание cookie и счётчиков',readablePolicy?'review':'review',`Аналитика ${analytics?'обнаружена':'не обнаружена'}; полнота описания целей и идентификаторов требует проверки`, 'Укажите виды идентификаторов, сроки хранения, получателей и способ изменения выбора');
  put('operator-notice','legal','Уведомление в реестр РКН',dataForms.length?'review':'passed',dataForms.length?'Наличие уведомления не устанавливается по упоминанию РКН на сайте':'Формы сбора контактов не найдены; иные способы обработки не проверены','Проверьте оператора по ИНН в реестре РКН и основания исключений',{law:'152-ФЗ, ст. 22; КоАП РФ 13.11 ч. 10',referenceFine:300000,source:LAW_URL});
  put('data-localization','legal','Локализация баз данных в РФ','review','Место первичного хранения персональных данных не определено. Страна IP или CDN не доказывает расположение базы данных','Уточните расположение базы заявок, резервных копий, CRM и цепочку передачи данных',{law:'152-ФЗ, ст. 18 ч. 5; КоАП РФ 13.11 ч. 8',referenceFine:6000000,source:LAW_URL});
  put('data-retention','legal','Сроки хранения и удаление данных',dataForms.length?'review':'passed','Сроки хранения, журнал согласий и удаление данных не устанавливаются по главной странице','Установите сроки по целям, порядок отзыва согласия и удаления заявок');
  const adElements=$('[class],[id]').toArray().filter(el=>/(?:^|\s)(?:advertisement|sponsored|ad-slot|ads-banner)(?:\s|$)/i.test(attr($(el),'class')+' '+attr($(el),'id')));
  put('ad-marking','legal','Рекламные размещения и ERID',adElements.length?'review':'passed',adElements.length?'Есть разметка возможных рекламных блоков; характер размещения требует проверки':'Признаков рекламного размещения в разметке не найдено; упоминания ERID в описании услуги не считаются рекламой','Для действительных рекламных размещений проверьте маркировку и идентификатор');
  put('children-data','legal','Данные детей и специальные категории','review','Тематика текста не доказывает сбор специальных категорий данных','Проверьте состав полей и процессы: здоровье, биометрия, возраст, согласие представителя');
  const hasTaxId=/\b\d{10}(?:\d{2})?\b/.test(text)&&/инн/i.test(text);
  put('company-details','legal','Идентификация оператора и исполнителя',hasTaxId?'passed':'review',hasTaxId?'В тексте страницы найдены ИНН и числовой идентификатор; принадлежность требует проверки':'Одного слова «реквизиты» недостаточно: ИНН оператора на странице не подтверждён','Укажите имя/наименование, ИНН и контакты исполнителя; проверьте их по реестру');
  for(const id of ['offer-return','payment-docs']){const old=checks.get(id);old.status='review';old.fineMax=0;old.evidence='Упоминание оплаты или возврата не подтверждает полноту условий и порядок выдачи чека. Требуется проверка документа и сценария покупки';}
  const metas=name=>$('meta').filter((_,el)=>attr($(el),'name').toLowerCase()===name);
  const title=$('title').text().trim(), description=attr(metas('description').first(),'content').trim();
  test('title','Title страницы',title.length>=20&&title.length<=70,`Title: «${title||'не найден'}» (${title.length} символов)`,'Сделайте уникальный title с услугой и брендом');
  test('description','Meta description',description.length>=70&&description.length<=170,`Description: «${description||'не найден'}» (${description.length} символов)`,'Опишите пользу страницы и услугу в description');
  test('meta-duplicates','Дубли title и description',$('title').length===1&&metas('description').length===1,`Title: ${$('title').length}; description: ${metas('description').length}`,'Оставьте по одному непустому title и description');
  test('h1','Главный H1',$('h1').length===1,`H1 в исходном HTML: ${$('h1').length}`,'Оставьте один H1; заголовки скрытых экранов переведите в H2');
  const headings=$('h1,h2,h3,h4,h5,h6').toArray();let previous=0;const jumps=[];
  headings.forEach(el=>{const level=Number(el.tagName[1]);if(previous&&level>previous+1)jumps.push($(el).text().trim().slice(0,80));previous=level;});
  test('heading-order','Порядок заголовков',!jumps.length,`Пропусков уровней: ${jumps.length}${jumps.length?'; '+jumps.slice(0,3).join('; '):''}`,'Соблюдайте последовательность H1 → H2 → H3');
  const images=$('img').toArray(),missingAlt=images.filter(el=>$(el).attr('alt')===undefined);
  test('image-alt','Alt изображений',!missingAlt.length,`Без атрибута alt: ${missingAlt.length} из ${images.length}; пустой alt допустим для декора`,'Добавьте описания смысловым изображениям, декоративным — пустой alt');
  const missingDimensions=images.filter(el=>!$(el).attr('width')||!$(el).attr('height'));
  test('image-dimensions','Размеры изображений',!missingDimensions.length,`Без width/height: ${missingDimensions.length}; CSS-размеры не проверены`,'Укажите размеры или aspect-ratio, затем измерьте CLS');
  const canonical=$('link').filter((_,el)=>attr($(el),'rel').toLowerCase().split(/\s+/).includes('canonical'));
  let canonicalOk=false;try{const url=new URL(attr(canonical.first(),'href'));canonicalOk=['http:','https:'].includes(url.protocol);}catch{}
  test('canonical','Абсолютный canonical',canonical.length===1&&canonicalOk,`Canonical: ${attr(canonical.first(),'href')||'не найден'}`,'Добавьте один абсолютный canonical на основную версию страницы');
  for(const property of ['og:title','og:description','og:image','og:url'])test(property,property,$('meta').toArray().some(el=>attr($(el),'property')===property&&attr($(el),'content').trim()),`${property} ${$('meta').toArray().some(el=>attr($(el),'property')===property&&attr($(el),'content').trim())?'заполнен':'не заполнен'}`,'Заполните Open Graph для превью ссылки');
  checks.delete('open-graph');
  test('favicon','Favicon',$('link').toArray().some(el=>/\bicon\b/i.test(attr($(el),'rel'))&&attr($(el),'href')), 'Проверено объявление иконки в HTML; доступность файла не проверена','Подключите favicon и проверьте HTTP 200 для файла');
  test('viewport','Meta viewport',metas('viewport').toArray().some(el=>/width=device-width/.test(attr($(el),'content'))),'Проверено width=device-width; реальная адаптивность требует браузерного теста','Добавьте viewport и проверьте интерфейс на телефоне');
  test('charset','Кодировка документа',$('meta[charset]').length>0||/charset=/i.test(timing.contentType||''),'Проверена декларация кодировки','Укажите charset=utf-8');
  const noindex=/noindex/i.test(attr(metas('robots'),'content')+' '+(timing.headers?.['x-robots-tag']||''));
  test('meta-robots-index','Индексация: meta и HTTP-заголовок',!noindex,noindex?'Найден noindex в meta robots или X-Robots-Tag':'noindex в meta robots и X-Robots-Tag не найден','Уберите запрет, если страница должна попасть в поиск',{severity:'high'});
  test('http-status','HTTP-статус страницы',timing.status===200,`Финальный ответ: HTTP ${timing.status}`,'Верните статус 200 для доступной посадочной страницы',{severity:'high'});
  test('mixed-content','Смешанный контент',base.protocol!=='https:'||!$('script[src],link[href],img[src],iframe[src]').toArray().some(el=>/^http:/.test(attr($(el),'src')||attr($(el),'href'))),'Проверены URL ресурсов в HTML','Используйте HTTPS для скриптов, стилей и изображений');
  const externalBlank=$('a[target="_blank"]').toArray().filter(el=>!/(noopener|noreferrer)/i.test(attr($(el),'rel')));
  test('external-link-safety','Безопасность внешних ссылок',!externalBlank.length,`Ссылок target=_blank без rel: ${externalBlank.length}`,'Добавьте rel=noopener к внешним ссылкам');
  let invalidJson=0, validJson=0;$('script[type="application/ld+json"]').each((_,el)=>{try{JSON.parse($(el).text());validJson++;}catch{invalidJson++;}});
  test('schema','Валидный JSON-LD',validJson>0&&!invalidJson,`Валидных JSON-LD блоков: ${validJson}; невалидных: ${invalidJson}; семантика схемы не проверена`,'Добавьте и проверьте WebSite/Organization или подходящий тип');
  const robotsOk=/^\s*user-agent\s*:/im.test(robots);
  test('robots','robots.txt',robotsOk,robotsOk?'Найдена директива User-agent':'Файл недоступен или не содержит User-agent','Добавьте robots.txt с правилами для поисковых роботов');
  const groups=robots.split(/\n\s*\n/);const allBlocked=groups.some(g=>/^\s*user-agent\s*:\s*\*\s*$/im.test(g)&&/^\s*disallow\s*:\s*\/\s*$/im.test(g));
  test('robots-access','Глобальный запрет в robots.txt',!allBlocked,allBlocked?'В группе User-agent: * обнаружен Disallow: /':'Глобальный Disallow: / для * не найден; путь и правила отдельных роботов нужно проверить','Откройте страницы, предназначенные для поиска',{severity:'high'});
  test('robots-sitemap','Ссылка на sitemap в robots.txt',/^\s*sitemap\s*:\s*https?:\/\//im.test(robots),'Проверена абсолютная директива Sitemap','Укажите абсолютный URL sitemap.xml');
  const xml=cheerio.load(sitemap,{xmlMode:true}); const locations=xml('urlset > url > loc, sitemapindex > sitemap > loc');
  test('sitemap','XML-карта сайта',locations.length>0,`URL или вложенных карт в sitemap: ${locations.length}`,'Добавьте корректный sitemap.xml с индексируемыми URL');
  put('core-web-vitals','seo','Core Web Vitals и фактическая мобильность','review','HTML-анализ не измеряет LCP, INP, CLS и поведение макета','Проверьте PageSpeed Insights и реальные пользовательские метрики');
  const bodyTextLength=text.length;
  test('text-volume','Объём текста',bodyTextLength>=500,`Текст без script/style/template: ${bodyTextLength} символов; полнота и качество не оценены`,'Добавьте полезный текст под задачу клиента');
  test('image-loading','Отложенная загрузка изображений',images.length<3||images.some(el=>attr($(el),'loading')==='lazy'),`Изображений с lazy: ${images.filter(el=>attr($(el),'loading')==='lazy').length}`,'Добавьте lazy ниже первого экрана; LCP-изображение не откладывайте');
  audit.checks=[...checks.values()];
  const failed=audit.checks.filter(c=>c.status==='failed');const legal=failed.filter(c=>c.group==='legal');
  const sanctions=new Map();for(const c of legal)if(c.fineMax)sanctions.set(c.sanctionGroup||c.id,Math.max(sanctions.get(c.sanctionGroup||c.id)||0,c.fineMax));
  const fineMax=[...sanctions.values()].reduce((sum,n)=>sum+n,0);
  audit.summary={...audit.summary,score:Math.round(100*audit.checks.filter(c=>c.status==='passed').length/audit.checks.length),fineMax,legalIssues:legal.length,seoIssues:failed.filter(c=>c.group==='seo').length,totalIssues:failed.length,reviewIssues:audit.checks.filter(c=>c.status==='review').length,checkedCount:audit.checks.length,passedCount:audit.checks.filter(c=>c.status==='passed').length,riskLevel:legal.length?'high':'review',fineBasis:'Условный справочный сценарий для юридического лица, первое нарушение. Пересекающиеся составы не суммируются повторно; применимость требует проверки.'};
  audit.facts={...audit.facts,title,description,h1Count:$('h1').length,dataFormCount:dataForms.length,analyticsDetected:analytics,cookieBannerDetected:bannerPresent};
  audit.scope='Главная страница, до 8 локальных JS-файлов, ссылки на политику, robots.txt и sitemap.xml. Без исполнения JavaScript, доступа к реестрам и базам данных.';
  return audit;
}
module.exports={enhanceAudit,collectResources};
