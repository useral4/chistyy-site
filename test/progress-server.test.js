const {test, before, after, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kinava-progress-'));
process.env.REPORTS_DIR = root;
const gate = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
let pageGate, browserGate, saveGate, failFetch, failSave, pageRequests = 0;
const safe = require('../lib/safe-fetch');
safe.fetchText = async input => {
  const url = new URL(input);
  if (url.pathname === '/') {
    pageRequests++;
    if (pageGate) await pageGate.promise;
    if (failFetch) throw new Error('Site unavailable');
  }
  return {ok:true,status:200,contentType:'text/html',finalUrl:url.href,headers:{},text:url.pathname === '/' ? '<html><body><form><input type="email"></form><img src="/photo.jpg"></body></html>' : '', responseMs:50};
};
require('../lib/browser-audit').inspectBrowser = async () => {
  if (browserGate) await browserGate.promise;
  return {available:false,reason:'Local browser stub'};
};
const reports = require('../lib/reports');
const create = reports.create;
reports.create = async audit => {
  if (saveGate) await saveGate.promise;
  if (failSave) throw Object.assign(new Error('Private storage path'), {code:'EACCES'});
  return create(audit);
};
const {server} = require('../server');
const {collectResources} = require('../lib/audit-engine');
let base;
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
beforeEach(() => { pageGate = browserGate = saveGate = null; failFetch = failSave = false; pageRequests = 0; });
after(async () => {
  await new Promise(resolve => server.close(resolve));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(root, {recursive:true,force:true});
});
async function* events(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream:!done});
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (line.trim()) yield JSON.parse(line);
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
const request = () => fetch(base + '/api/audit?url=https://example.ru', {headers:{Accept:'application/x-ndjson'}});

test('Live progress reaches the client before fetching finishes and 100% waits for saving', {timeout:10000}, async () => {
  pageGate = gate(); browserGate = gate(); saveGate = gate();
  const response = await request(), stream = events(response), updates = [];
  try {
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const first = (await stream.next()).value;
    assert.deepEqual([first.completed, first.total], [0, 7]);
    updates.push(first);
    pageGate.resolve();
    while (updates.at(-1).message !== 'Проверяем сайт в чистом браузере') updates.push((await stream.next()).value);
    assert.equal(updates.at(-1).completed, 4);
    browserGate.resolve();
    while (updates.at(-1).completed < 6) updates.push((await stream.next()).value);
    assert.equal(updates.at(-1).message, 'Сохраняем отчёт и проверяем доступ');
    assert.equal(fs.readdirSync(root).filter(file => file.endsWith('.json')).length, 0);
    saveGate.resolve();
    let result;
    for await (const event of stream) { if (event.type === 'progress') updates.push(event); else result = event.audit; }
    assert.equal(updates.at(-1).completed, 7);
    assert.equal(updates.at(-1).message, 'Отчёт готов');
    for (let i = 1; i < updates.length; i++) assert.ok(updates[i].completed >= updates[i - 1].completed);
    const record = await reports.read(result.reportToken);
    assert.ok(record);
    assert.equal(result.paid, false);
    assert.ok(record.audit.checks.length > result.checks.length, 'Streaming must preserve the paywall');
    const visible = new Set(reports.access(record.audit).visibleIds);
    assert.ok(result.checks.filter(check=>check.status==='failed').every(check=>visible.has(check.id)));
  } finally { pageGate.resolve(); browserGate.resolve(); saveGate.resolve(); await stream.return(); }
});

test('Saving failures end the stream without a false 100% or private error details', async () => {
  failSave = true;
  const all = [];
  for await (const event of events(await request())) all.push(event);
  assert.equal(Math.max(...all.filter(e=>e.type==='progress').map(e=>e.completed)), 6);
  assert.equal(all.at(-1).type, 'error');
  assert.match(all.at(-1).error, /не удалось сохранить/);
  assert.doesNotMatch(JSON.stringify(all), /Private storage path|EACCES/);
});

test('Inaccessible sites return manual-review results without claiming the audit completed', async () => {
  failFetch = true;
  const all = [];
  for await (const event of events(await request())) all.push(event);
  assert.equal(all.filter(e=>e.type==='progress').at(-1).completed, 0);
  assert.ok(all.at(-1).audit.warning);
  assert.equal(all.at(-1).audit.reportToken, undefined);
});

test('Stream opt-in never bypasses validation, consent or same-origin controls', async () => {
  const options = {method:'POST',headers:{Accept:'application/x-ndjson','Content-Type':'application/json'},body:JSON.stringify({url:'https://example.ru',consent:false})};
  const denied = await fetch(base + '/api/audit', options);
  assert.equal(denied.status, 400);
  assert.match(denied.headers.get('content-type'), /application\/json/);
  assert.equal(pageRequests, 0);
  const crossSite = await fetch(base + '/api/audit', {...options,headers:{...options.headers,Origin:'https://attacker.example'},body:JSON.stringify({url:'https://example.ru',consent:true})});
  assert.equal(crossSite.status, 403);
  assert.equal(pageRequests, 0);
  const invalid = await fetch(base + '/api/audit?url=', {headers:{Accept:'application/x-ndjson'}});
  assert.equal(invalid.status, 400);
});

test('Default JSON clients still receive the original report response', async () => {
  const response = await fetch(base + '/api/audit?url=https://example.ru');
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.ok((await response.json()).reportToken);
});

test('Resource counts include nested discovery and finish only after each request settles', async () => {
  const progress = [];
  const resources = await collectResources({finalUrl:'https://example.ru',text:'<a href="/contacts">Контакты</a>'}, async url => {
    if (url.endsWith('/privacy')) throw new Error('Offline');
    return {ok:true,status:200,contentType:'text/html',finalUrl:url,text:'<h1>Контакты</h1><a href="/privacy">Политика конфиденциальности</a>'};
  }, event => progress.push(event));
  assert.equal(resources.length, 2);
  assert.deepEqual(progress[0], {completed:0,total:1});
  assert.ok(progress.some(event=>event.completed===1 && event.total===2));
  assert.deepEqual(progress.at(-1), {completed:2,total:2});
  assert.equal(resources[1].ok, false);
});
