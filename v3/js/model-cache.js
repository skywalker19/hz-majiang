export const LOCAL_MODEL_CACHE_KEY = 'hz-majiang-v3-qwen3-0.6b-q4f16-v1';
export const LOCAL_MODEL_FILES = [
  { file: 'config.json', size: 912 },
  { file: 'generation_config.json', size: 219 },
  { file: 'tokenizer.json', size: 9117040 },
  { file: 'tokenizer_config.json', size: 10369 },
  { file: 'chat_template.jinja', size: 4116 },
  { file: 'onnx/model_q4f16.onnx', size: 569789750 },
];

// WebKit's Cache.put collects even a streamed response into one contiguous
// buffer. Use OPFS writable files where available so saving model weights does
// not require a second complete 570 MB allocation before inference.
async function openLocalModelCache(scope, baseUrl, files) {
  let directory;
  if (scope.navigator?.storage?.getDirectory) {
    const root = await scope.navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle(`${LOCAL_MODEL_CACHE_KEY}-files`, { create: true });
    directory = await parent.getDirectoryHandle(encodeURIComponent(baseUrl), { create: true });
    // Check actual writable storage before starting a large download.
    const probeName = `write-check-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const probe = await directory.getFileHandle(probeName, { create: true });
    try {
      if (typeof probe.createWritable !== 'function') directory = undefined;
      else {
        const writer = await probe.createWritable();
        try { await writer.write(new Uint8Array([1])); await writer.close(); }
        catch (error) { await writer.abort().catch(() => {}); throw error; }
      }
    } finally {
      await parent.getDirectoryHandle(encodeURIComponent(baseUrl)).then((dir) => dir.removeEntry(probeName)).catch(() => {});
    }
  }
  let legacy;
  try { legacy = await scope.caches?.open?.(LOCAL_MODEL_CACHE_KEY); }
  catch (error) { if (!directory) throw error; }
  if (!directory && !legacy) throw new Error('浏览器无法保存模型，请使用系统浏览器或文字输入。');
  const entries = new Map(files.map((entry) => [new URL(entry.file, baseUrl).href, entry]));
  const keyFor = (request) => new URL(typeof request === 'string' ? request : request.url, baseUrl).href;
  return {
    backend: directory ? 'opfs' : 'cache-storage',
    async match(request) {
      const key = keyFor(request);
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (directory) {
        try {
          const handle = await directory.getFileHandle(encodeURIComponent(entry.file));
          const file = await handle.getFile();
          if (file.size === entry.size) return new Response(file, { headers: {
            'content-length': String(file.size), 'content-type': 'application/octet-stream',
          } });
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
      // Reuse complete files saved by an older page without copying them.
      let cached;
      try { cached = await legacy?.match(key); }
      catch (error) { if (!directory) throw error; }
      if (cached && Number(cached.headers.get('content-length')) === entry.size
        && !cached.headers.get('content-type')?.includes('text/html')) return cached;
      return undefined;
    },
    async delete(request) {
      const key = keyFor(request);
      const entry = entries.get(key);
      if (!entry) return;
      if (directory) {
        try { await directory.removeEntry(encodeURIComponent(entry.file)); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
      try { await legacy?.delete(key); }
      catch (error) { if (!directory) throw error; }
    },
    async put(request, response) {
      const key = keyFor(request);
      const entry = entries.get(key);
      if (!entry) throw new Error('尝试保存未声明的模型文件。');
      if (!directory) return legacy.put(key, response);
      const handle = await directory.getFileHandle(encodeURIComponent(entry.file), { create: true });
      const writer = await handle.createWritable();
      const reader = response.body.getReader();
      let loaded = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.byteLength;
          if (loaded > entry.size) throw new Error(`模型文件大小不正确：${entry.file}`);
          await writer.write(value);
        }
        if (loaded !== entry.size) throw new Error(`模型文件不完整：${entry.file}`);
        // Atomic close commits the file; unfinished writes are never reused.
        await writer.close();
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        await writer.abort().catch(() => {});
        throw error;
      } finally { reader.releaseLock(); }
    },
  };
}

export async function prepareLocalModelFiles({ scope = window, baseUrl, onStatus = () => {}, files = LOCAL_MODEL_FILES }) {
  const cache = await openLocalModelCache(scope, baseUrl, files);
  onStatus({ state: 'loading', phase: 'cache', storageBackend: cache.backend, message: '检查模型缓存…' });
  let downloaded = false;
  for (const { file, size } of files) {
    const url = new URL(file, baseUrl).href;
    onStatus({ state: 'loading', phase: 'cache', file, message: '检查模型缓存…' });
    const cached = await cache.match(url);
    if (cached && Number(cached.headers.get('content-length')) === size
      && !cached.headers.get('content-type')?.includes('text/html')) continue;
    await cache.delete(url);
    onStatus({ state: 'loading', phase: 'downloading', file, message: '下载模型文件…' });
    const response = await scope.fetch(url, { credentials: 'same-origin' });
    if (response.status !== 200 || response.headers.get('content-type')?.includes('text/html')) {
      throw new Error(`模型文件不可用：${file}（${response.status}）`);
    }
    if (!response.body?.getReader) throw new Error('当前浏览器不支持模型流式保存。');
    const reader = response.body.getReader();
    let loaded = 0;
    let lastPercent = -1;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (loaded !== size) throw new Error(`模型文件不完整：${file}`);
            onStatus({ state: 'loading', phase: 'saving', message: '保存模型文件…' });
            controller.close();
            return;
          }
          loaded += value.byteLength;
          if (loaded > size) throw new Error(`模型文件大小不正确：${file}`);
          const percent = Math.min(99, Math.floor(loaded / size * 100));
          if (percent !== lastPercent) {
            lastPercent = percent;
            onStatus({ state: 'loading', phase: 'downloading', message: `下载模型 ${percent}%…` });
          }
          controller.enqueue(value);
        } catch (error) {
          const failure = new Error(error.message || String(error));
          failure.name = error.name || 'Error';
          failure.phase = 'downloading';
          controller.error(failure);
        }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    const headers = new Headers(response.headers);
    headers.delete('content-encoding'); // fetch has already decoded the body.
    headers.set('content-length', String(size));
    try {
      await cache.put(url, new Response(stream, { headers }));
      const saved = await cache.match(url);
      if (!saved || Number(saved.headers.get('content-length')) !== size) {
        throw new Error('模型未能保存到浏览器。');
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      await cache.delete(url).catch(() => {});
      const failure = new Error(error.name === 'QuotaExceededError' ? '浏览器存储空间不足，模型未保存。' : error.message);
      failure.name = error.name || 'Error';
      failure.phase = error.phase || 'saving';
      throw failure;
    }
    downloaded = true;
  }
  onStatus({ state: 'loading', phase: 'cached', message: downloaded ? '模型文件已保存' : '使用已缓存模型' });
  return cache;
}
