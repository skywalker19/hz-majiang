export function getVoiceCapabilities(scope = window) {
  const recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  const hosted = scope.location?.protocol !== 'file:';
  const secure = scope.isSecureContext !== false;
  return {
    recognition: Boolean(recognition) && secure && hosted,
    synthesis: Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance),
    reason: !hosted ? '直接打开文件时可用文字口令；麦克风请通过 HTTPS 或 localhost 网页使用。'
      : !secure ? '当前是普通 HTTP 页面，麦克风需要 HTTPS 或 localhost；仍可输入口令。'
        : !recognition ? '当前浏览器未提供语音识别，请换支持此功能的浏览器，或输入口令。' : '',
  };
}

export function createVoiceIO({ onTranscript, onStatus = () => {}, scope = window }) {
  const capabilities = getVoiceCapabilities(scope);
  const later = (fn, delay) => scope.setTimeout(fn, delay);
  const cancelTimer = (timer) => scope.clearTimeout(timer);
  let enabled = false;
  let recognition = null;
  let speaking = false;
  let restartTimer;
  let speechTimer;
  let speechToken = 0;
  let emptyCount = 0;
  let utterance = null;
  const report = (state, message) => onStatus({ state, message, active: enabled, speaking });

  function abortRecognition() {
    const current = recognition;
    recognition = null;
    try { current?.abort(); } catch { /* already ended */ }
  }

  function scheduleListen() {
    cancelTimer(restartTimer);
    if (enabled && !speaking && !recognition) restartTimer = later(listen, 350);
  }

  function stop() {
    enabled = false;
    cancelTimer(restartTimer);
    abortRecognition();
    cancelSpeech();
    report('idle', '语音对话已停止');
  }

  function fail(message) {
    stop();
    report('error', message);
  }

  function listen() {
    if (!enabled || speaking || recognition) return;
    const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    const current = new Recognition();
    recognition = current;
    current.lang = 'zh-CN';
    current.continuous = false;
    current.interimResults = true;
    current.maxAlternatives = 1;
    let delivered = false;
    current.onstart = () => { if (recognition === current && enabled) report('listening', '正在听，说完一句稍停一下'); };
    current.onresult = (event) => {
      if (recognition !== current || !enabled || speaking || delivered) return;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim();
        if (!text) continue;
        if (!result.isFinal) { report('listening', `听到：${text}`); continue; }
        delivered = true;
        emptyCount = 0;
        abortRecognition();
        report('processing', '正在理解这句口令');
        onTranscript(text);
        scheduleListen();
        break;
      }
    };
    current.onerror = (event) => {
      if (recognition !== current || !enabled) return;
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      const errors = {
        'not-allowed': '麦克风权限未开启。请在浏览器站点设置中允许麦克风，再点开始对话。',
        'service-not-allowed': '浏览器不允许语音识别服务，请检查权限或改用文字口令。',
        'audio-capture': '没有可用的麦克风，请检查设备连接。',
        'network': '浏览器语音识别服务连接失败，请检查网络，或改用文字口令。',
        'language-not-supported': '当前语音服务不支持普通话，请改用文字口令。',
      };
      fail(errors[event.error] ?? '语音识别未能继续，请重新开始，或输入文字口令。');
    };
    current.onend = () => {
      if (recognition !== current) return;
      recognition = null;
      if (!enabled) return;
      if (!delivered) emptyCount += 1;
      if (emptyCount >= 3) { fail('连续几次没听到声音，已停止收音；需要时点开始对话。'); return; }
      scheduleListen();
    };
    try { report('starting', '正在连接麦克风'); current.start(); }
    catch { fail('麦克风未能启动，请稍后重试，或改用文字口令。'); }
  }

  function start() {
    if (!capabilities.recognition) { report('error', capabilities.reason); return false; }
    if (enabled) return true;
    emptyCount = 0;
    cancelSpeech();
    enabled = true;
    listen();
    return enabled;
  }

  function cancelSpeech() {
    speechToken += 1;
    cancelTimer(speechTimer);
    if (speaking) scope.speechSynthesis?.cancel();
    utterance = null;
    speaking = false;
    scheduleListen();
  }

  function speak(text) {
    if (!capabilities.synthesis) return false;
    cancelSpeech();
    cancelTimer(restartTimer);
    abortRecognition();
    speaking = true;
    const token = speechToken;
    utterance = new scope.SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    const voices = scope.speechSynthesis.getVoices();
    const voice = voices.find((item) => /^zh[-_]CN$/i.test(item.lang)) ?? voices.find((item) => /^zh/i.test(item.lang));
    if (voice) utterance.voice = voice;
    const finish = (failed = false) => {
      if (token !== speechToken || !speaking) return;
      cancelTimer(speechTimer);
      speaking = false;
      utterance = null;
      report(failed ? 'error' : 'idle', failed ? '未能播放声音，结果已显示在对话中，可点重听。' : enabled ? '播报结束，继续听你说' : '播报结束');
      scheduleListen();
    };
    utterance.onend = () => finish();
    utterance.onerror = () => finish(true);
    speechTimer = later(() => { scope.speechSynthesis.cancel(); finish(true); }, Math.min(45000, Math.max(12000, text.length * 350)));
    report('speaking', '正在播报，收音暂时暂停');
    try { scope.speechSynthesis.speak(utterance); }
    catch { finish(true); return false; }
    return true;
  }

  return { capabilities, start, stop, speak, cancelSpeech, get active() { return enabled; } };
}
