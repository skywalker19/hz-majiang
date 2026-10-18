import test from 'node:test';
import assert from 'node:assert/strict';
import { configureLocalModelSource, createLocalCorrector, detectLocalInferenceDevice } from '../js/local-corrector.js';
import { LOCAL_MODEL_FILES } from '../js/model-cache.js';

function browser(href, configured) {
  return {
    location: new URL(href),
    document: { querySelector: () => configured === undefined ? null : { content: configured } },
  };
}

test('model files use the page directory on both folder and index URLs', () => {
  for (const href of ['https://example.test/majiang/', 'https://example.test/majiang/index.html']) {
    const env = {};
    configureLocalModelSource(env, browser(href));
    assert.equal(env.localModelPath, 'https://example.test/majiang/models/');
    assert.equal(env.remoteHost, env.localModelPath);
    assert.equal(env.allowLocalModels, true);
    assert.equal(env.allowRemoteModels, false, 'missing files must not fall back to Hugging Face');
  }
});

test('supports an explicit same-origin download location', () => {
  const env = {};
  configureLocalModelSource(env, browser('https://example.test/majiang/', '/downloads/qwen/'));
  assert.equal(env.localModelPath, 'https://example.test/downloads/qwen/');
});

test('rejects insecure off-origin and malformed model directories', () => {
  for (const configured of ['http://150.example/models/', 'https://other.test/models/', './models', './models/?v=1', './models/#v1']) {
    assert.throws(() => configureLocalModelSource({}, browser('https://example.test/majiang/', configured)), /本站目录/);
  }
});

function correctorFixture(pipeline) {
  const storage = new Map();
  const statuses = [];
  const requests = [];
  let imports = 0;
  const env = { backends: { onnx: { wasm: { numThreads: 4 }, webgpu: {} } } };
  const base = 'https://example.test/majiang/models/onnx-community/Qwen3-0.6B-ONNX/';
  // Files have already been persisted; the pipeline is injected so no real
  // model buffers or GPU sessions are allocated by these lifecycle tests.
  const entries = new Map(LOCAL_MODEL_FILES.map(({ file, size }) => [new URL(file, base).href,
    new Response(null, { headers: { 'content-length': String(size) } })]));
  const cache = { match: async (url) => entries.get(url)?.clone(), delete: async (url) => entries.delete(url) };
  const scope = {
    ...browser('https://example.test/majiang/'),
    navigator: { gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']), limits: {} }) }, storage: { persist: async () => true } },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    caches: { open: async () => cache },
    fetch: async (url) => { requests.push(url); throw new Error('Unexpected download'); },
  };
  const options = { scope, onStatus: (event) => statuses.push(event), loadRuntime: async () => { imports++; return { env, pipeline }; } };
  return { options, statuses, requests, storage, env, cache, get imports() { return imports; } };
}

test('reading a saved model is labelled as cache loading, and reopening does not download or recreate it', async () => {
  let calls = 0;
  const generator = async () => [];
  const f = correctorFixture(async (_task, _model, options) => {
    calls++;
    options.progress_callback({ status: 'progress', progress: 100 });
    return generator;
  });
  const corrector = createLocalCorrector(f.options);
  await Promise.all([corrector.warmup(), corrector.warmup()]);
  await corrector.warmup();
  assert.equal(calls, 1);
  assert.deepEqual(f.requests, []);
  assert.ok(f.statuses.some(({ message }) => message === '加载缓存 100%…'));
  assert.ok(f.statuses.every(({ message }) => !message.includes('下载模型')));
  assert.equal(f.storage.size, 0, 'successful initialization must clear its recovery marker');
});

test('a reload during initialization stops automatic reinitialization on the next page', async () => {
  let finish;
  let started;
  const initializationStarted = new Promise((resolve) => { started = resolve; });
  const initialization = new Promise((resolve) => { finish = resolve; });
  const f = correctorFixture(() => { started(); return initialization; });
  const firstPage = createLocalCorrector(f.options);
  const firstLoad = firstPage.warmup();
  await initializationStarted;
  assert.equal(f.storage.size, 1);
  const secondPage = createLocalCorrector(f.options);
  await assert.rejects(secondPage.warmup(), /上次初始化中断/);
  assert.equal(secondPage.state, 'interrupted');
  assert.equal(f.imports, 1, 'the second page must not start another heavy initialization');
  assert.deepEqual(f.requests, []);
  finish(async () => []);
  await firstLoad;
});

test('a failed WebGPU initialization does not allocate WASM too or automatically retry on reopen', async () => {
  const devices = [];
  const f = correctorFixture(async (_task, _model, { device }) => {
    devices.push(device);
    if (devices.length === 1) throw new Error('GPU allocation failed');
    return async () => [];
  });
  const corrector = createLocalCorrector(f.options);
  await assert.rejects(corrector.warmup(), /GPU allocation failed/);
  await assert.rejects(corrector.warmup(), /GPU allocation failed/);
  assert.deepEqual(devices, ['webgpu']);
  assert.equal(f.storage.size, 0, 'a caught error must clear the recovery marker');
  await assert.rejects(corrector.warmup({ retry: true }), /刷新页面后重试/);
  assert.deepEqual(devices, ['webgpu'], 'a poisoned runtime must not be reused for the manual retry');
  const freshPage = createLocalCorrector(f.options);
  await freshPage.warmup();
  assert.deepEqual(devices, ['webgpu', 'webgpu']);
  assert.equal(freshPage.ready, true);
  assert.deepEqual(f.requests, []);
  assert.equal(f.env.backends.onnx.wasm.numThreads, 1);
});

test('device detection checks the actual WebGPU adapter and FP16 support', async () => {
  await assert.rejects(detectLocalInferenceDevice({ navigator: { gpu: { requestAdapter: async () => null } } }), /未能取得 WebGPU/);
  await assert.rejects(detectLocalInferenceDevice({ navigator: { gpu: { requestAdapter: async () => ({ features: new Set() }) } } }), /FP16/);
  await assert.rejects(detectLocalInferenceDevice({ navigator: { userAgent: 'iPhone Safari', gpu: undefined } }), /Safari 未提供/);
  assert.equal((await detectLocalInferenceDevice({ navigator: {} })).device, 'wasm');
});

test('an unsupported phone stops before any model download or runtime load', async () => {
  const f = correctorFixture(async () => {});
  f.options.scope.navigator.gpu.requestAdapter = async () => null;
  const corrector = createLocalCorrector(f.options);
  await assert.rejects(corrector.warmup(), /设备检查失败/);
  assert.equal(f.imports, 0);
  assert.deepEqual(f.requests, []);
  assert.equal(corrector.diagnostics.stage, 'checking');
});

test('the same internal error is identified by its failing stage instead of assuming an inference error', async () => {
  const inference = correctorFixture(async () => { throw new Error('Internal error'); });
  const inferenceCorrector = createLocalCorrector(inference.options);
  await assert.rejects(inferenceCorrector.warmup(), /推理初始化失败：Internal error/);
  assert.equal(inferenceCorrector.diagnostics.modelCached, true);
  assert.equal(inferenceCorrector.diagnostics.device, 'webgpu');

  const saving = correctorFixture(async () => {});
  saving.cache.match = async () => undefined;
  saving.cache.put = async () => { throw Object.assign(new Error('Internal error'), { name: 'UnknownError' }); };
  saving.options.scope.fetch = async () => new Response('x'.repeat(912));
  const savingCorrector = createLocalCorrector(saving.options);
  await assert.rejects(savingCorrector.warmup(), /模型保存失败：Internal error/);
  assert.equal(saving.imports, 0, 'inference has not started when cache storage fails');
  assert.equal(savingCorrector.diagnostics.modelCached, false);
  assert.equal(savingCorrector.diagnostics.error.name, 'UnknownError');
});
