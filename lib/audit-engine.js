const cheerio = require('cheerio');
const {fetchText} = require('./safe-fetch');
const {extendLegalChecks} = require('./legal-checks');
const {summarizeFines} = require('./fine-summary');
const LAW_URL='https://www.consultant.ru/document/cons_doc_LAW_34661/1f421640c6775ff67079ebde06a7d2f6d17b96db/';
const {privacyPattern,consentPattern,usableLink,isDocument,documentText,resourceKind,collectForms,checkboxLabel}=require('./audit-documents');
const attr=(node,name)=>node.attr(name)||'';

async function collectResources(page, fetchResource=fetchText, onProgress=()=>{}) {
  const base=new URL(page.finalUrl), urls=new Map(), resources=[];
  let pageCount=0,scriptCount=0;
  function discover(source) {
    const $=cheerio.load(source.text), parent=new URL(source.finalUrl||source.url||base);
    function add(href,kind) {
      if(!usableLink(href)||urls.size>=32||(kind==='page'&&pageCount>=3)||(kind==='script'&&scriptCount>=12))return;
      try{const url=new URL(href,parent);url.hash='';if(!['http:','https:'].includes(url.protocol)||(url.origin!==base.origin&&['page','script'].includes(kind))||url.href===base.href||urls.has(url.href))return;
        urls.set(url.href,kind);if(kind==='page')pageCount++;if(kind==='script')scriptCount++;
      }catch{}
    }
    $('a[href]').each((_,el)=>{const link=$(el),kind=resourceKind(link.text()+' '+attr(link,'href'));if(kind)add(attr(link,'href'),kind);});
    $('script[src]').each((_,el)=>add(attr($(el),'src'),'script'));
  }
  discover(page);
  const fetched=new Set();
  let completed=0;
  onProgress({completed,total:urls.size});
  for(let depth=0;depth<3;depth++){
    const pending=[...urls].filter(([url])=>!fetched.has(url));if(!pending.length)break;
    const batch=new Array(pending.length);
    let index=0;
    await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
      while(index<pending.length){
        const current=index++, [url,kind]=pending[current];
        fetched.add(url);
        try{batch[current]={url,kind,...await fetchResource(url,5000)};}
        catch{batch[current]={url,kind,ok:false,status:0,text:''};}
        finally{completed++;onProgress({completed,total:urls.size});}
      }
    }));
    resources.push(...batch);
    for(const resource of batch)if(resource.kind!=='script'&&isDocument(resource))discover(resource);
    onProgress({completed,total:urls.size});
  }
  return resources;
}

function enhanceAudit(options, legacy) {
  const {html,timing,robots='',sitemap='',resources=[],browser={}}=options;
  const $=cheerio.load(html);const audit=legacy(options);const base=new URL(timing.finalUrl||options.targetUrl.href);
  const checks=new Map(audit.checks.map(check=>[check.id,check]));
  const put=(id,group,title,status,evidence,fix,extra={})=>checks.set(id,{id,group,title,status,severity:status==='failed'?'medium':'low',fineMax:0,evidence,fix,...extra});
  const test=(id,title,ok,evidence,fix,extra={})=>put(id,'seo',title,ok?'passed':'failed',evidence,fix,extra);
  const meaningful=$.root().clone();meaningful.find('script,style,template,noscript').remove();
  const text=meaningful.text().replace(/\s+/g,' ').trim();
  const pages=[{text:html,url:base.href},...resources.filter(r=>r.kind!=='script'&&isDocument(r))];
  const privacyLinks=pages.flatMap(page=>{const doc=cheerio.load(page.text);return doc('a[href]').toArray().filter(el=>privacyPattern.test(doc(el).text()+' '+attr(doc(el),'href'))&&usableLink(attr(doc(el),'href')));});
  const privacyDocs=resources.filter(r=>r.kind==='privacy');
  const placeholderPolicy=privacyDocs.some(r=>isDocument(r)&&/проект документа|для тестовой версии|черновик|контент появится|юридический текст добавим|текст.{0,20}будет добавлен/i.test(documentText(r.text)));
  const readablePolicy=privacyDocs.some(r=>isDocument(r) && privacyPattern.test(cheerio.load(r.text)('h1,h2,title').text()) && /оператор|персональн|data controller/i.test(documentText(r.text)) && !/проект документа|для тестовой версии|черновик|контент появится|юридический текст добавим|текст.{0,20}будет добавлен/i.test(documentText(r.text)));
  const dataForms=collectForms(pages);
  const badForms=dataForms.filter(({form,$})=>!form.find('input[type=checkbox][required]').toArray().some(box=>consentPattern.test(checkboxLabel($,form,box))&&!$(box).is('[checked]')));
  const scripts=$('script:not([type="application/ld+json"])').map((_,el)=>$(el).text()+' '+attr($(el),'src')).get().join('\n')+'\n'+resources.filter(r=>r.kind==='script'&&r.ok).map(r=>r.text).join('\n');
  const analytics=/mc\.yandex\.ru|googletagmanager\.com|google-analytics\.com|facebook\.net|\b(?:ym|gtag|fbq)\s*\(/i.test(scripts)||(browser.analyticsBeforeConsent||[]).length>0;
  const cookieCode=/document\.cookie|cookies?\.set\s*\(/i.test(scripts)||(timing.cookieNames||[]).length>0||(browser.cookies||[]).length>0;
  const banners=$('[id],[class],[data-cookie-banner]').toArray().filter(el=>/cookie[-_ ]?(?:banner|consent|notice)|(?:banner|consent|notice)[-_ ]?cookie/i.test(attr($(el),'id')+' '+attr($(el),'class')) || $(el).is('[data-cookie-banner]'));
  const bannerPresent=browser.available?browser.bannerVisible:banners.some(el=>$(el).find('button,input[type=button],a').length && /cookie|куки/i.test($(el).text()));
  const brokenPolicy=privacyDocs.some(r=>!r.ok&&[404,410].includes(r.status));
  const privacyStatus=readablePolicy?'passed':brokenPolicy||placeholderPolicy?'failed':privacyLinks.length?'review':dataForms.length?'failed':'skipped';
  put('privacy-policy','legal','Доступная политика персональных данных',privacyStatus,readablePolicy?'Ссылка на политику ведёт на доступный документ с признаками политики оператора':placeholderPolicy?'Вместо опубликованной политики загружена страница с пометкой о черновике или будущем тексте':brokenPolicy?'Ссылка на политику возвращает HTTP 404 или 410 — документ недоступен':privacyLinks.length?'Ссылка найдена, но содержание документа не удалось подтвердить':'Ссылка на политику персональных данных не найдена в HTML', 'Опубликуйте документ оператора и поставьте ссылки в футере и рядом с формами',{severity:'high',fineMax:privacyStatus==='failed'?60000:0,law:'152-ФЗ, ст. 18.1; КоАП РФ 13.11 ч. 3',sanctionGroup:'13.11.3',source:LAW_URL,condition:'Справочный предел для юридического лица при установленном нарушении обязанности публикации'});
  put('form-consent','legal','Согласие у каждой формы сбора данных',!dataForms.length?'passed':badForms.length?'failed':'passed',`Форм сбора контактных данных: ${dataForms.length}; без отдельного обязательного непредустановленного согласия: ${badForms.length}`, 'Проверьте правовое основание обработки; где нужно согласие, добавьте отдельный чекбокс и ссылку на текст согласия',{severity:'high',fineMax:badForms.length?300000:0,law:'152-ФЗ, ст. 6, 9; КоАП РФ 13.11 ч. 1',sanctionGroup:'13.11.1',source:LAW_URL,condition:'Отсутствие чекбокса само по себе не доказывает незаконную обработку: нужно проверить другие основания'});
  const scriptedBanner=/cookie[-_ ]?(?:banner|consent|notice)|(?:banner|consent|notice)[-_ ]?cookie/i.test(scripts)&&/принять|отклонить|accept|decline/i.test(scripts);
  const cookieStatus=bannerPresent?'passed':!analytics&&!cookieCode?'skipped':browser.available&&!browser.blockedRequests?'failed':scriptedBanner?'review':'failed';
  put('cookie-consent','legal','Cookie-баннер и аналитика',cookieStatus,bannerPresent?browser.available?'При первом посещении, без сохранённых cookie, обнаружен видимый cookie-баннер':'В HTML найден блок уведомления с управляющими элементами; фактический порядок запуска нужно проверить в браузере':browser.available&&!browser.blockedRequests?'При первом посещении, без сохранённых cookie и без нажатия кнопок, cookie-баннер не появился; обнаружены аналитика или cookie':scriptedBanner?'В исходном HTML баннера нет, но в JavaScript найден код cookie-окна. Браузерная проверка не завершена':analytics||cookieCode?`Баннер не найден; ${analytics?'в скриптах обнаружена аналитика':'есть запись cookie или Set-Cookie'}`:'В загруженных страницах и скриптах аналитика и запись cookie не обнаружены; проверка баннера пропущена', 'До согласия блокируйте необязательную аналитику, дайте отказ и выбор настроек; необходимые cookie опишите отдельно',{severity:'high',fineMax:cookieStatus==='failed'&&analytics?300000:0,law:'152-ФЗ, ст. 6, 9, 18.1; возможная применимость КоАП РФ 13.11 ч. 1',sanctionGroup:'13.11.1',source:LAW_URL,condition:'Отдельного автоматического штрафа за отсутствие баннера нет; зависит от фактической обработки данных'});
  const earlyAnalytics=browser.analyticsBeforeConsent||[];
  put('analytics-before-consent','legal','Запуск аналитики до выбора посетителя',!browser.available?'review':earlyAnalytics.length?'failed':browser.blockedRequests?'review':'passed',!browser.available?(browser.reason||'Браузерная проверка не выполнялась'):earlyAnalytics.length?`Без нажатия на кнопки согласия обнаружены запросы аналитики: ${earlyAnalytics.length}`:browser.blockedRequests?'Часть ресурсов не загрузилась; порядок запуска аналитики не установлен':'В первые секунды первого посещения запросы к проверяемым счётчикам не обнаружены','Запускайте необязательные счётчики только после добровольного согласия; проверьте сохранение отказа',{details:earlyAnalytics,law:'152-ФЗ, ст. 6, 9',source:LAW_URL,sanctionGroup:'13.11.1',fineMax:earlyAnalytics.length?300000:0,condition:'Проверяется запуск запросов при первом посещении; состав и правовое основание обработки требуют оценки.'});
  const cookieDocsText=resources.filter(r=>['privacy','cookie'].includes(r.kind)&&r.ok&&!r.contentType?.includes('pdf')).map(r=>cheerio.load(r.text)('body').text()).join(' ');
  const cookieDescription=/cookie|куки/i.test(cookieDocsText)&&/цел[ьи]|аналитик/i.test(cookieDocsText)&&/отказ|настройк|отзыв/i.test(cookieDocsText);
  put('cookie-policy','legal','Описание cookie и счётчиков',cookieDescription||!analytics&&!cookieCode?'passed':resources.some(r=>['privacy','cookie'].includes(r.kind)&&(!r.ok&&![404,410].includes(r.status)||/pdf/i.test(r.contentType||'')))?'review':'failed',cookieDescription?'В документах описаны cookie, их цели и управление выбором':analytics||cookieCode?'Обнаружены аналитика или cookie, но в прочитанных документах нет полного описания целей и управления выбором':'В загруженных страницах и скриптах аналитика и запись cookie не обнаружены', 'Опишите используемые cookie и счётчики, их цели, получателей, сроки и способ изменения выбора');
  put('operator-notice','legal','Уведомление в реестр РКН',dataForms.length?'review':'passed',dataForms.length?'Наличие уведомления не устанавливается по упоминанию РКН на сайте':'Формы сбора контактов не найдены; иные способы обработки не проверены','Проверьте оператора по ИНН в реестре РКН и основания исключений',{law:'152-ФЗ, ст. 22; КоАП РФ 13.11 ч. 10',referenceFine:300000,source:LAW_URL});
  put('data-localization','legal','Локализация баз данных в РФ','review','Место первичного хранения персональных данных не определено. Страна IP или CDN не доказывает расположение базы данных','Уточните расположение базы заявок, резервных копий, CRM и цепочку передачи данных',{law:'152-ФЗ, ст. 18 ч. 5; КоАП РФ 13.11 ч. 8',referenceFine:6000000,source:LAW_URL});
  put('data-retention','legal','Сроки хранения и удаление данных',dataForms.length?'review':'passed','Сроки хранения, журнал согласий и удаление данных не устанавливаются по главной странице','Установите сроки по целям, порядок отзыва согласия и удаления заявок');
  const adElements=$('[class],[id]').toArray().filter(el=>/(?:^|\s)(?:advertisement|sponsored|ad-slot|ads-banner)(?:\s|$)/i.test(attr($(el),'class')+' '+attr($(el),'id')));
  put('ad-marking','legal','Рекламные размещения и ERID',adElements.length?'review':'passed',adElements.length?'Есть разметка возможных рекламных блоков; характер размещения требует проверки':'Признаков рекламного размещения в разметке не найдено; упоминания ERID в описании услуги не считаются рекламой','Для действительных рекламных размещений проверьте маркировку и идентификатор');
  const sensitiveFields=dataForms.flatMap(({form,$})=>form.find('input,select,textarea').toArray().filter(el=>/здоров|диагноз|болезн|биометр|паспорт|child|дет[ьи]|реб[её]нок|birth|рождени/i.test(['name','id','placeholder'].map(key=>attr($(el),key)).join(' '))));
  put('children-data','legal','Данные детей и специальные категории',sensitiveFields.length?'review':'passed',sensitiveFields.length?`Найдены поля для потенциально чувствительных данных: ${sensitiveFields.length}. Правовое основание нужно установить отдельно`:'В проверенных формах не найдены поля, явно запрашивающие данные детей, здоровье или биометрию','Уточните основания обработки специальных категорий данных и необходимость согласия представителя');
  extendLegalChecks({html,resources,base,analytics,bannerPresent,privacyDocs,readablePolicy,put,pages,forms:dataForms,browser});
  const metas=name=>$('meta').filter((_,el)=>attr($(el),'name').toLowerCase()===name);
  const title=$('title').text().trim(), description=attr(metas('description').first(),'content').trim();
  test('title','Title страницы',title.length>=20&&title.length<=70,`Title: «${title||'не найден'}» (${title.length} символов)`,'Сделайте уникальный title с услугой и брендом');
  test('description','Meta description',description.length>=70&&description.length<=170,`Description: «${description||'не найден'}» (${description.length} символов)`,'Опишите пользу страницы и услугу в description');
  test('meta-duplicates','Дубли title и description',$('title').length===1&&metas('description').length===1,`Title: ${$('title').length}; description: ${metas('description').length}`,'Оставьте по одному непустому title и description');
  test('h1','Главный H1',$('h1').length===1,`H1 в исходном HTML: ${$('h1').length}`,'Оставьте один H1; заголовки скрытых экранов переведите в H2');
  const headings=$('h1,h2,h3,h4,h5,h6').toArray();let previous=0;const jumps=[];
  headings.forEach(el=>{const level=Number(el.tagName[1]);if(previous&&level>previous+1)jumps.push($(el).text().trim().slice(0,80));previous=level;});
  test('heading-order','Структура заголовков страницы',!jumps.length,jumps.length?`В ${jumps.length} местах пропущен уровень заголовка. Например, после заголовка раздела сразу идёт подзаголовок более глубокого уровня.`:'Пропусков уровней заголовков не найдено','Выстройте заголовки последовательно: H1 — тема страницы, H2 — разделы, H3 — подразделы',{details:jumps.slice(0,5)});
  const images=$('img').toArray(),missingAlt=images.filter(el=>$(el).attr('alt')===undefined);
  test('image-alt','Alt изображений',!missingAlt.length,`Без атрибута alt: ${missingAlt.length} из ${images.length}; пустой alt допустим для декора`,'Добавьте описания смысловым изображениям, декоративным — пустой alt');
  const missingDimensions=images.filter(el=>!$(el).attr('width')||!$(el).attr('height'));
  test('image-dimensions','Стабильность страницы при загрузке изображений',!missingDimensions.length,missingDimensions.length?`У ${missingDimensions.length} изображений не указаны размеры в HTML. Если место не задано и в стилях, текст и кнопки могут сдвигаться во время загрузки.`:'У изображений указаны размеры в HTML','Задайте размеры или пропорции изображений в HTML/CSS и проверьте, что страница не скачет при загрузке');
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
  // _blank implies noopener in modern browsers; its absence is not an SEO defect.
  checks.delete('external-link-safety');
  let invalidJson=0, validJson=0;$('script[type="application/ld+json"]').each((_,el)=>{try{JSON.parse($(el).text());validJson++;}catch{invalidJson++;}});
  test('schema','Валидный JSON-LD',validJson>0&&!invalidJson,`Валидных JSON-LD блоков: ${validJson}; невалидных: ${invalidJson}; семантика схемы не проверена`,'Добавьте и проверьте WebSite/Organization или подходящий тип');
  const robotsOk=/^\s*user-agent\s*:/im.test(robots);
  test('robots','robots.txt',robotsOk,robotsOk?'Найдена директива User-agent':'Файл недоступен или не содержит User-agent','Добавьте robots.txt с правилами для поисковых роботов');
  const groups=robots.split(/\n\s*\n/);const allBlocked=groups.some(g=>/^\s*user-agent\s*:\s*\*\s*$/im.test(g)&&/^\s*disallow\s*:\s*\/\s*$/im.test(g));
  test('robots-access','Глобальный запрет в robots.txt',!allBlocked,allBlocked?'В группе User-agent: * обнаружен Disallow: /':'Глобальный Disallow: / для * не найден; путь и правила отдельных роботов нужно проверить','Откройте страницы, предназначенные для поиска',{severity:'high'});
  test('robots-sitemap','Ссылка на sitemap в robots.txt',/^\s*sitemap\s*:\s*https?:\/\//im.test(robots),'Проверена абсолютная директива Sitemap','Укажите абсолютный URL sitemap.xml');
  const xml=cheerio.load(sitemap,{xmlMode:true}); const locations=xml('urlset > url > loc, sitemapindex > sitemap > loc');
  test('sitemap','XML-карта сайта',locations.length>0,`URL или вложенных карт в sitemap: ${locations.length}`,'Добавьте корректный sitemap.xml с индексируемыми URL');
  put('core-web-vitals','seo','Скорость, удобство на телефоне и стабильность страницы','review','По исходному HTML нельзя измерить, как быстро появляется основной контент, реагируют кнопки и сдвигаются элементы. Нужна загрузка сайта в браузере.','Проверьте сайт в PageSpeed Insights на компьютере и телефоне; технические показатели называются LCP, INP и CLS');
  const bodyTextLength=text.length;
  test('text-volume','Объём текста',bodyTextLength>=500,`Текст без script/style/template: ${bodyTextLength} символов; полнота и качество не оценены`,'Добавьте полезный текст под задачу клиента');
  test('image-loading','Отложенная загрузка изображений',images.length<3||images.some(el=>attr($(el),'loading')==='lazy'),`Изображений с lazy: ${images.filter(el=>attr($(el),'loading')==='lazy').length}`,'Добавьте lazy ниже первого экрана; LCP-изображение не откладывайте');
  audit.checks=[...checks.values()];
  const failed=audit.checks.filter(c=>c.status==='failed');const legal=failed.filter(c=>c.group==='legal');
  audit.summary={...audit.summary,...summarizeFines(audit.checks),score:Math.round(100*audit.checks.filter(c=>c.status==='passed').length/audit.checks.length),legalIssues:legal.length,seoIssues:failed.filter(c=>c.group==='seo').length,totalIssues:failed.length,reviewIssues:audit.checks.filter(c=>c.status==='review').length,checkedCount:audit.checks.length,passedCount:audit.checks.filter(c=>c.status==='passed').length,riskLevel:legal.length?'high':'review',fineBasis:'Ориентировочный диапазон для юридического лица при первом нарушении. Не является начисленным штрафом. Пересекающиеся составы не суммируются повторно; применимость требует проверки.'};
  audit.facts={...audit.facts,title,description,h1Count:$('h1').length,dataFormCount:dataForms.length,analyticsDetected:analytics,cookieBannerDetected:bannerPresent,browserChecked:browser.available===true};
  audit.scope=`Проверены главная страница, ${resources.filter(r=>r.kind==='script'&&r.ok).length} локальных JS-файлов, ${resources.filter(r=>r.kind!=='script'&&r.kind!=='page'&&r.ok).length} связанных документов и ${resources.filter(r=>r.kind==='page'&&r.ok).length} страниц контактов/заказа, robots.txt и sitemap.xml. ${browser.available?'Главная дополнительно открыта как при первом посещении, без сохранённых cookie и без нажатия кнопок согласия; проверены видимость cookie-баннера и попытки запуска аналитики.':browser.reason||'Исполнение JavaScript не проверено.'} Реестры, содержимое PDF и внутренние базы данных не проверены.`;
  return audit;
}
module.exports={enhanceAudit,collectResources};
