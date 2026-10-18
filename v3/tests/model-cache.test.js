import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalModelFiles } from '../js/model-cache.js';

function cacheFixture(content = 'model-data') {
  const entries = new Map();
  const requests = [];
  const events = [];
  const cache = {
    async match(url) { return entries.get(url)?.clone(); },
    async delete(url) { return entries.delete(url); },
    async put(url, response) {
      const data = await response.arrayBuffer();
      entries.set(url, new Response(data, { headers: response.headers }));
    },
  };
  return {
    cache, entries, events, requests,
    scope: {
      caches: { open: async () => cache },
      async fetch(url) { requests.push(url); return new Response(content); },
    },
    options: { baseUrl: 'https://example.test/models/model/', files: [{ file: 'weights.onnx', size: 10 }], onStatus: (event) => events.push(event) },
  };
}

test('commits the model stream before reporting that it is cached and reuses it on the next visit', async () => {
  const f = cacheFixture();
  const url = 'https://example.test/models/model/weights.onnx';
  await prepareLocalModelFiles({ ...f.options, scope: f.scope });
  assert.equal(await (await f.cache.match(url)).text(), 'model-data');
  assert.equal(f.events.at(-1).phase, 'cached');
  const firstDownloadEnd = f.events.length;
  await prepareLocalModelFiles({ ...f.options, scope: f.scope });
  assert.deepEqual(f.requests, [url], 'the second visit must not make another network request');
  assert.ok(f.events.slice(firstDownloadEnd).every(({ phase }) => phase === 'cache' || phase === 'cached'));
});

test('rejects truncated model streams and does not leave a successful cache entry', async () => {
  const f = cacheFixture('short');
  await assert.rejects(prepareLocalModelFiles({ ...f.options, scope: f.scope }), /文件不完整/);
  assert.equal(f.entries.size, 0);
  assert.ok(f.events.every(({ phase }) => phase !== 'cached'));
});

test('reports storage quota errors before inference can be started', async () => {
  const f = cacheFixture();
  f.cache.put = async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); };
  await assert.rejects(prepareLocalModelFiles({ ...f.options, scope: f.scope }), /存储空间不足/);
  assert.equal(f.entries.size, 0);
});

test('keeps Safari internal cache-write errors distinguishable from inference failures', async () => {
  const f = cacheFixture();
  f.cache.put = async () => { throw Object.assign(new Error('Internal error'), { name: 'UnknownError' }); };
  await assert.rejects(prepareLocalModelFiles({ ...f.options, scope: f.scope }), (error) => {
    assert.equal(error.phase, 'saving');
    assert.equal(error.name, 'UnknownError');
    assert.equal(error.message, 'Internal error');
    return true;
  });
});

test('rejects static-site fallback HTML and unavailable Cache Storage', async () => {
  const f = cacheFixture();
  f.scope.fetch = async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(prepareLocalModelFiles({ ...f.options, scope: f.scope }), /文件不可用/);
  await assert.rejects(prepareLocalModelFiles({ ...f.options, scope: {} }), /无法保存模型/);
});
