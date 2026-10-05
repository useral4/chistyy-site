const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const scratch = path.resolve(__dirname, '../.cache/access-tests-' + process.pid);
process.env.REPORTS_DIR = scratch;
process.env.YOOKASSA_MODE = 'test';
process.env.YOOKASSA_SHOP_ID = '1485993';
process.env.YOOKASSA_SECRET_KEY = 'test_unit_only';
process.env.PUBLIC_URL = 'https://kinavapro.ru';
process.env.BROWSER_AUDIT = 'off';
const reports = require('../lib/reports');
const access = require('../lib/domain-access');
const { handlePayments } = require('../lib/payments');
const realFetch = global.fetch;
const realNow = Date.now;
const audit = (url, count = 6) => ({ url, checkedAt: new Date().toISOString(), checks: Array.from({ length: count }, (_, i) => ({ id: 'legal-' + i, group: 'legal', status: 'failed', title: 'Private finding ' + i, evidence: 'Private evidence ' + i, fix: 'Private fix ' + i })) });
const request = (url, body, cookie = '') => Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), { url, method: body ? 'POST' : 'GET', headers: { cookie, host: 'kinavapro.ru' } });
async function invoke(url, body, cookie) {
  let result; const headers = {};
  await handlePayments(request(url, body, cookie), { setHeader: (key, value) => headers[key] = value }, (_res, status, data) => result = { status, ...data });
  return { ...result, headers };
}
async function purchase(url, planId = 'single', capturedAt, count = 6) {
  const token = await reports.create(audit(url, count));
  let payload;
  global.fetch = async (_url, options) => {
    if (options.method === 'POST') payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: '22d6d597-000f-5000-9000-145f6df21d6f', test: true, status: options.method === 'POST' ? 'pending' : 'succeeded', paid: options.method !== 'POST', captured_at: capturedAt, amount: { value: access.plans[planId].price, currency: 'RUB' }, metadata: { report_token: token }, confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/test' } }) };
  };
  const payment = await invoke('/api/payments', { reportToken: token, planId, price: '0.01' });
  assert.equal(payment.status, 201);
  assert.equal(payload.amount.value, access.plans[planId].price);
  assert.equal(payload.save_payment_method, undefined, 'No recurring payments are configured');
  const shared = await invoke('/api/report?token=' + token);
  assert.equal(shared.paid, true);
  assert.equal(shared.domainAccess.accessUrl, undefined);
  assert.equal(shared.domainAccess.domains, undefined, 'Report sharing cannot reveal other clients');
  assert.equal(shared.headers['Set-Cookie'], undefined, 'A report link is not a package credential');
  const key=(await reports.read(token)).passToken;
  assert.notEqual(key, token, 'Report and package capabilities are distinct');
  assert.equal(new URL(payload.confirmation.return_url).searchParams.get('access'), key);
  assert.equal((await invoke('/api/access', {token})).status, 404, 'A shareable receipt cannot restore the package');
  const restored=await invoke('/api/access',{token:key});
  const cookie=restored.headers['Set-Cookie'].split(';')[0];
  const receipt=await invoke('/api/report?token='+token,undefined,cookie);
  receipt.headers=restored.headers;
  return { token, key, receipt, cookie };
}
async function recheck(url, cookie, count) {
  const token = await reports.create(audit(url, count));
  const record = await reports.read(token);
  const pass = await access.apply(record, token, request('/api/audit', {}, cookie));
  return { token, pass, record: await reports.read(token) };
}
after(async () => {
  global.fetch = realFetch; Date.now = realNow;
  assert.ok(scratch.startsWith(path.resolve(__dirname, '../.cache') + path.sep));
  await fs.rm(scratch, { recursive: true, force: true });
});

test('Canonical domain ignores protocol, www, path, case and default ports, not other subdomains', () => {
  for (const url of ['https://WWW.Example.ru/path?q=a', 'http://example.ru:80', 'https://example.ru:443', 'https://example.ru./']) assert.equal(access.domain(url), 'example.ru');
  assert.equal(access.domain('https://shop.example.ru'), 'shop.example.ru');
  assert.equal(access.domain('https://example.ru:8443'), 'example.ru:8443');
  assert.equal(access.domain('https://пример.рф'), access.domain('http://www.xn--e1afmkfd.xn--p1ai'));
  assert.throws(() => access.domain('https://user:password@example.ru'));
});

test('Each price and quota are server-owned; pending payments cannot change tier or grant access', async () => {
  for (const planId of ['single', 'specialist', 'agency']) {
    const bought = await purchase('https://' + planId + '.example.ru', planId);
    assert.equal(bought.receipt.domainAccess.limit, access.plans[planId].domains);
    assert.equal(bought.receipt.domainAccess.used, 1);
    assert.equal(bought.receipt.expiresAt, null, 'Purchased snapshots have no expiry');
    assert.match(bought.receipt.headers['Set-Cookie'], /HttpOnly; SameSite=Lax; Secure/);
  }
  const token = await reports.create(audit('https://pending.example.ru'));
  const record = await reports.read(token); record.planId = 'agency'; record.paymentId = 'pending-id'; record.confirmationUrl = 'https://yoomoney.ru/test'; await reports.write(token, record);
  assert.equal((await invoke('/api/payments', { reportToken: token, planId: 'single' })).status, 409);
  for (const planId of ['missing', '__proto__', 'constructor']) assert.equal((await invoke('/api/payments', { reportToken: token, planId })).status, 400);
  assert.equal((await invoke('/api/access', { token })).status, 404);
});

test('Same domain rechecks are full only for the buyer, never renew the 30-day term or consume another slot', async () => {
  const bought = await purchase('https://example.ru');
  const expiry = bought.receipt.domainAccess.expiresAt;
  for (const url of ['http://www.example.ru/path', 'https://example.ru/another']) {
    const checked = await recheck(url, bought.cookie);
    assert.equal(checked.pass.used, 1); assert.equal(checked.pass.expiresAt, expiry);
    const snapshot = await invoke('/api/report?token=' + checked.token);
    assert.equal(snapshot.paid, true); assert.equal(snapshot.audit.checks.length, 6);
    assert.equal(snapshot.domainAccess.accessUrl, undefined, 'Sharing a snapshot must not expose the whole package key');
    assert.equal(snapshot.domainAccess.owned, false);
    assert.equal((await invoke('/api/access', {token: checked.token})).status, 404);
  }
  assert.equal((await recheck('https://example.ru', '')).pass, null, 'A stranger cannot use another buyer\'s domain');
  assert.equal((await recheck('https://shop.example.ru', bought.cookie)).pass, null);
  assert.equal((await recheck('https://other.ru', bought.cookie)).pass, null);
  assert.equal((await invoke('/api/access', { token: 'a'.repeat(48) })).status, 404);
});

test('Buying a package on a free report starts with zero used domains', async () => {
  const bought = await purchase('https://clean.ru', 'specialist', undefined, 2);
  assert.equal(bought.receipt.domainAccess.used, 0);
  assert.equal(bought.receipt.domainAccess.remaining, 10);
  assert.equal((await recheck('https://client.ru', bought.cookie)).pass.used, 1);
});

test('An underpriced package payment cannot unlock a report or create an active pass', async () => {
  const token = await reports.create(audit('https://unpaid.ru'));
  const record = await reports.read(token);
  record.planId = 'agency'; record.passToken = '9'.repeat(48); record.paymentId = 'underpaid-id';
  await reports.write(token, record);
  global.fetch = async () => ({ok: true, json: async () => ({id: record.paymentId, test: true, paid: true, status: 'succeeded', amount: {value: '179.00', currency: 'RUB'}, metadata: {report_token: token}})});
  const result = await invoke('/api/report?token=' + token);
  assert.equal(result.paid, false);
  assert.equal(result.audit.access.full, false);
  assert.equal((await invoke('/api/access', {token: record.passToken})).status, 404);
});

test('Package quota is atomic under concurrent audits; same domain and free reports cost no extra slots', async () => {
  const bought = await purchase('https://client0.ru', 'specialist');
  const results = await Promise.all(Array.from({ length: 18 }, (_, i) => recheck('https://client' + (i + 1) + '.ru', bought.cookie)));
  assert.equal(results.filter(item => item.pass).length, 9);
  assert.equal((await access.read(bought.key)).domains.length, 10);
  const repeats = await Promise.all(Array.from({ length: 5 }, () => recheck('http://www.client0.ru/path', bought.cookie)));
  assert.ok(repeats.every(item => item.pass.used === 10));
  const free = await recheck('https://free.ru', bought.cookie, 2);
  assert.equal(free.pass, null); assert.equal((await access.read(bought.key)).domains.length, 10);
  assert.equal((await recheck('https://over-limit.ru', bought.cookie)).pass, null);
});

test('Thirty days start at capture time; exact expiry stops new audits but leaves all paid snapshots readable', async () => {
  const captured = new Date(realNow() - 2 * 86400000).toISOString();
  const bought = await purchase('https://expiry.ru', 'single', captured);
  assert.equal(bought.receipt.domainAccess.expiresAt, Date.parse(captured) + 30 * 86400000);
  const snapshot = await recheck('http://www.expiry.ru', bought.cookie);
  Date.now = () => bought.receipt.domainAccess.expiresAt;
  try {
    assert.equal((await recheck('https://expiry.ru', bought.cookie)).pass, null);
    for (const token of [bought.token, snapshot.token]) {
      const restored = await invoke('/api/report?token=' + token);
      assert.equal(restored.paid, true); assert.equal(restored.audit.checks[5].fix, 'Private fix 5');
      assert.equal(restored.domainAccess.active, false);
      assert.equal(restored.domainAccess.expiresAt, bought.receipt.domainAccess.expiresAt);
    }
    assert.equal((await invoke('/api/access', { token: bought.key })).pass.active, false);
  } finally { Date.now = realNow; }
});

test('Legacy paid links migrate once, survive module reload, and restore on another browser without extending access', async () => {
  const token = await reports.create(audit('https://legacy.ru'));
  const record = await reports.read(token); record.paid = true; record.paidAt = realNow() - 10 * 86400000; record.expiresAt = realNow() - 1; await reports.write(token, record);
  const restored = await invoke('/api/report?token=' + token);
  assert.equal(restored.paid, true);
  assert.equal(restored.domainAccess.expiresAt, record.paidAt + 30 * 86400000);
  delete require.cache[require.resolve('../lib/domain-access')];
  const reloaded = require('../lib/domain-access');
  assert.equal((await reloaded.read(token)).expiresAt, restored.domainAccess.expiresAt);
  const otherBrowser = await invoke('/api/access', { token });
  const cookie = otherBrowser.headers['Set-Cookie'].split(';')[0];
  assert.equal((await recheck('https://www.legacy.ru', cookie)).pass.expiresAt, restored.domainAccess.expiresAt);
});

test('Legacy pending payments still restore from their original return link, including late confirmation', async () => {
  const token = await reports.create(audit('https://old-payment.ru'));
  const record = await reports.read(token);
  record.paymentId = 'old-payment-id'; record.expiresAt = realNow() - 1;
  await reports.write(token, record);
  global.fetch = async () => ({ok: true, json: async () => ({id: record.paymentId, test: true, paid: true, status: 'succeeded', captured_at: new Date(realNow() - 86400000).toISOString(), amount: {value: '179.00', currency: 'RUB'}, metadata: {report_token: token}})});
  const restored = await invoke('/api/report?token=' + token);
  assert.equal(restored.status, 200);
  assert.equal(restored.paid, true);
  assert.equal(restored.domainAccess.owned, true);
  assert.ok(restored.headers['Set-Cookie']);
  assert.equal((await reports.read(token)).passToken, undefined);
  assert.equal((await invoke('/api/access', {token})).status, 200);
});

test('Emailing a shared report never exposes the package key; the buyer can email their recovery link', async () => {
  const mail = require('../lib/mail');
  const originalConfigured = mail.reportEmailConfigured, originalNotify = mail.notifyReport;
  const deliveries = [];
  mail.reportEmailConfigured = () => true;
  mail.notifyReport = async data => deliveries.push(data);
  try {
    const bought = await purchase('https://mail-client.ru', 'agency');
    assert.equal((await invoke('/api/report/email', {reportToken: bought.token, email: 'client@example.ru'})).sent, true);
    assert.equal(deliveries[0].accessUrl, null);
    assert.equal(deliveries[0].reportUrl, 'https://kinavapro.ru/?report=' + bought.token);
    assert.equal((await invoke('/api/report/email', {reportToken: bought.token, email: 'owner@example.ru'}, bought.cookie)).sent, true);
    assert.equal(deliveries[1].accessUrl, 'https://kinavapro.ru/?access=' + bought.key);
  } finally { mail.reportEmailConfigured = originalConfigured; mail.notifyReport = originalNotify; }
});

test('Audit consent and same-origin protection run before requests or quota consumption', async () => {
  const safe = require('../lib/safe-fetch');
  const originalSafeFetch = safe.fetchText;
  let pageRequests = 0;
  safe.fetchText = async url => { pageRequests++; return { ok: true, status: 200, contentType: 'text/html', finalUrl: String(url), url: String(url), responseMs: 50, text: '<!doctype html><html><body><form><input name="email" type="email"></form><img src="/test.jpg"></body></html>' }; };
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const denied = await realFetch(base + '/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.ru', consent: false }) });
    assert.equal(denied.status, 400);
    assert.equal(pageRequests, 0);
    const crossSite = await realFetch(base + '/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ url: 'https://example.ru', consent: true }) });
    assert.equal(crossSite.status, 403);
    const forgedRestore = await realFetch(base + '/api/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' }, body: JSON.stringify({ token: 'a'.repeat(48) }) });
    assert.equal(forgedRestore.status, 403);
    assert.equal((await realFetch(base + '/api/audit', { method: 'PUT' })).status, 405);
    const bought = await purchase('https://example.ru');
    const publicPreview = await realFetch(base + '/api/audit?url=https://www.example.ru', { headers: { Cookie: bought.cookie } });
    const preview = await publicPreview.json();
    assert.equal(preview.paid, false); assert.equal(preview.access.full, false, 'GET stays a preview even with a paid cookie');
    const paidResponse = await realFetch(base + '/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: bought.cookie, Origin: base }, body: JSON.stringify({ url: 'http://www.example.ru', consent: true }) });
    const checked = await paidResponse.json();
    assert.equal(checked.paid, true); assert.equal(checked.access.full, true);
    assert.equal(checked.domainAccess.expiresAt, bought.receipt.domainAccess.expiresAt);
    assert.equal(checked.domainAccess.used, 1);
    const strangerResponse = await realFetch(base + '/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ url: 'https://example.ru', consent: true }) });
    assert.equal((await strangerResponse.json()).paid, false);
  } finally { safe.fetchText = originalSafeFetch; await new Promise(resolve => server.close(resolve)); }
});
