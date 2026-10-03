const cheerio=require('cheerio');
const LAW='https://mintrud.gov.ru/docs/laws/130';
const {consentPattern:consent,usableLink,isDocument,documentText,resourceKind,checkboxLabel,validTaxId}=require('./audit-documents');
function extendLegalChecks({html,resources,base,analytics,bannerPresent,privacyDocs,readablePolicy,put,pages,forms,browser={}}){
  const locations=items=>{const pages=new Map();for(const f of items){if(!pages.has(f.url))pages.set(f.url,[]);pages.get(f.url).push(f.index);}return [...pages].map(([url,forms])=>({url,forms}));};
  const describe=items=>items.map(f=>`${f.url} — форма ${f.index}`).join('; ');
  const insecure=forms.filter(({form,url})=>{try{return new URL(url).protocol==='http:'||(form.attr('action')&&new URL(form.attr('action'),url).protocol==='http:');}catch{return false;}});
  const getForms=forms.filter(({form})=>usableLink(form.attr('action'))&&(form.attr('method')||'get').toLowerCase()==='get');
  const missingLink=forms.filter(({form,$,url})=>consent.test(form.text())&&!form.find('a[href]').toArray().some(el=>{
    const link=$(el),href=link.attr('href');if(!usableLink(href)||resourceKind(link.text()+' '+href)!=='consent')return false;
    try{const target=new URL(href,url);target.hash='';return !resources.some(r=>r.url===target.href&&!r.ok&&[404,410].includes(r.status));}catch{return false;}
  }));
  const bundled=forms.filter(({form,$})=>form.find('label').toArray().some(el=>consent.test($(el).text())&&/оферт|пользовательск.{0,20}соглашени|рассылк|рекламн.{0,20}сообщени/i.test($(el).text())&&$(el).find('input[type=checkbox]').length));
  const marketing=forms.filter(({form,$})=>form.find('label').toArray().some(el=>/рассылк|рекламн.{0,20}сообщени/i.test($(el).text())&&$(el).find('input[type=checkbox][checked],input[type=checkbox][required]').length));
  const explanations={
    'form-transport':'Контактные данные могут отправляться по незашифрованному HTTP-соединению.',
    'form-url-data':'Адрес отправки формы использует GET: введённые данные могут попасть в адресную строку и журнал посещений.',
    'consent-document':'Рядом с согласием не найдена доступная ссылка на его отдельный текст. Посетитель не может прочитать условия обработки перед отправкой.',
    'consent-separate':'Одна галочка одновременно подтверждает обработку данных и другие условия.',
    'marketing-choice':'Рекламная подписка отмечена заранее или обязательна для отправки заявки.'
  };
  function formCheck(id,title,items,fix,law){put(id,'legal',title,items.length?'failed':'passed',items.length?`${explanations[id]} Затронуто форм: ${items.length} на ${locations(items).length} страницах.`:'В проверенных формах этот недостаток не обнаружен; отправка форм не выполнялась',fix,{locations:locations(items),law,source:LAW,condition:'Применимость требований зависит от фактической обработки и её основания. Этот пункт не добавляет отдельную сумму штрафа.'});}
  formCheck('form-transport','Передача контактных данных через HTTP',insecure,'Переведите страницу и адрес обработчика на HTTPS; проверьте фактические сетевые запросы','152-ФЗ, ст. 19');
  formCheck('form-url-data','Контактные данные в URL формы',getForms,'Используйте POST и исключите данные из URL, истории, логов и Referer; проверьте JS-обработчик','152-ФЗ, ст. 5, 19');
  formCheck('consent-document','Ссылка на текст согласия у формы',missingLink,'Добавьте доступный отдельный текст согласия рядом с соответствующим чекбоксом','152-ФЗ, ст. 9');
  formCheck('consent-separate','Согласие объединено с другими условиями',bundled,'Отделите согласие на обработку данных от принятия оферты и рекламной подписки','152-ФЗ, ст. 9');
  formCheck('marketing-choice','Обязательная или заранее выбранная рекламная подписка',marketing,'Сделайте рекламную подписку добровольной и без заранее поставленной галочки; проверьте возможность отказа','38-ФЗ, ст. 18; 152-ФЗ, ст. 9');
  const $=cheerio.load(html);
  const bannerNodes=$('[id],[class],[data-cookie-banner]').filter((_,el)=>/cookie[-_ ]?(?:banner|consent|notice)|(?:banner|consent|notice)[-_ ]?cookie/i.test(($(el).attr('id')||'')+' '+($(el).attr('class')||''))||$(el).is('[data-cookie-banner]'));
  const refuse=browser.available?browser.refusalVisible:bannerNodes.find('button,a,input[type=button]').toArray().some(el=>/отказ|отклон|только необходим|без аналитик|reject|decline|necessary only/i.test($(el).text()+' '+($(el).attr('value')||'')));
  put('cookie-refusal','legal','Возможность отказаться от необязательных cookie',!bannerPresent||!analytics?'skipped':refuse?'passed':'failed',!bannerPresent?'Баннер не найден; его отсутствие учтено отдельной проверкой':!analytics?'Необязательная аналитика в загруженных скриптах не обнаружена':refuse?'В cookie-блоке найден отказ или выбор только необходимых cookie':'В HTML cookie-блока есть принятие, но не найден элемент отказа или выбора только необходимых cookie','Добавьте равнодоступный отказ и сохранение выбора, затем проверьте поведение в браузере',{law:'152-ФЗ, ст. 6, 9',source:LAW});
  const policyText=privacyDocs.filter(isDocument).map(r=>documentText(r.text)).join(' ');
  const sections=[
    ['policy-purposes','Цели и правовые основания обработки',/(?:цел[ьи]|для\s+(?:связи|обратной связи|ответа|исполнения|рассмотрения)|исполнени.{0,15}договор)/i,'Перечислите конкретные цели и правовое основание для каждой цели'],
    ['policy-data','Состав данных и категории субъектов',/(?:категори.{0,60}(?:данных|субъект)|перечень.{0,40}данных|(?:данные|обрабатыва[а-яё]+).{0,100}(?:имя|телефон|email|контакт|почт))/i,'Опишите категории субъектов и данные, которые фактически собираете'],
    ['policy-retention','Сроки хранения и порядок уничтожения',/срок.{0,40}(?:хранени|обработк)|уничтожен|удалени/i,'Укажите сроки по каждой цели и порядок уничтожения данных'],
    ['policy-rights','Права субъекта и отзыв согласия',/отзыв.{0,30}соглас|отозв[а-яё]*.{0,30}соглас|прав.{0,30}субъект/i,'Опишите доступ, исправление, удаление данных и отзыв согласия'],
    ['policy-contact','Контакт для обращений по данным',/[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}|адрес.{0,35}(?:обращен|оператор)|обращен.{0,35}адрес/i,'Укажите действующий контакт оператора для обращений по персональным данным']
  ];
  const linkedContact=privacyDocs.filter(isDocument).some(r=>{const doc=cheerio.load(r.text);return doc('a[href]').toArray().some(el=>{
    const href=doc(el).attr('href');if(!/контакт|contact/i.test(doc(el).text()+' '+href))return false;
    try{const url=new URL(href,r.finalUrl||r.url||base);url.hash='';return pages.some(page=>(page.finalUrl||page.url)===url.href&&/[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}|\+?7\s*\(?\d{3}/i.test(documentText(page.text)));}catch{return false;}
  });});
  for(const [id,title,pattern,fix] of sections){const matched=readablePolicy&&(pattern.test(policyText)||id==='policy-contact'&&linkedContact);put(id,'legal',title,!readablePolicy?'skipped':matched?'passed':'failed',matched?'В прочитанной политике или связанной странице контактов найдены сведения по этому пункту':readablePolicy?`В прочитанном тексте политики не найдено: ${title.toLowerCase()}. Проверен текст документа без меню и формы заявки.`:'Содержание политики недоступно; проверка раздела пропущена',fix,{law:'152-ФЗ, ст. 18.1',source:LAW,condition:'Недостаток опубликованного документа. Отдельная сумма штрафа за этот раздел не начисляется.'});}
  const externalForms=forms.filter(({form,url})=>{try{return usableLink(form.attr('action'))&&new URL(form.attr('action'),url).origin!==new URL(url).origin;}catch{return false;}});
  put('external-processors','legal','Передача заявок стороннему обработчику',externalForms.length?'review':'passed',externalForms.length?`Есть внешние адреса обработки: ${describe(externalForms)}. Место хранения и условия передачи не установлены`:'Внешние action в проверенных формах не найдены; передачи из JavaScript и CRM не исключены','Проверьте поручение обработки, перечень получателей, локализацию и трансграничную передачу',{law:'152-ФЗ, ст. 6, 12, 18',source:LAW});

  const allText=pages.map(page=>documentText(page.text,true)).join(' ');
  const mainText=documentText(html);
  const commercial=/\b(?:₽|руб)|\d[\d\s]*\s*[₽]|стоимость.{0,40}\d|цена.{0,40}\d|купить|в корзину|оформить заказ|заказать\s+(?:услуг|сайт|доставк)|выбрать тариф/i.test(mainText);
  const commercialUnknown=resources.some(r=>['page','offer','commercial'].includes(r.kind)&&(!r.ok&&![404,410].includes(r.status)||/pdf/i.test(r.contentType||'')));
  const taxIds=[...allText.matchAll(/инн\s*[:№]?\s*(\d{10}(?:\d{2})?)(?!\d)/gi)].map(match=>match[1]);
  const validIds=taxIds.filter(validTaxId);
  const missingIdentity=commercial||forms.length>0;
  put('company-details','legal','Реквизиты оператора или исполнителя',validIds.length?'passed':missingIdentity?commercialUnknown?'review':'failed':'skipped',validIds.length?`Найден ИНН с корректной контрольной суммой: ${[...new Set(validIds)].join(', ')}. Проверены главная, контакты и документы; принадлежность по реестру не установлена`:taxIds.length?'Опубликованный ИНН не проходит проверку длины или контрольной суммы':'На главной странице, страницах контактов и в документах не найден ИНН оператора или исполнителя','Опубликуйте имя или наименование, корректный ИНН и контакты оператора/исполнителя',{condition:'Проверка публичных реквизитов. Требования зависят от статуса исполнителя; автоматическая сумма штрафа не добавляется.'});
  const offers=resources.filter(r=>['offer','commercial'].includes(r.kind)&&isDocument(r));
  const offerText=offers.map(r=>documentText(r.text)).join(' ');
  const termsText=mainText+' '+offerText;
  const orderTerms=/оплат[а-яё]*.{0,100}(?:карт|перевод|сч[её]т|банк|после|перед|способ|предоплат)|(?:способ|порядок|условия)\s+оплаты/i.test(termsText);
  const deliveryTerms=/срок.{0,50}(?:доставк|оказани|выполнени|предоставлен|выдач)|(?:доставк|оказани|предоставлен).{0,50}(?:дн[ея]|дней|суток|час|после|срок)|цифров[а-яё]*.{0,60}(?:сразу|после оплаты)/i.test(termsText);
  const returnTerms=/(?:возврат|отказ|отмен)[а-яё]*.{0,100}(?:ден[ье]|оплат|заказ|товар|услуг|договор|дн[ея]|дней|email|почт)|(?:порядок|сроки|условия)\s+возврата/i.test(termsText);
  const missingTerms=[!orderTerms&&'порядок оплаты',!deliveryTerms&&'срок и способ получения товара/услуги',!returnTerms&&'возврат или отмена заказа'].filter(Boolean);
  const checkout=pages.some(page=>{const doc=cheerio.load(page.text);return doc('a,button,input[type=submit]').toArray().some(el=>/купить|в корзину|оформить заказ|оплатить/i.test(doc(el).text()+' '+(doc(el).attr('value')||'')));});
  put('offer-return','legal','Условия заказа, получения и возврата',!commercial?'skipped':!missingTerms.length?'passed':commercialUnknown?'review':'failed',!commercial?'Признаков продажи на проверенных страницах не найдено':!missingTerms.length?'В опубликованном тексте найдены порядок оплаты, получение и возврат/отмена':`На сайте с коммерческим предложением не найдены: ${missingTerms.join('; ')}. Проверены главная и связанные условия.`, 'Добавьте понятные условия заказа: оплату, срок и способ получения, порядок возврата или отмены',{details:offers.map(r=>`Проверен документ: ${r.finalUrl||r.url}`),law:'ЗоЗПП, ст. 8–10; для товаров — ст. 26.1',source:'https://zpp.rospotrebnadzor.ru/news/federal/475124',condition:'Недостаток опубликованной информации. Применимость зависит от продажи потребителю и вида товара/услуги; отдельный штраф не начисляется.'});
  put('payment-docs','legal','Опубликованный порядок оплаты',!checkout?'skipped':orderTerms?'passed':commercialUnknown?'review':'failed',!checkout?'Кнопка оформления или оплаты заказа не найдена':orderTerms?'Порядок оплаты описан в опубликованном тексте; фактическая выдача чека не проверялась':'Найдена кнопка покупки/оплаты, но в доступном тексте не описан порядок оплаты', 'Опишите способы и порядок оплаты. Выдачу кассового чека либо чека НПД проверяйте по фактическому расчёту',{law:'ЗоЗПП, ст. 10',condition:'Недостаток информации об оплате; работа ККТ по HTML не определяется.'});
  const broken=resources.filter(r=>r.kind!=='script'&&r.kind!=='page'&&!r.ok&&[404,410].includes(r.status));
  put('document-links','legal','Работоспособность ссылок на юридические документы',broken.length?'failed':'passed',broken.length?`Недоступны ${broken.length} ссылки на документы: сервер вернул HTTP 404/410`:'В загруженных ссылках на юридические документы ответ 404/410 не обнаружен','Восстановите документы или замените ссылки на работающие адреса',{locations:broken.map(r=>({url:r.url})),details:broken.map(r=>`HTTP ${r.status}: ${r.url}`)});
}
module.exports={extendLegalChecks};
