const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const sliderSource = source.slice(source.indexOf('function getStatPosition('), source.indexOf('function updatePaymentPlan('));

function sliderContext() {
  const mode = { mobile: true, reduced: false };
  const makeElement = () => {
    const classes = new Set();
    const attributes = new Map();
    return {
      events: {},
      classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value) },
      addEventListener(name, handler) { this.events[name] = handler; },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: name => attributes.get(name)
    };
  };
  const indicators = Array.from({ length: 3 }, makeElement);
  indicators.forEach((button, index) => button.setAttribute('aria-pressed', String(index === 0)));
  const statPositions = ['stat-left', 'stat-center', 'stat-right'];
  const statCards = statPositions.map((position, index) => {
    const card = makeElement();
    card.classList.add(position);
    card.offsetLeft = index * 316;
    return card;
  });
  const stats = Object.assign(makeElement(), {
    scrollLeft: 0, scrolls: [],
    scrollTo(options) { this.scrolls.push(options); this.scrollLeft = options.left; this.events.scroll(); }
  });
  const site = { dataset: { view: 'home' } };
  const document = { hidden: false, querySelectorAll: () => indicators };
  let tick;
  const window = {
    matchMedia: query => ({ get matches() { return query.includes('reduced-motion') ? mode.reduced : mode.mobile; } }),
    setInterval: handler => { tick = handler; },
    setTimeout: handler => handler()
  };
  const context = vm.createContext({ stats, statCards, statPositions, site, document, window });
  vm.runInContext(sliderSource, context);
  context.initStatsSlider();
  return { stats, statCards, indicators, mode, document, site, tick: () => tick() };
}

test('Mobile statistics stay readable without automatic desktop rotation; dots follow scrolling', () => {
  const ui = sliderContext();
  ui.tick();
  assert.equal(ui.statCards[0].classList.contains('stat-left'), true);
  ui.indicators[2].events.click();
  assert.equal(ui.stats.scrollLeft, 632);
  assert.equal(ui.stats.scrolls.at(-1).behavior, 'smooth');
  assert.deepEqual(ui.indicators.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  ui.stats.scrollLeft = 300;
  ui.stats.events.scroll();
  assert.equal(ui.indicators[1].getAttribute('aria-pressed'), 'true');
});

test('Statistics keyboard navigation stays within bounds and honors reduced motion', () => {
  const ui = sliderContext();
  ui.mode.reduced = true;
  const key = value => {
    let prevented = false;
    ui.stats.events.keydown({ key: value, target: ui.stats, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  };
  key('End');
  assert.equal(ui.stats.scrollLeft, 632);
  assert.equal(ui.stats.scrolls.at(-1).behavior, 'instant');
  key('ArrowRight');
  assert.equal(ui.stats.scrollLeft, 632);
  key('ArrowLeft');
  assert.equal(ui.stats.scrollLeft, 316);
  key('Home');
  key('ArrowLeft');
  assert.equal(ui.stats.scrollLeft, 0);
});

test('Desktop rotation pauses on mobile resize, hidden pages, reports and reduced motion', () => {
  const ui = sliderContext();
  ui.mode.mobile = false;
  ui.tick();
  assert.equal(ui.statCards[0].classList.contains('stat-center'), true);
  const paused = () => { ui.tick(); assert.equal(ui.statCards[0].classList.contains('stat-center'), true); };
  ui.mode.mobile = true;
  paused();
  ui.mode.mobile = false;
  ui.document.hidden = true;
  paused();
  ui.document.hidden = false;
  ui.site.dataset.view = 'result';
  paused();
  ui.site.dataset.view = 'home';
  ui.mode.reduced = true;
  paused();
});

test('Old payment-terms bookmarks redirect to the separate document', () => {
  const start = source.indexOf('function redirectLegacyPaymentTerms(');
  const end = source.indexOf('function renderPassedChecks(', start);
  const replacements = [];
  let hashChange;
  const window = {
    location: { hash: '#pricing', replace: url => replacements.push(url) },
    addEventListener(name, handler) { assert.equal(name, 'hashchange'); hashChange = handler; }
  };
  vm.runInNewContext(source.slice(start, end), { window });
  assert.deepEqual(replacements, []);
  window.location.hash = '#payment-terms';
  hashChange();
  assert.deepEqual(replacements, ['/terms.html#payment-terms']);
});
