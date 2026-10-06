const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const { load } = require('cheerio');

const publicDir = path.join(__dirname, '../public');
const $ = load(fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8'));
const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

function fontTable(font, tag) {
  assert.equal(font.toString('ascii', 0, 4), 'wOFF');
  for (let i = 0; i < font.readUInt16BE(12); i++) {
    const record = 44 + i * 20;
    if (font.toString('ascii', record, record + 4) !== tag) continue;
    const offset = font.readUInt32BE(record + 4);
    const length = font.readUInt32BE(record + 8);
    const originalLength = font.readUInt32BE(record + 12);
    const data = font.subarray(offset, offset + length);
    return length < originalLength ? inflateSync(data) : data;
  }
  assert.fail(`Missing font table: ${tag}`);
}

function hasGlyph(font, codepoint) {
  const cmap = fontTable(font, 'cmap');
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const offset = cmap.readUInt32BE(8 + i * 8);
    if (cmap.readUInt16BE(offset) !== 4) continue;
    const map = cmap.subarray(offset);
    const segments = map.readUInt16BE(6) / 2;
    const start = 16 + segments * 2;
    const delta = start + segments * 2;
    const range = delta + segments * 2;
    for (let segment = 0; segment < segments; segment++) {
      const first = map.readUInt16BE(start + segment * 2);
      if (codepoint < first || codepoint > map.readUInt16BE(14 + segment * 2)) continue;
      const adjustment = map.readInt16BE(delta + segment * 2);
      const glyphOffset = map.readUInt16BE(range + segment * 2);
      if (!glyphOffset) return ((codepoint + adjustment) & 0xffff) !== 0;
      const glyph = map.readUInt16BE(range + segment * 2 + glyphOffset + (codepoint - first) * 2);
      return glyph !== 0 && ((glyph + adjustment) & 0xffff) !== 0;
    }
  }
  return false;
}

test('Mobile form has required consent before its submit button in document order', () => {
  const row = $('.check-form .form-row');
  const children = row.children().toArray();
  const input = row.children('#site-url')[0];
  const policy = row.children('.policy')[0];
  const submit = row.children('button[type="submit"]')[0];
  assert.ok(children.indexOf(input) < children.indexOf(policy));
  assert.ok(children.indexOf(policy) < children.indexOf(submit));
  assert.equal(row.find('input[type="checkbox"][required]').length, 1);
  assert.equal(row.find('input[type="checkbox"]').attr('checked'), undefined);
  assert.equal(row.find('.policy a').attr('href'), '/privacy.html');
  assert.equal(row.find('.policy-error').text(), '');
  assert.match(css, /grid-template-areas: "url" "policy" "submit"/);
  assert.match(css, /\.form-row:has\(\.policy-error:not\(:empty\)\)/);
  assert.doesNotMatch(css, /\.form-row input\s*\{/);
});

test('Technical report copy is removed from the hero and retained in a closed disclosure', () => {
  assert.equal($('.result-hero .audit-summary, .result-hero .audit-scope, [data-report-access]').length, 0);
  const details = $('.result-panel > details.audit-details');
  assert.equal(details.length, 1);
  assert.equal(details.attr('open'), undefined);
  assert.equal(details.find('.audit-summary, .audit-scope').length, 2);
  assert.equal($('.report-actions [data-report-download]').length, 1);
  assert.equal($('.report-actions [data-report-print]').length, 1);
});

test('All pages use the supplied same-origin Onest files instead of Google Fonts', () => {
  for (const filename of ['index.html', 'terms.html', 'consent.html', 'cookies.html', 'privacy.html']) {
    const source = fs.readFileSync(path.join(publicDir, filename), 'utf8');
    assert.doesNotMatch(source, /fonts\.(googleapis|gstatic)\.com/);
    assert.match(source, /styles\.css/);
  }
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  assert.equal(faces.length, 9);
  for (const [, declarations] of faces) {
    const filename = declarations.match(/url\("\/assets\/fonts\/([^"/]+)"\)/)[1];
    const weight = Number(declarations.match(/font-weight:\s*(\d+)/)[1]);
    const font = fs.readFileSync(path.join(publicDir, 'assets/fonts', filename));
    // These two supplied exports have legacy OS/2 weight 250; their named CSS weights are intentional.
    const exportedWeight = /Onest-(Thin|ExtraLight)\.woff/.test(filename) ? 250 : weight;
    assert.equal(fontTable(font, 'OS/2').readUInt16BE(4), exportedWeight, filename);
    const names = fontTable(font, 'name');
    const strings = names.subarray(names.readUInt16BE(4));
    assert.ok(strings.includes(Buffer.from('Onest', 'utf16le').swap16()), filename);
    for (const codepoint of [0x41, 0x42f, 0x430, 0x20bd]) assert.ok(hasGlyph(font, codepoint), `${filename}: ${codepoint}`);
    assert.match(declarations, /font-display:\s*swap/);
  }
});

test('Statistics expose three accessible horizontal navigation targets', () => {
  assert.equal($('.stats .stat').length, 3);
  assert.equal($('.stats').attr('tabindex'), '0');
  const buttons = $('.stats-nav button');
  assert.equal(buttons.length, 3);
  buttons.each((index, button) => {
    assert.equal($(button).attr('aria-controls'), $('.stats').attr('id'));
    assert.equal($(button).attr('data-stat-index'), String(index));
    assert.ok($(button).attr('aria-label'));
    assert.equal($(button).attr('aria-pressed'), index === 0 ? 'true' : 'false');
  });
  assert.match(css, /\.stats\s*\{[^}]*display: flex;[^}]*overflow-x: auto;[^}]*scroll-snap-type: x mandatory;/);
});

test('Mobile statistics reset desktop translations and use equal full-width slides', () => {
  assert.match(css, /\.stats \.stat\s*\{[^}]*scroll-snap-align: start; transform: none;/);
  assert.match(css, /\.stats \.stat\s*\{ flex-basis: 100%; \}/);
});

test('Mobile lead has four lines and hidden breaks never join adjacent words', () => {
  assert.equal($('.violations .section-lead > span').length, 4);
  assert.match(css, /\.violations \.section-lead > span\s*\{ display: block; white-space: nowrap;/);
  $('.stats br, .service-card br, .about br, .results > p br, .bottom-cta br').each((_, br) => {
    const previous = br.prev;
    const next = br.next;
    assert.ok(previous?.type === 'text' && /\s$/.test(previous.data) || next?.type === 'text' && /^\s/.test(next.data), 'Hidden line break needs a word separator');
  });
});

test('Hero uses Figma typography, compact consent and the requested submit label', () => {
  assert.equal($('.hero h1 > span').length, 3);
  assert.match($('.hero .form-row > button').text(), /Проверить нарушения/);
  assert.match(css, /\.hero h1\s*\{ font-size: 44px; line-height: 1; \}/);
  assert.match(css, /\.hero \.policy\s*\{ min-height: 28px; margin: 0; gap: 7px; \}/);
  assert.match(css, /@container \(max-width: 364px\)/);
});

test('Statistics use small eager assets and mobile CTA keeps its explicit heading break', () => {
  $('.stats img').each((_, image) => {
    assert.equal($(image).attr('loading'), 'eager');
    const asset = fs.readFileSync(path.join(publicDir, $(image).attr('src')));
    assert.equal(asset.toString('ascii', 8, 12), 'WEBP');
    assert.ok(asset.length < 100000);
  });
  assert.match(css, /\.stats \.stat img \{ width: 136px; height: 136px; margin: 0 auto 24px;/);
  assert.match(css, /\.bottom-cta h2 br \{ display: initial; \}/);
});

test('Both mobile arcs are centered without inherited translation or corners inside the viewport', () => {
  assert.match(css, /\.dark-stage::after\s*\{ right: auto; bottom: -48px; left: -20%; width: 140%;[^}]*transform: none;/);
  assert.match(css, /\.bottom-cta::before\s*\{ left: -20%; width: 140%;[^}]*transform: none;/);
  assert.equal($('.price-plan').last().find('li').length, 4);
});

test('Mobile service illustrations are in normal flow and client navigation has a real destination', () => {
  assert.match(css, /\.service-card > img, \.service-card\.featured > img, \.service-card:nth-child\(3\) > img\s*\{\s*position: static;/);
  assert.match(css, /\.chat-visual\s*\{\s*position: relative; top: auto; left: auto;/);
  assert.match(css, /\.light-lead br, \.service-card br, \.about br, \.results > p br, \.bottom-cta br\s*\{\s*display: none;/);
  const target = $('.results .outline-pill').attr('href');
  assert.equal($(target).length, 1);
});

test('Payment information is a separate monochrome document without orphaned checkout links', () => {
  const terms = load(fs.readFileSync(path.join(publicDir, 'terms.html'), 'utf8'));
  const termsCss = fs.readFileSync(path.join(publicDir, 'terms.css'), 'utf8');
  assert.equal($('.payment-info, #payment-terms').length, 0);
  assert.equal(terms('body.offer-page').length, 1);
  assert.equal(terms('.terms-doc section').length, 6);
  assert.equal(terms('#payment-terms').length, 1);
  assert.equal(terms('#requisites').length, 1);
  assert.equal(terms('link[href="/terms.css"]').length, 1);
  assert.equal($('[data-payment-terms]').attr('href'), '/terms.html#payment-terms');
  assert.equal($('[data-payment-terms]').attr('target'), '_blank');
  assert.match($('[data-payment-terms]').attr('rel'), /noopener/);
  assert.equal($('.legal-footer a[href="/terms.html"]').length, 1);
  assert.match(termsCss, /\.offer-page\s*\{\s*background: #fff; color: #181818;/);
  assert.match(termsCss, /@media print[\s\S]*display: block !important/);
  assert.doesNotMatch(termsCss, /gradient/i);
  for (const [, color] of termsCss.matchAll(/#([a-f0-9]{6}|[a-f0-9]{3})\b/gi)) {
    const expanded = color.length === 3 ? [...color].map(channel => channel + channel).join('') : color;
    assert.equal(expanded.slice(0, 2), expanded.slice(2, 4));
    assert.equal(expanded.slice(2, 4), expanded.slice(4, 6));
  }
});
