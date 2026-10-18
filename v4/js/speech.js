// Output only: use the device's speech engine without recording or inference.
export function createSpeechOutput({ scope = window, onStatus = () => {} } = {}) {
  const supported = Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance);
  const later = scope.setTimeout?.bind(scope) || setTimeout;
  const clear = scope.clearTimeout?.bind(scope) || clearTimeout;
  let generation = 0;
  let timer = null;
  let utterance = null;
  let speaking = false;

  function stop(report = true) {
    generation += 1;
    clear(timer);
    timer = null;
    speaking = false;
    utterance = null;
    try { if (supported) scope.speechSynthesis.cancel(); } catch { /* text remains available */ }
    if (report) onStatus({ state: 'idle', message: '播报已停止' });
  }

  function speak(value) {
    if (!supported) {
      onStatus({ state: 'error', message: '当前浏览器不支持语音播报，请查看文字。' });
      return false;
    }
    const text = String(value ?? '').trim();
    if (!text) return false;
    stop(false);
    const token = generation;
    function finish(failed = false) {
      if (token !== generation || !speaking) return;
      clear(timer);
      timer = null;
      speaking = false;
      utterance = null;
      onStatus({ state: failed ? 'error' : 'idle', message: failed
        ? '未能完成播报，可点“重听”；结果已显示为文字。' : '播报结束' });
    }
    try {
      utterance = new scope.SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1;
      const voices = scope.speechSynthesis.getVoices();
      const voice = voices.find((item) => /^zh[-_]CN$/i.test(item.lang))
        || voices.find((item) => /^zh/i.test(item.lang));
      if (voice) utterance.voice = voice;
      utterance.onend = () => finish();
      utterance.onerror = () => finish(true);
      speaking = true;
      onStatus({ state: 'speaking', message: '正在播报…' });
      timer = later(() => {
        if (token !== generation) return;
        finish(true);
        try { scope.speechSynthesis.cancel(); } catch { /* already ended */ }
      }, Math.min(60000, Math.max(12000, text.length * 400)));
      scope.speechSynthesis.speak(utterance);
      return true;
    } catch {
      speaking = true;
      finish(true);
      return false;
    }
  }

  return { supported, speak, stop, get speaking() { return speaking; } };
}
