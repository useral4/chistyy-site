const {test,after} = require('node:test');
const assert = require('node:assert/strict');
const pg=require('pg'),original=pg.Pool;
const calls=[];
let clientId=0;
class FakePool {
  on() {}
  async query(sql,values){calls.push({connection:'pool',sql,values});return {rows:[]};}
  async connect(){const connection=++clientId;return {query:async(sql,values)=>{calls.push({connection,sql,values});return {rows:sql.startsWith('SELECT payload')?[{payload:{paid:true}}]:[]};},release(){calls.push({connection,sql:'release'});}};}
  async end(){}
}
pg.Pool=FakePool;
process.env.DATABASE_URL='postgres://example.invalid/kinava_test';
const storage=require('../lib/storage');
after(async()=>{await storage.close();pg.Pool=original;delete process.env.DATABASE_URL;});

test('Database package and report writes share one transaction and acquire database locks',async()=>{
  calls.length=0;
  const value=await storage.lock('pass','a'.repeat(48),async()=>{
    await storage.write('pass','a'.repeat(48),{domains:['example.ru']});
    return storage.lock('report','b'.repeat(48),async()=>{
      await storage.write('report','b'.repeat(48),{paid:true});
      return storage.read('report','b'.repeat(48));
    });
  });
  assert.deepEqual(value,{paid:true});
  const queries=calls.filter(call=>call.connection!=='pool');
  assert.equal(new Set(queries.map(call=>call.connection)).size,1);
  assert.equal(queries.filter(call=>call.sql==='BEGIN').length,1);
  assert.equal(queries.filter(call=>call.sql==='COMMIT').length,1);
  assert.equal(queries.filter(call=>call.sql.includes('pg_advisory_xact_lock')).length,2);
  assert.equal(queries.filter(call=>call.sql.startsWith('INSERT')).length,2);
});

test('A failed quota/report operation rolls back and releases the connection',async()=>{
  calls.length=0;
  await assert.rejects(storage.lock('pass','a'.repeat(48),async()=>{
    await storage.write('pass','a'.repeat(48),{domains:['example.ru']});
    throw new Error('Saving failed');
  }),/Saving failed/);
  assert.ok(calls.some(call=>call.sql==='ROLLBACK'));
  assert.ok(!calls.some(call=>call.sql==='COMMIT'));
  assert.equal(calls.at(-1).sql,'release');
});

test('Parameterized database writes do not concatenate tokens or payloads into SQL',async()=>{
  calls.length=0;
  await storage.write('report','c'.repeat(48),{text:"'; DROP TABLE kinava_records; --"});
  const write=calls.find(call=>call.sql.startsWith('INSERT'));
  assert.equal(write.values[1],'c'.repeat(48));
  assert.match(write.values[2],/DROP TABLE/);
  assert.doesNotMatch(write.sql,/DROP TABLE|cccc/);
});
