const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { plans } = require('../lib/domain-access');
const vm = require('node:vm');

const $ = load(fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'));
const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function checkoutContext() {
  const elements = new Map();
  const requests = [];
  const document = { activeElement: null, addEventListener() {}, querySelectorAll: () => [] };
  const makeElement = key => {
    const classes = new Set();
    return {
      key, textContent: '', innerHTML: '', dataset: {}, events: {}, disabled: false,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      addEventListener(event, handler) { this.events[event] = handler; },
      setAttribute() {}, focus() { document.activeElement = this; }
    };
  };
  const radios = $('input[name="payment-plan"]').toArray().map(node => {
    const input = makeElement(node.attribs.value);
    input.value = node.attribs.value;
    input.dataset = { price: node.attribs['data-price'], sites: node.attribs['data-sites'] };
    return input;
  });
  radios.forEach(input => Object.defineProperty(input, 'checked', {
    get() { return this.selected === true; },
    set(value) { if (value) radios.forEach(radio => radio.selected = false); this.selected = value; }
  }));
  radios[0].checked = true;
  document.querySelectorAll = selector => selector === 'input[name="payment-plan"]' ? radios : [];
  document.querySelector = selector => {
    if (selector === '.stats') return null;
    if (selector === 'input[name="payment-plan"]:checked') return radios.find(radio => radio.checked);
    if (!elements.has(selector)) elements.set(selector, makeElement(selector));
    return elements.get(selector);
  };
  const modal = document.querySelector('.payment-modal');
  modal.querySelectorAll = () => radios;
  modal.querySelector = () => radios.find(radio => radio.checked);
  const context = vm.createContext({
    document, URL, URLSearchParams, location: { origin: 'https://example.test', search: '' },
    window: { location: { search: '' }, matchMedia: () => ({ matches: true }), addEventListener() {} },
    fetch: async (url, options) => {
      if (options) requests.push({ url, ...JSON.parse(options.body) });
      return { ok: !options, json: async () => options ? { error: 'Local payment stub' } : { paymentMode: 'test', passes: [] } };
    }
  });
  vm.runInContext(appSource, context, { filename: 'public/app.js' });
  return { context, document, radios, requests, element: selector => document.querySelector(selector) };
}

test('Single-site checkout is the default and other packages are optional', () => {
  const options = $('[data-payment-options]');
  assert.equal(options.prop('tagName'), 'DETAILS');
  assert.equal(options.attr('open'), undefined);
  assert.match(options.children('summary').text(), /несколько сайтов/i);
  assert.equal(options.closest('.locked-report').length, 1);
  assert.equal($('.payment-modal input[name="payment-plan"], .payment-modal [data-payment-options]').length, 0);
  assert.equal($('input[name="payment-plan"]:checked').length, 1);
  assert.equal($('input[name="payment-plan"]:checked').val(), 'single');
  assert.match($('[data-payment-buy]').text(), /Получить отчёт за 179/);
});

test('Displayed package prices and site limits match server-owned plans', () => {
  for (const plan of Object.values(plans)) {
    const radio = $(`input[name="payment-plan"][value="${plan.id}"]`);
    assert.equal(radio.length, 1);
    assert.equal(Number(radio.attr('data-price')), Number(plan.price));
    assert.equal(Number(radio.attr('data-sites')), plan.domains);
    const card = $(`[data-plan-start="${plan.id}"]`).closest('.price-plan');
    assert.equal(card.length, 1);
    assert.equal(card.find('.price-plan__price').text(), `${Number(plan.price)}\u202f₽`);
    assert.match(card.find('.price-plan__scope').text(), new RegExp(`${plan.domains} сайт`));
    assert.match(card.find('.price-plan__scope').text(), new RegExp(`${plan.days} дней`));
    assert.ok(card.find('.price-plan__audience').text().startsWith('Для '));
  }
});

test('Pricing and checkout use sites instead of domain terminology', () => {
  assert.doesNotMatch($('.pricing, .payment-modal').text(), /домен/i);
  assert.equal($('.price-plan--single [data-plan-start]').attr('data-plan-start'), 'single');
});

test('Opening a regular report resets a previous package choice to 179 rubles', () => {
  const ui = checkoutContext();
  const trigger = ui.element('.locked-report-link');
  trigger.focus();
  ui.context.openPaymentModal('agency');
  assert.equal(ui.element('[data-payment-options]').open, undefined);
  assert.equal(ui.document.activeElement, ui.element('[data-payment-buy]'));
  assert.equal(ui.element('[data-payment-buy]').textContent, 'Получить пакет за 999\u202f₽');
  ui.context.closePaymentModal();
  assert.equal(ui.document.activeElement, trigger);
  assert.equal(ui.element('.site').inert, false);
  ui.context.openPaymentModal();
  assert.equal(ui.radios.find(radio => radio.checked).value, 'single');
  assert.equal(ui.element('[data-payment-options]').open, undefined);
  assert.equal(ui.element('[data-payment-buy]').textContent, 'Получить отчёт за 179\u202f₽');
  assert.equal(ui.document.activeElement, ui.element('[data-payment-buy]'));
});

test('Inline package choice updates the report button and is preserved when checkout opens', () => {
  const ui = checkoutContext();
  const agency = ui.radios.find(radio => radio.value === 'agency');
  agency.checked = true;
  agency.events.change();
  assert.equal(ui.element('.locked-report-link').textContent, 'Получить пакет за 999\u202f₽');
  ui.element('.locked-report-link').events.click({preventDefault() {}});
  assert.equal(ui.radios.find(radio => radio.checked).value, 'agency');
  assert.equal(ui.element('[data-payment-price]').textContent, '999\u202f₽');
  assert.equal(ui.document.activeElement, ui.element('[data-payment-buy]'));
});

test('Changing an optional package updates the offer and submits only its plan ID', async () => {
  const ui = checkoutContext();
  ui.context.openPaymentModal('specialist');
  assert.equal(ui.element('[data-payment-price]').textContent, '390\u202f₽');
  const agency = ui.radios.find(radio => radio.value === 'agency');
  agency.checked = true;
  agency.events.change();
  assert.equal(ui.element('[data-payment-price]').textContent, '999\u202f₽');
  assert.equal(ui.element('[data-payment-scope]').textContent, 'До 30 сайтов · перепроверки на 30 дней');
  assert.equal(ui.element('[data-payment-buy]').textContent, 'Получить пакет за 999\u202f₽');
  vm.runInContext("state.audit = { reportToken: 'd'.repeat(48) }", ui.context);
  await ui.context.startTestPayment();
  assert.deepEqual(ui.requests, [{ url: '/api/payments', reportToken: 'd'.repeat(48), planId: 'agency' }]);
  assert.equal(ui.element('[data-payment-buy]').disabled, false);
  assert.equal(ui.element('[data-payment-hint]').textContent, 'Local payment stub');
  ui.context.openPaymentModal();
  await ui.context.startTestPayment();
  assert.equal(ui.requests[1].planId, 'single');
});
