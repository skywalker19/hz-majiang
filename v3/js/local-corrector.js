import { LOCAL_MODEL_CACHE_KEY, prepareLocalModelFiles } from './model-cache.js';

const TRANSFORMERS_MODULE = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
const MODEL_INITIALIZATION_KEY = 'hz-majiang-v3-corrector-initializing';
const LOCAL_CORRECTOR_BUILD = '2026-10-17.6';

export async function detectLocalInferenceDevice(scope = window) {
  const gpu = scope.navigator?.gpu;
  if (!gpu?.requestAdapter) {
    const navigator = scope.navigator;
    const appleMobile = /iPhone|iPad|iPod/.test(navigator?.userAgent || '')
      || (navigator?.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (appleMobile) throw new Error('Safari 未提供可用 WebGPU，当前纠错模型无法启动；仍可输入文字。');
    return { device: 'wasm', adapter: null };
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('未能取得 WebGPU 设备，模型尚未开始下载。');
  if (!adapter.features?.has('shader-f16')) throw new Error('当前 GPU 不支持此模型所需的 FP16，模型尚未开始下载。');
  return { device: 'webgpu', adapter };
}

export function configureLocalModelSource(env, scope = window) {
  const configured = scope.document?.querySelector('meta[name="mahjong-model-base"]')?.content || './models/';
  const base = new URL(configured, scope.location.href);
  if (base.origin !== scope.location.origin || !base.pathname.endsWith('/') || base.search || base.hash) {
    throw new Error('模型下载地址须为本站目录，并以 / 结尾。');
  }
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = base.href;
  // Cache lookups also use the same-origin URL; never fall back to Hugging Face.
  env.remoteHost = base.href;
  env.remotePathTemplate = '{model}/';
}

// Keep model initialization lazy so opening the page does not block normal scorekeeping.
// Opening the voice drawer warms the model; speech commands wait until it is ready.
export function createLocalCorrector({ scope = window, onStatus = () => {}, loadRuntime = () => import(TRANSFORMERS_MODULE) } = {}) {
  let pipelinePromise = null;
  let generator = null;
  let state = 'idle';
  let correctionQueue = Promise.resolve();
  let lastError = null;
  let initializationActive = false;
  let savedCheckpoint = '';
  const diagnostics = {
    build: LOCAL_CORRECTOR_BUILD, stage: 'idle', device: null,
    browser: scope.navigator?.userAgent || 'unknown',
    gpuApi: Boolean(scope.navigator?.gpu?.requestAdapter), modelCached: null,
  };

  function report(status) {
    if (status.phase) diagnostics.stage = status.phase;
    if (status.file) diagnostics.file = status.file;
    if (status.storageBackend) diagnostics.storageBackend = status.storageBackend;
    const checkpoint = `${diagnostics.stage}:${diagnostics.file || ''}:${status.runtimeStatus || ''}`;
    if (initializationActive && checkpoint !== savedCheckpoint) {
      try {
        const { previousAttempt, ...current } = diagnostics;
        scope.localStorage?.setItem(MODEL_INITIALIZATION_KEY, JSON.stringify({
          ...current, runtimeStatus: status.runtimeStatus || null, recordedAt: new Date().toISOString(),
        }));
        savedCheckpoint = checkpoint;
      } catch { /* diagnostics must not prevent initialization */ }
    }
    onStatus(status);
  }
  try {
    const savedAttempt = scope.localStorage?.getItem(MODEL_INITIALIZATION_KEY);
    if (savedAttempt) {
      state = 'interrupted';
      diagnostics.stage = 'interrupted';
      try {
        const previous = JSON.parse(savedAttempt);
        if (previous && typeof previous === 'object') diagnostics.previousAttempt = previous;
      } catch { /* earlier versions stored only the string 'initializing' */ }
    }
  } catch { /* storage may be disabled */ }

  function markInitialization(active) {
    initializationActive = active;
    savedCheckpoint = '';
    try {
      if (active) scope.localStorage?.setItem(MODEL_INITIALIZATION_KEY, 'initializing');
      else scope.localStorage?.removeItem(MODEL_INITIALIZATION_KEY);
    } catch { /* cache storage can still work when localStorage is disabled */ }
  }

  async function load({ retry = false } = {}) {
    if (generator) return generator;
    if (pipelinePromise) return pipelinePromise;
    if (retry && state === 'error' && ['initializing', 'runtime'].includes(diagnostics.stage)) {
      // Transformers.js 4.3 memoizes rejected ORT initialization promises. A
      // new pipeline in this module context does not reset that runtime.
      const message = '推理环境已出错，请刷新页面后重试。';
      report({ state, phase: diagnostics.stage, message });
      throw new Error(message);
    }
    if (!retry && (state === 'interrupted' || state === 'error')) {
      const previous = diagnostics.previousAttempt;
      const message = state === 'interrupted'
        ? previous ? `上次初始化未完成，请展开详情查看记录（${previous.stage || '未知阶段'}）。` : '上次初始化中断，请手动重试本地纠错。'
        : lastError.message;
      onStatus({ state, message });
      throw new Error(message);
    }
    markInitialization(false);
    state = 'loading';
    report({ state, phase: 'checking', message: '检查本地纠错设备…' });
    pipelinePromise = (async () => {
      const modelSource = {};
      configureLocalModelSource(modelSource, scope);
      const selected = await detectLocalInferenceDevice(scope);
      diagnostics.device = selected.device;
      diagnostics.shaderF16 = selected.adapter?.features.has('shader-f16') ?? false;
      diagnostics.gpuLimits = selected.adapter ? {
        maxBufferSize: selected.adapter.limits?.maxBufferSize,
        maxStorageBufferBindingSize: selected.adapter.limits?.maxStorageBufferBindingSize,
      } : null;
      try { await scope.navigator?.storage?.persist?.(); } catch { /* browser may decline persistent storage */ }
      try { diagnostics.storage = await scope.navigator?.storage?.estimate?.(); } catch { /* diagnostics only */ }
      report({ state: 'loading', phase: 'cache', message: '检查模型缓存…' });
      diagnostics.modelCached = false;
      const modelCache = await prepareLocalModelFiles({ scope, baseUrl: new URL(`${MODEL_ID}/`, modelSource.localModelPath).href, onStatus: report });
      diagnostics.modelCached = true;
      markInitialization(true);
      report({ state: 'loading', phase: 'runtime', message: '加载纠错组件…' });
      const { pipeline, env } = await loadRuntime();
      Object.assign(env, modelSource);
      env.useBrowserCache = false;
      env.useCustomCache = true;
      env.customCache = modelCache;
      env.cacheKey = LOCAL_MODEL_CACHE_KEY;
      diagnostics.runtime = env.version || 'unknown';
      diagnostics.onnx = env.backends?.onnx?.versions || null;
      if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
      if (selected.adapter && env.backends?.onnx?.webgpu) env.backends.onnx.webgpu.adapter = selected.adapter;
      const progress_callback = (event) => {
        if (event.status === 'progress' && Number.isFinite(event.progress)) {
          report({ state: 'loading', phase: 'initializing', file: event.file, runtimeStatus: event.status, message: `加载缓存 ${Math.round(event.progress)}%…` });
        } else {
          report({ state: 'loading', phase: 'initializing', file: event.file, runtimeStatus: event.status, message: '初始化纠错模型…' });
        }
      };
      // Do not load a second backend after a WebGPU failure: partially allocated
      // sessions may still hold memory, so the automatic WASM retry can kill a tab.
      report({ state: 'loading', phase: 'initializing', message: '初始化纠错模型…' });
      return pipeline('text-generation', MODEL_ID, {
        device: selected.device, dtype: 'q4f16', progress_callback,
      });
    })().then((value) => {
      generator = value;
      state = 'ready';
      report({ state, phase: 'ready', message: '本地纠错模型已就绪' });
      return generator;
    }).catch((error) => {
      state = 'error';
      const phase = error?.phase || diagnostics.stage;
      const rawMessage = error?.message || String(error);
      diagnostics.stage = phase;
      diagnostics.error = { name: error?.name || 'Error', message: rawMessage };
      const labels = { checking: '设备检查失败', cache: '模型缓存检查失败', downloading: '模型下载失败', saving: '模型保存失败', cached: '模型缓存失败', runtime: '纠错组件加载失败', initializing: '推理初始化失败' };
      const file = diagnostics.file?.split('/').at(-1);
      const storage = diagnostics.storageBackend === 'opfs' ? '文件存储' : '浏览器缓存';
      const context = ['saving', 'downloading'].includes(phase) && file ? `（${file}，${storage}）` : '';
      lastError = new Error(`${labels[phase] || '本地纠错启动失败'}：${rawMessage}${context}`);
      pipelinePromise = null;
      report({ state, phase, message: lastError.message });
      throw lastError;
    }).finally(() => { markInitialization(false); });
    return pipelinePromise;
  }

  function parseCorrection(output, original) {
    const generated = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
    let candidate = '';
    if (Array.isArray(generated)) candidate = generated.at(-1)?.content ?? '';
    else if (typeof generated === 'string') candidate = generated;
    candidate = String(candidate).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { candidate = JSON.parse(candidate.slice(start, end + 1)).correctedText ?? ''; }
      catch { candidate = ''; }
    }
    candidate = String(candidate).trim().replace(/^['"“”「」]+|['"“”「」]+$/g, '');
    if (!candidate || candidate.length > 160 || /[\r\n]/.test(candidate)) return original;
    // A text corrector may fix homophones but must not add/remove numbers or negation.
    const numbers = (text) => text.match(/\d+|[零〇一二两三四五六七八九十]+/g) ?? [];
    if (JSON.stringify(numbers(candidate)) !== JSON.stringify(numbers(original))) return original;
    const negations = (text) => text.match(/不要|先别|不是|不算|不胡|不确认|不记账|没有|没承包|不承包|无承包|取消|重来|算了/g) ?? [];
    if (JSON.stringify(negations(candidate)) !== JSON.stringify(negations(original))) return original;
    return candidate;
  }

  async function runCorrection(text, context = {}) {
    const original = String(text ?? '').normalize('NFKC').trim().slice(0, 160);
    if (!original) throw new Error('没有可纠正的识别文字。');
    const model = await load();
    const contextText = JSON.stringify({
      players: (context.players ?? []).map(({ id, name, seat }) => ({ id, name, seat })),
      enabledWinTypes: context.enabledWinTypes ?? [],
      stage: context.stage ?? '牌局口令',
    });
    onStatus({ state: 'correcting', message: '正在本机纠正识别文字…' });
    const output = await model([
      { role: 'system', content: '你是麻将语音识别的文字纠错器。只纠正明显的中文同音错字，不解释、不回答、不执行口令。优先保留原文；只能使用输入中已有的信息，绝不补玩家、骰子点数、胡法、承包关系或确认指令。昵称和数字必须原样保留。输出严格 JSON：{"correctedText":"纠正后的整句"}。若无法确定，correctedText 必须与原句完全一致。' },
      { role: 'user', content: `牌局上下文：${contextText}\n识别原文：${original}` },
    ], { max_new_tokens: 96, do_sample: false, temperature: 0 });
    const correctedText = parseCorrection(output, original);
    state = 'ready';
    onStatus({ state, message: '本地纠错完成' });
    return { original, correctedText, changed: correctedText !== original };
  }

  function correct(text, context = {}) {
    const task = correctionQueue.then(() => runCorrection(text, context));
    correctionQueue = task.catch(() => {});
    return task;
  }

  return {
    correct,
    warmup: load,
    get state() { return state; },
    get ready() { return state === 'ready'; },
    get diagnostics() { return JSON.parse(JSON.stringify(diagnostics)); },
  };
}
