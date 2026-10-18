// Capture one utterance locally; send only a bounded, mono PCM WAV to our server.
export function getSenseVoiceCapabilities(scope = window) {
  const hosted = scope.location?.protocol !== 'file:';
  const secure = scope.isSecureContext !== false;
  const capture = Boolean(scope.navigator?.mediaDevices?.getUserMedia
    && (scope.AudioContext ?? scope.webkitAudioContext) && scope.fetch);
  return {
    recognition: hosted && secure && capture,
    synthesis: Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance),
    reason: !hosted ? '直接打开文件时可用文字口令；收音请通过 HTTPS 或 localhost 网页使用。'
      : !secure ? '麦克风需要 HTTPS 或 localhost；当前仍可输入文字口令。'
        : !capture ? '当前浏览器无法录音，请在手机系统浏览器中打开，或输入文字口令。' : '',
  };
}

export function encodeVoiceWav(chunks, sourceRate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const input = new Float32Array(length);
  let position = 0;
  for (const chunk of chunks) { input.set(chunk, position); position += chunk.length; }
  const rate = 16000;
  const frames = Math.floor(length * rate / sourceRate);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const label = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, frames * 2, true);
  // Average source samples over each output interval, including fractional edges.
  const ratio = sourceRate / rate;
  for (let frame = 0; frame < frames; frame += 1) {
    const begin = frame * ratio;
    const end = Math.min(length, (frame + 1) * ratio);
    let sum = 0;
    for (let index = Math.floor(begin); index < end; index += 1) {
      sum += input[index] * (Math.min(index + 1, end) - Math.max(index, begin));
    }
    const sample = Math.max(-1, Math.min(1, sum / (end - begin)));
    view.setInt16(44 + frame * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export function createSenseVoiceIO({ onTranscript, onStatus = () => {}, onLevel = () => {},
  getContext = () => '', apiBase = './api/', scope = window }) {
  const capabilities = getSenseVoiceCapabilities(scope);
  const later = (fn, delay) => scope.setTimeout(fn, delay);
  const clear = (timer) => scope.clearTimeout(timer);
  let session = null;
  let speaking = false;
  let utterance = null;
  let speechTimer;
  let speechToken = 0;
  const report = (state, message) => onStatus({ state, message, active: Boolean(session), speaking });

  function endpoint(path) {
    const base = new URL(apiBase, scope.location.href);
    if (base.origin !== scope.location.origin || !base.pathname.endsWith('/')) {
      throw new Error('语音服务地址需要使用本站目录，并以斜杠结尾。');
    }
    return new URL(path, base).href;
  }

  function releaseMicrophone(current) {
    clear(current.captureTimer);
    if (current.processor) { current.processor.onaudioprocess = null; current.processor.disconnect(); }
    current.source?.disconnect();
    current.gain?.disconnect();
    current.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    if (current.audio && current.audio.state !== 'closed') current.audio.close().catch(() => {});
    onLevel(0);
  }

  function cancelInput() {
    const current = session;
    session = null;
    if (!current) return;
    clear(current.requestTimer);
    current.controller?.abort();
    releaseMicrophone(current);
    current.chunks = [];
  }

  function cancelSpeech() {
    speechToken += 1;
    clear(speechTimer);
    if (speaking) scope.speechSynthesis?.cancel();
    speaking = false;
    utterance = null;
  }

  function stop() {
    cancelInput();
    cancelSpeech();
    report('idle', '已停止收音；需要时点“说一句”');
  }

  function fail(current, message) {
    if (session !== current) return;
    cancelInput();
    report('error', message);
  }

  async function finish() {
    const current = session;
    if (!current || current.processing) return;
    if (!current.started || current.voiced < current.audio.sampleRate * 0.18) {
      fail(current, '没听到完整口令，请靠近手机，再点“说一句”。'); return;
    }
    current.processing = true;
    releaseMicrophone(current);
    report('processing', '正在识别这句话…可以取消，或稍等结果');
    current.controller = new scope.AbortController();
    current.requestTimer = later(() => {
      current.timedOut = true;
      current.controller.abort();
    }, 45000);
    try {
      const body = encodeVoiceWav(current.chunks, current.audio.sampleRate);
      current.chunks = [];
      const response = await scope.fetch(endpoint('transcribe'), {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body,
        credentials: 'same-origin', cache: 'no-store', signal: current.controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (session !== current) return;
      if (!response.ok) {
        const fallback = response.status === 429 ? '语音服务正在处理另一句话，请稍后再试。'
          : response.status === 404 || response.status === 502 ? '语音服务尚未连接，请检查服务部署；仍可用文字和按钮。'
            : '语音识别暂时不可用，请重试或输入文字口令。';
        fail(current, typeof data.detail === 'string' ? data.detail : fallback); return;
      }
      if (data.engine !== 'sensevoice') {
        fail(current, '语音接口返回的内容不正确，请检查本站语音服务配置；仍可输入文字口令。'); return;
      }
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 160) { fail(current, '这句没有识别清楚，请一次只说一条简短口令。'); return; }
      if (getContext() !== current.context) { fail(current, '牌局或玩家已变化，这句未执行；请按当前牌局重新说。'); return; }
      clear(current.requestTimer);
      session = null;
      report('idle', '识别完成；下一句请再点“说一句”');
      onTranscript(text);
    } catch (error) {
      if (session !== current) return;
      fail(current, current.timedOut ? '识别等待超时，请稍后重试，或输入文字口令。'
        : error.name === 'AbortError' ? '本次识别已取消。'
          : '连接语音服务失败，请检查网络和服务状态；仍可输入文字口令。');
    } finally { clear(current.requestTimer); }
  }

  async function start() {
    if (!capabilities.recognition) { report('error', capabilities.reason); return false; }
    if (session) return false;
    cancelSpeech();
    const current = { context: getContext(), chunks: [], preroll: [], onset: 0, voiced: 0, quiet: 0, samples: 0 };
    session = current;
    report('starting', '正在打开麦克风；首次使用请允许录音');
    try {
      // Resume during the user's click, before waiting for microphone permission (iOS).
      const AudioContext = scope.AudioContext ?? scope.webkitAudioContext;
      current.audio = new AudioContext();
      const resumed = current.audio.resume().catch(() => {});
      const stream = await scope.navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (session !== current) { stream.getTracks().forEach((track) => track.stop()); return false; }
      current.stream = stream;
      await resumed;
      if (session !== current) return false;
      current.source = current.audio.createMediaStreamSource(stream);
      // Small bounded capture, no model or codec download on the phone. ScriptProcessor
      // also works on older Safari; it is only connected while recording one utterance.
      current.processor = current.audio.createScriptProcessor(2048, 1, 1);
      current.gain = current.audio.createGain();
      current.gain.gain.value = 0;
      const rate = current.audio.sampleRate;
      current.processor.onaudioprocess = (event) => {
        if (session !== current || current.processing) return;
        const block = new Float32Array(event.inputBuffer.getChannelData(0));
        const rms = Math.sqrt(block.reduce((sum, value) => sum + value * value, 0) / block.length);
        onLevel(Math.min(1, rms * 12));
        const loud = rms >= 0.015;
        if (!current.started) {
          current.preroll.push(block);
          while (current.preroll.length * block.length > rate * 0.35) current.preroll.shift();
          current.onset = loud ? current.onset + block.length : 0;
          if (current.onset < rate * 0.12) return;
          current.started = true;
          current.chunks = current.preroll;
          current.preroll = [];
          current.samples = current.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          current.voiced = current.onset;
          clear(current.captureTimer);
          current.captureTimer = later(() => fail(current, '这句太长了，请分成简短口令再说。'), 14000);
          report('listening', '听到了，说完停顿约一秒，会自动提交');
          return;
        }
        current.chunks.push(block);
        current.samples += block.length;
        current.quiet = loud ? 0 : current.quiet + block.length;
        if (loud) current.voiced += block.length;
        if (current.samples >= rate * 14) { fail(current, '这句太长了，请分成简短口令再说。'); return; }
        if (current.quiet >= rate * 0.9) void finish();
      };
      stream.getTracks().forEach((track) => { track.onended = () => fail(current, '麦克风连接已中断，请重新点“说一句”。'); });
      current.source.connect(current.processor);
      current.processor.connect(current.gain);
      current.gain.connect(current.audio.destination);
      current.captureTimer = later(() => fail(current, '暂时没听到声音，已停止收音；需要时再点“说一句”。'), 8000);
      report('listening', '正在听，请说一条口令；说完会自动提交');
      return true;
    } catch (error) {
      const messages = {
        NotAllowedError: '麦克风权限未开启，请在浏览器站点设置中允许麦克风。',
        NotFoundError: '没有找到麦克风，请检查设备。',
        NotReadableError: '麦克风暂时无法使用，可能正被其他应用占用。',
      };
      fail(current, messages[error.name] ?? '录音未能开始，请重试，或改用文字口令。');
      return false;
    }
  }

  function speak(text) {
    if (!capabilities.synthesis) return false;
    cancelInput();
    cancelSpeech();
    speaking = true;
    const token = speechToken;
    utterance = new scope.SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    const voices = scope.speechSynthesis.getVoices();
    const voice = voices.find((item) => /^zh[-_]CN$/i.test(item.lang)) ?? voices.find((item) => /^zh/i.test(item.lang));
    if (voice) utterance.voice = voice;
    const done = (failed = false) => {
      if (token !== speechToken || !speaking) return;
      clear(speechTimer);
      speaking = false;
      utterance = null;
      report(failed ? 'error' : 'idle', failed ? '未能播报，回复已显示；可点重听。' : '播报结束；下一句请点“说一句”');
    };
    utterance.onend = () => done();
    utterance.onerror = () => done(true);
    speechTimer = later(() => { scope.speechSynthesis.cancel(); done(true); }, Math.min(45000, Math.max(12000, text.length * 350)));
    report('speaking', '正在播报，麦克风已关闭');
    try { scope.speechSynthesis.speak(utterance); return true; }
    catch { done(true); return false; }
  }

  async function checkService() {
    const controller = new scope.AbortController();
    const timer = later(() => controller.abort(), 5000);
    try {
      const response = await scope.fetch(endpoint('health'), { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (response.ok && data.ready === true && data.engine === 'sensevoice') {
        return { ready: true, message: data.busy ? '语音服务已连接，正在处理请求' : '语音服务已连接 · 普通话' };
      }
      return { ready: false, message: '语音模型尚未就绪；文字和按钮仍可使用' };
    } catch { return { ready: false, message: '语音服务未连接；请部署后端后再试，文字和按钮仍可使用' }; }
    finally { clear(timer); }
  }

  return { capabilities, start, finish, stop, cancelInput, speak, cancelSpeech, checkService,
    get state() { return session?.processing ? 'processing' : session?.processor ? 'listening' : session ? 'starting' : speaking ? 'speaking' : 'idle'; },
    get active() { return Boolean(session); } };
}
