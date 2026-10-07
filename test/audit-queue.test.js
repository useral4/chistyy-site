const {test} = require('node:test');
const assert = require('node:assert/strict');
const {AuditQueue} = require('../lib/audit-queue');

test('Queue runs complete jobs serially, updates real positions and releases only once', async () => {
  const queue = new AuditQueue(), positions=[];
  const first = await queue.acquire();
  let started = false;
  const second = queue.acquire({onPosition:position=>positions.push(position)}).then(release=>{started=true;return release;});
  const third = queue.acquire();
  await Promise.resolve();
  assert.equal(started,false);
  assert.equal(queue.snapshot().waiting,2);
  first();first();
  const releaseSecond=await second;
  assert.equal(queue.snapshot().active,1);
  assert.deepEqual(positions,[1,1]);
  releaseSecond();
  (await third)();
  assert.equal(queue.snapshot().active,0);
});

test('Queue rejects overflow, removes canceled work and updates following positions', async () => {
  const queue=new AuditQueue({maxWaiting:2}), controller=new AbortController(), positions=[];
  const release=await queue.acquire();
  const aborted=queue.acquire({signal:controller.signal});
  const following=queue.acquire({onPosition:position=>positions.push(position)});
  await assert.rejects(queue.acquire(),{code:'QUEUE_FULL'});
  controller.abort();
  await assert.rejects(aborted,{name:'AbortError'});
  assert.deepEqual(positions,[2,1]);
  release();(await following)();
});

test('Queue wait deadline does not consume a slot and shutdown rejects pending work', async () => {
  const queue=new AuditQueue({waitMs:20}), release=await queue.acquire();
  await assert.rejects(queue.acquire(),{code:'QUEUE_TIMEOUT'});
  assert.equal(queue.snapshot().waiting,0);
  const pending=queue.acquire();
  queue.close();
  await assert.rejects(pending,{code:'QUEUE_CLOSED'});
  await assert.rejects(queue.acquire(),{code:'QUEUE_CLOSED'});
  release();assert.equal(queue.snapshot().active,0);
});
