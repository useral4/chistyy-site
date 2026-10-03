const cheerio = require('cheerio');

const privacyPattern = /политик[а-яё\s]*(?:конфиденциальност|обработк|персональн)|privacy|personal.data.policy/i;
const consentPattern = /(?:соглас[а-яё]*|соглаша[а-яё]*)[\s\S]{0,60}обработк[а-яё\s]*(?:персональн|пдн|(?:указанных\s+)?данных)/i;
const usableLink = href => !!href && !/^(?:#|javascript:|mailto:|tel:)/i.test(href);
const isDocument = r => r.ok && !/pdf|image\//i.test(r.contentType || '') && /<\w|[а-яё]/i.test(r.text || '');

function documentText(html, includeChrome=false) {
  const $ = cheerio.load(html || '');
  $('script,style,template,noscript,form').remove();
  if (!includeChrome) $('header,footer,nav').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function resourceKind(value) {
  if (privacyPattern.test(value)) return 'privacy';
  if (consentPattern.test(value) || /(?:personal[-_]?data[-_]?)?consent/i.test(value)) return 'consent';
  if (/cookie|куки/i.test(value)) return 'cookie';
  if (/оферт|условия (?:услуг|покупки|оплаты)|offer|terms/i.test(value)) return 'offer';
  if (/возврат|refund|return.policy|доставк|delivery|shipping|оплат[аы]|payment|реквизит|requisites/i.test(value)) return 'commercial';
  if (/контакт|contact|обратная связь|feedback|checkout|оформить заказ/i.test(value)) return 'page';
  return null;
}

function collectForms(pages) {
  const forms = [];
  for (const page of pages) {
    const $ = cheerio.load(page.text);
    $('form').each((i, el) => {
      const form = $(el);
      const fields = form.find('input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,select');
      const personal = fields.toArray().some(field => /email|tel|phone|name|имя|фамил|почт|телефон|сообщени|message|comment/i.test(
        ['type','name','id','autocomplete','placeholder'].map(key => $(field).attr(key) || '').join(' ')
      )) || form.find('textarea').length > 0;
      if (personal) forms.push({ $, form, url: page.finalUrl || page.url, index: i + 1 });
    });
  }
  return forms;
}

function checkboxLabel($, form, checkbox) {
  const id = $(checkbox).attr('id');
  return $(checkbox).closest('label').text() + (id ? form.find('label').filter((_, label) => $(label).attr('for') === id).text() : '');
}

function validTaxId(value) {
  if (!/^\d{10}(?:\d{2})?$/.test(value) || /^0+$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checksum = weights => weights.reduce((sum, weight, i) => sum + weight * digits[i], 0) % 11 % 10;
  return value.length === 10 ? checksum([2,4,10,3,5,9,4,6,8]) === digits[9]
    : checksum([7,2,4,10,3,5,9,4,6,8]) === digits[10] && checksum([3,7,2,4,10,3,5,9,4,6,8]) === digits[11];
}

module.exports = { privacyPattern, consentPattern, usableLink, isDocument, documentText, resourceKind, collectForms, checkboxLabel, validTaxId };
