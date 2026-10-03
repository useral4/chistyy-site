const cheerio=require('cheerio');
const LAW='https://mintrud.gov.ru/docs/laws/130';
const consent=/соглас[а-яё\s]*(?:на\s+)?обработк[а-яё\s]*персональн|соглас[а-яё\s]*на\s+обработку\s+(?:указанных\s+)?данных/i;
const usableLink=href=>!!href&&!/^(?:#|javascript:)/i.test(href);
function extendLegalChecks({html,resources,base,analytics,bannerPresent,privacyDocs,readablePolicy,put}){
  const pages=[{text:html,url:base.href},...resources.filter(r=>r.kind==='page'&&r.ok&&!r.contentType?.includes('pdf'))];
  const forms=[];
  for(const page of pages){const $=cheerio.load(page.text);$('form').each((i,el)=>{const form=$(el);if(form.find('input[type=email],input[type=tel],input[name*=name],textarea,input[name*=phone],input[autocomplete=email],input[autocomplete=tel]').length)forms.push({$,form,url:page.finalUrl||page.url,index:i+1});});}
  const locations=items=>{const pages=new Map();for(const f of items){if(!pages.has(f.url))pages.set(f.url,[]);pages.get(f.url).push(f.index);}return [...pages].map(([url,forms])=>({url,forms}));};
  const describe=items=>items.map(f=>`${f.url} — форма ${f.index}`).join('; ');
  const insecure=forms.filter(({form,url})=>{try{return new URL(url).protocol==='http:'||(form.attr('action')&&new URL(form.attr('action'),url).protocol==='http:');}catch{return false;}});
  const getForms=forms.filter(({form})=>usableLink(form.attr('action'))&&(form.attr('method')||'get').toLowerCase()==='get');
  const missingLink=forms.filter(({form,$})=>form.find('label').toArray().some(el=>consent.test($(el).text())&&!$(el).find('a[href]').toArray().some(a=>usableLink($(a).attr('href')))));
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
  const refuse=bannerNodes.find('button,a,input[type=button]').toArray().some(el=>/отказ|отклон|только необходим|без аналитик|reject|decline|necessary only/i.test($(el).text()+' '+($(el).attr('value')||'')));
  put('cookie-refusal','legal','Возможность отказаться от необязательных cookie',analytics&&bannerPresent&&!refuse?'failed':!analytics?'passed':bannerPresent?'passed':'review',analytics&&bannerPresent&&!refuse?'В HTML cookie-блока есть принятие, но не найден элемент отказа или выбора только необходимых cookie':'Проверены видимые элементы cookie-блока в исходном HTML; открывающиеся по JS настройки не проверены','Добавьте равнодоступный отказ и сохранение выбора, затем проверьте поведение в браузере',{law:'152-ФЗ, ст. 6, 9',source:LAW});
  const policyText=privacyDocs.filter(r=>r.ok&&!r.contentType?.includes('pdf')).map(r=>{const doc=cheerio.load(r.text);doc('script,style,header,footer,nav').remove();return doc('body').text();}).join(' ');
  const sections=[
    ['policy-purposes','Цели и правовые основания обработки',/цел[ьи]|основани.{0,30}обработк/i,'Перечислите конкретные цели и правовое основание для каждой цели'],
    ['policy-data','Состав данных и категории субъектов',/категори.{0,40}(?:данных|субъект)|перечень.{0,40}данных/i,'Опишите категории субъектов и данные, которые фактически собираете'],
    ['policy-retention','Сроки хранения и порядок уничтожения',/срок.{0,40}(?:хранени|обработк)|уничтожен|удалени/i,'Укажите сроки по каждой цели и порядок уничтожения данных'],
    ['policy-rights','Права субъекта и отзыв согласия',/отзыв.{0,30}соглас|прав.{0,30}субъект/i,'Опишите доступ, исправление, удаление данных и отзыв согласия'],
    ['policy-contact','Контакт для обращений по данным',/[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}|адрес.{0,35}(?:обращен|оператор)|обращен.{0,35}адрес/i,'Укажите действующий контакт оператора для обращений по персональным данным']
  ];
  for(const [id,title,pattern,fix] of sections){const matched=readablePolicy&&pattern.test(policyText);put(id,'legal',title,matched?'passed':'review',matched?'В доступном тексте политики найдены признаки этого раздела; соответствие реальным процессам требует проверки':readablePolicy?'Признаки раздела не найдены в загруженном тексте политики. Это требует проверки документа, а не доказывает отдельное нарушение':'Политику не удалось прочитать и подтвердить; отсутствие раздела не считается отдельным нарушением',fix,{law:'152-ФЗ, ст. 18.1',source:LAW});}
  const externalForms=forms.filter(({form,url})=>{try{return usableLink(form.attr('action'))&&new URL(form.attr('action'),url).origin!==new URL(url).origin;}catch{return false;}});
  put('external-processors','legal','Передача заявок стороннему обработчику',externalForms.length?'review':'passed',externalForms.length?`Есть внешние адреса обработки: ${describe(externalForms)}. Место хранения и условия передачи не установлены`:'Внешние action в проверенных формах не найдены; передачи из JavaScript и CRM не исключены','Проверьте поручение обработки, перечень получателей, локализацию и трансграничную передачу',{law:'152-ФЗ, ст. 6, 12, 18',source:LAW});
}
module.exports={extendLegalChecks};
