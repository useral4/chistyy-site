const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('Fine badges omit the reference label without changing the amount', () => {
  const context = vm.createContext({state: {tab:'fines'}, formatRub: n => `${n} ₽`});
  const start = source.indexOf('function getPillText(');
  assert.ok(start >= 0);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  assert.equal(context.getPillText({fineMax:300000}), 'До 300000 ₽');
  assert.doesNotMatch(source, /Справочно до/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), /Справочно до/);
});

function toastContext() {
  const message = { textContent: '' };
  const toast = { hidden: true, dataset: {}, events: {}, querySelector: () => message, addEventListener(name, fn) { this.events[name] = fn; } };
  const close = { addEventListener: (_, fn) => { close.click = fn; } };
  const timers = new Map();
  let next = 0;
  const context = vm.createContext({
    document: { querySelector: selector => selector === '.flash-toast' ? toast : close },
    setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(source.slice(source.indexOf('const flashToast ='), source.indexOf('const state =')), context);
  return { context, toast, message, close, timers };
}

test('Flash notifications replace previous timers, pause for reading and can be dismissed', () => {
  const ui = toastContext();
  ui.context.showToast('Copied');
  assert.equal(ui.toast.hidden, false);
  assert.equal(ui.message.textContent, 'Copied');
  ui.context.showToast('Second');
  assert.equal(ui.timers.size, 1);
  ui.toast.events.mouseenter();
  assert.equal(ui.timers.size, 0);
  ui.toast.events.mouseleave();
  assert.equal(ui.timers.size, 1);
  ui.toast.events.focusin();
  assert.equal(ui.timers.size, 0);
  ui.toast.events.focusout();
  ui.close.click();
  assert.equal(ui.toast.hidden, true);
  assert.equal(ui.timers.size, 0);
});

test('Normal notifications expire, but clipboard fallback remains available to copy', () => {
  const ui = toastContext();
  ui.context.showToast('Copied');
  const timer = [...ui.timers.values()][0];
  assert.equal(timer.ms, 7000);
  timer.fn();
  assert.equal(ui.toast.hidden, true);
  ui.context.showToast('https://example.test/?report=private', 0);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.toast.hidden, false);
  ui.toast.events.mouseleave();
  assert.equal(ui.timers.size, 0);
});

test('Copying a report link never overwrites important payment state', () => {
  const handler = source.slice(source.indexOf("document.querySelector('[data-report-link]')?.addEventListener"), source.indexOf('document.querySelector("[data-report-refresh]")?.addEventListener'));
  assert.match(handler, /showToast\('Ссылка скопирована/);
  assert.doesNotMatch(handler, /report-payment-status/);
  assert.doesNotMatch(source, /Весь отчёт открыт бесплатно|В каждом разделе найдено не больше 5 проблем/);
  assert.match(source, /result\.canceled \? "Оплата отменена/);
  assert.match(source, /result\.paymentPending \? "Оплата ещё не подтверждена/);
});

test('Finding headings have two explicit lines while manual-review and empty states remain intact', () => {
  const resultTitle = { textContent: '', replaceChildren(...children) { this.children = children; } };
  const resultUrl = {};
  const state = { checkedUrl: 'https://example.test/a-long-path', tab: 'fines', audit: { checks: [], summary: {legalIssues: 4, seoIssues: 11} } };
  const context = vm.createContext({
    state, resultTitle, resultUrl, riskLabel: null, riskValue: null,
    document: { querySelector: () => null, createElement: () => ({textContent: ''}) },
    plural: (n, forms) => forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2]
  });
  vm.runInContext(source.slice(source.indexOf('function renderHero()'), source.indexOf('function getSeoOverviewHtml(')), context);
  context.renderHero();
  assert.equal(resultTitle.children[0].textContent, 'Найдено 4 проблемы');
  assert.equal(resultTitle.children[1].textContent, 'по штрафам');
  assert.equal(resultUrl.title, state.checkedUrl);
  state.tab = 'growth';
  context.renderHero();
  assert.equal(resultTitle.children[0].textContent, 'Найдено 11 проблем');
  assert.equal(resultTitle.children[1].textContent, 'по SEO');
  state.audit.warning = 'Fetch failed';
  context.renderHero();
  assert.equal(resultTitle.textContent, 'Нужна ручная проверка');
  delete state.audit.warning;
  state.audit.summary.seoIssues = 0;
  context.renderHero();
  assert.equal(resultTitle.textContent, 'SEO-проблем не найдено');
});

test('Blurred cards are neutral placeholders, never hidden findings or recommendations', () => {
  const lockedItems = {};
  const lockedReportText = {};
  const lockedReportTitle = {};
  const classes = new Set();
  const lockedReport = { classList: {toggle(name, value) { value ? classes.add(name) : classes.delete(name); }, remove(name) { classes.delete(name); }} };
  const state = {tab: 'fines', reportUnlocked: false, audit: {access: {hiddenLegal: 0, hiddenSeo: 9}, checks: [{title: 'PRIVATE FINDING', fix: 'PRIVATE REMEDY'}]}};
  const context = vm.createContext({state, lockedItems, lockedReportText, lockedReportTitle, lockedReport, plural: (_, forms) => forms[2]});
  vm.runInContext(source.slice(source.indexOf('function renderLockedReport('), source.indexOf('function renderIssueList()')), context);
  context.renderLockedReport(true);
  assert.equal((lockedItems.innerHTML.match(/class="locked-item"/g) || []).length, 3);
  assert.doesNotMatch(lockedItems.innerHTML, /PRIVATE/);
  assert.match(lockedItems.innerHTML, /Пункт полного отчёта/);
  assert.match(lockedReportText.textContent, /Этот раздел открыт/);
  assert.doesNotMatch(lockedReportText.textContent, /Одна оплата|блюр/);
  state.reportUnlocked = true;
  context.renderLockedReport(null);
  assert.equal(classes.has('is-hidden'), true);
  assert.equal(lockedItems.innerHTML, '');
});

test('Risk hero displays the server range, stays hidden for SEO and never invents a minimum', () => {
  const state = {tab: 'fines', audit: {checks: [], summary: {fineMin:180000, fineMax:360000}}};
  const riskLabel = {}, card = {}, riskValue = {parentElement: card};
  const context = vm.createContext({state, riskLabel, riskValue, resultUrl:null, resultTitle:null, document:{querySelector:()=>null}, formatRub:n=>`${n} ₽`});
  vm.runInContext(source.slice(source.indexOf('function renderHero()'), source.indexOf('function getSeoOverviewHtml(')), context);
  context.renderHero();
  assert.equal(riskLabel.textContent, 'Общий риск штрафов:');
  assert.equal(riskValue.textContent, '180000 ₽ – 360000 ₽');
  assert.equal(card.hidden, false);
  state.tab = 'growth';
  context.renderHero();
  assert.equal(card.hidden, true);
  state.tab = 'fines';
  state.audit.summary.fineMin = null;
  context.renderHero();
  assert.equal(riskValue.textContent, 'Требует уточнения');
  state.audit.summary.fineMax = 0;
  context.renderHero();
  assert.equal(card.hidden, true);
});
