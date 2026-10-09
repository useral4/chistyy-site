const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeFines, withFineRange } = require('../lib/fine-summary');
const { preview, full } = require('../lib/reports');
const failed = (id, fineMax, extra = {}) => ({ id, group: 'legal', status: 'failed', fineMax, ...extra });

test('Fine range sums distinct compositions and counts overlapping consent findings only once', () => {
  const checks = [failed('privacy-policy', 60000), failed('form-consent', 300000), failed('cookie-consent', 300000), failed('analytics-before-consent', 300000), failed('details', 0)];
  assert.deepEqual(summarizeFines(checks), { fineMin: 180000, fineMax: 360000 });
  assert.deepEqual(summarizeFines(checks.slice(1)), { fineMin: 150000, fineMax: 300000 });
});

test('Reviews, passed checks and SEO do not create a fine range; unknown minima are not fabricated', () => {
  assert.deepEqual(summarizeFines([failed('privacy-policy', 60000, {status:'passed'}), failed('form-consent', 300000, {status:'review'}), failed('seo', 300000, {group:'seo'})]), { fineMin: 0, fineMax: 0 });
  assert.deepEqual(summarizeFines([failed('unknown', 500000)]), { fineMin: null, fineMax: 500000 });
  assert.deepEqual(summarizeFines([failed('form-consent', 100000)]), { fineMin: null, fineMax: 100000 });
});

test('Saved reports get the full range before entitlement filtering without leaking hidden findings', () => {
  const checks = [failed('privacy-policy', 60000), ...Array.from({length:5}, (_, i) => failed('other-' + i, 0)), failed('form-consent', 300000)];
  const audit = { summary: { fineMax: 360000 }, checks };
  const p = preview(audit, 'token');
  const f = full(audit, 'token');
  assert.equal(p.summary.fineMin, 180000);
  assert.equal(f.summary.fineMin, 180000);
  assert.equal(p.access.hiddenLegal, 4);
  assert.equal(p.checks.length, 3);
  assert.equal(audit.summary.fineMin, undefined);
});

test('Calculation explanation separates report findings from sanction groups without exposing finding titles',()=>{
  const audit={summary:{},checks:[failed('form-consent',300000,{title:'PRIVATE FORM'}),failed('cookie-consent',300000),failed('analytics-before-consent',300000),failed('privacy-policy',60000)]};
  const {summary}=withFineRange(audit);
  assert.match(summary.fineExplanation,/3 пункта отчёта; в оценке учтено один раз, 150\s000 ₽ – 300\s000 ₽/);
  assert.match(summary.fineExplanation,/ч\. 3: 1 пункт отчёта/);
  assert.match(summary.fineExplanation,/Независимые эпизоды/);
  assert.doesNotMatch(summary.fineExplanation,/PRIVATE FORM/);
  assert.equal(summary.fineMin,180000);
  assert.equal(summary.fineMax,360000);
});
