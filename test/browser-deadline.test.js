const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');
let resolveLaunch;
const original = chromium.launch;
chromium.launch = () => new Promise(resolve=>{resolveLaunch=resolve;});
const {inspectBrowser} = require('../lib/browser-audit');

test('Browser deadline includes launching and closes a browser that starts after cancellation', async()=>{
  const old = process.env.BROWSER_EXECUTABLE_PATH;
  process.env.BROWSER_EXECUTABLE_PATH = '/test/chromium';
  try {
    const result = await inspectBrowser({finalUrl:'https://example.ru/'},[],{timeoutMs:50});
    assert.equal(result.available,false);
    assert.match(result.reason,/превысила лимит времени/);
    let closed=0;
    resolveLaunch({close:async()=>{closed++;}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(closed,1);
    chromium.launch = async()=>{throw new Error('Unavailable');};
    const next = await inspectBrowser({finalUrl:'https://example.ru/'},[]);
    assert.doesNotMatch(next.reason,/занята/);
  } finally {
    chromium.launch = original;
    if (old===undefined) delete process.env.BROWSER_EXECUTABLE_PATH;
    else process.env.BROWSER_EXECUTABLE_PATH=old;
  }
});
