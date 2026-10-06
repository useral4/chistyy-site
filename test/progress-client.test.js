const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const progressSource = source.slice(source.indexOf('function resetAuditProgress('), source.indexOf('function showView('));

function client() {
  const attributes = new Map();
  const fill = {style: {}};
  const bar = {querySelector: () => fill, setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key)};
  const count = {}, stage = {};
  const context = vm.createContext({TextDecoder, document: {querySelector: selector => selector === '.loading-progress' ? bar : selector === '[data-progress-count]' ? count : stage}});
  vm.runInContext(progressSource, context);
  return {context, attributes, fill, count, stage};
}
function response(events, chunkSize = 3) {
  const data = new TextEncoder().encode(events);
  return new Response(new ReadableStream({start(controller) {
    for (let i = 0; i < data.length; i += chunkSize) controller.enqueue(data.slice(i, i + chunkSize));
    controller.close();
  }}), {headers: {'Content-Type': 'application/x-ndjson'}});
}

test('Stream reader decodes split JSON and Cyrillic without losing progress or the final report', async () => {
  const ui = client(), updates = [];
  const events = [{type:'progress',completed:2,total:7,message:'Загружаем документы'}, {type:'result',audit:{url:'https://example.test',checks:[]}}];
  const result = await ui.context.readAuditResponse(response(events.map(e=>JSON.stringify(e)).join('\n')), event => updates.push(event));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].message, 'Загружаем документы');
  assert.equal(result.url, 'https://example.test');
});

test('Stream failures and premature disconnects never masquerade as completed reports', async () => {
  const ui = client();
  await assert.rejects(ui.context.readAuditResponse(response('{"type":"error","error":"Не удалось сохранить отчёт"}\n'),()=>{}), /Не удалось сохранить/);
  await assert.rejects(ui.context.readAuditResponse(response('{"type":"progress","completed":4,"total":7}\n'),()=>{}), /Соединение прервалось/);
  await assert.rejects(ui.context.readAuditResponse(response('invalid\n'),()=>{}), /Не удалось прочитать/);
  const aborted = new Response(new ReadableStream({start(stream) { stream.error(new DOMException('Canceled', 'AbortError')); }}), {headers: {'Content-Type':'application/x-ndjson'}});
  await assert.rejects(ui.context.readAuditResponse(aborted,()=>{}), {name:'AbortError'});
});

test('Legacy JSON and validation errors remain compatible', async () => {
  const ui = client();
  assert.equal((await ui.context.readAuditResponse(Response.json({url:'https://example.test'}),()=>{})).url, 'https://example.test');
  await assert.rejects(ui.context.readAuditResponse(Response.json({error:'Нужно согласие'}, {status:400}),()=>{}), /Нужно согласие/);
});

test('Progress fill changes only to server values and resets for the next request', () => {
  const ui = client();
  ui.context.resetAuditProgress();
  assert.equal(ui.fill.style.transform, 'scaleX(0)');
  assert.equal(ui.attributes.has('aria-valuenow'), false);
  ui.context.updateAuditProgress({completed:4,total:7,message:'Браузерная проверка'});
  assert.equal(ui.fill.style.transform, `scaleX(${4/7})`);
  assert.equal(ui.attributes.get('aria-valuenow'), '4');
  assert.equal(ui.count.textContent, 'Выполнено 4 из 7 этапов');
  assert.equal(ui.stage.textContent, 'Браузерная проверка');
  ui.context.updateAuditProgress({completed:9,total:7});
  assert.equal(ui.attributes.get('aria-valuenow'), '4');
  ui.context.updateAuditProgress({completed:7,total:7,message:'Отчёт готов'});
  assert.equal(ui.fill.style.transform, 'scaleX(1)');
  ui.context.resetAuditProgress('Загружаем сохранённый отчёт');
  assert.equal(ui.fill.style.transform, 'scaleX(0)');
  assert.equal(ui.count.textContent, 'Загружаем сохранённый отчёт');
  assert.equal(ui.stage.textContent, '');
});
