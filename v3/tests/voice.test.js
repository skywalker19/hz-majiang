import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceCommand } from '../js/voice-commands.js';
import { createVoiceIO, getVoiceCapabilities } from '../js/voice.js';
import { createMatch, createStorage, settleRound, STORAGE_KEY } from '../js/state.js';
import { getDealGuide } from '../js/dealing.js';

const match = createMatch({ names: ['阿青', '开心果', '常胜将', '乐开花'], dealerSeat: 'top', baseScore: 1, liabilityEnabled: true });
const context = { players: match.players, dealerId: match.dealerId };

for (const text of ['骰子三和五', '3、5', '骰子 35', '三五', '两颗骰子三点五点', '第一颗骰子三点，第二颗骰子五点', '我摇出了三点和五点', '３和５']) {
  test(`parses two face values: ${text}`, () => assert.deepEqual(parseVoiceCommand(text, context), { kind: 'dice', values: [3, 5] }));
}
for (const text of ['骰子八点', '骰子十三点', '骰子零和五', '骰子七和三', '总点数五点', '骰子三和五和六', '骰子-3和5', '骰子3.5']) {
  test(`asks rather than guessing dice: ${text}`, () => assert.equal(parseVoiceCommand(text, context).kind, 'dicePrompt'));
}
test('supports one die followed by another and pure spoken sums remain explicit', () => {
  assert.deepEqual(parseVoiceCommand('三', context), { kind: 'dicePartial', value: 3 });
  assert.equal(parseVoiceCommand('骰子', context).kind, 'dicePrompt');
});
test('two matching dice are not misread as a face value of two', () => {
  for (const text of ['两个三', '骰子两个三', '两颗骰子都是三点']) {
    assert.deepEqual(parseVoiceCommand(text, context), { kind: 'dice', values: [3, 3] });
  }
});
test('longest win-type alias wins without accidental 七对 duplication', () => {
  const command = parseVoiceCommand('开心果双豪华七对加清一色', context);
  assert.equal(command.winnerId, 'player-right');
  assert.deepEqual(new Set(command.winTypeIds), new Set(['doubleLuxuryPairs', 'pureSuit']));
});
test('parses nickname, relative seat and absolute seat', () => {
  assert.equal(parseVoiceCommand('下方平胡', context).winnerId, 'player-bottom');
  assert.equal(parseVoiceCommand('庄家七对', context).winnerId, match.dealerId);
  assert.equal(parseVoiceCommand('下家平胡', context).winnerId, 'player-left');
});
test('does not guess who “我” means or assume a win type', () => {
  assert.equal(parseVoiceCommand('我胡了', context).winnerId, null);
  assert.deepEqual(parseVoiceCommand('开心果胡了', context).winTypeIds, []);
  assert.equal(parseVoiceCommand('开心果和常胜将胡了', context).kind, 'ambiguousPlayer');
});
test('keeps the liable player separate from the winner', () => {
  const command = parseVoiceCommand('开心果平胡，常胜将承包', context);
  assert.equal(command.winnerId, 'player-right');
  assert.equal(command.liablePlayerId, 'player-bottom');
  assert.equal(command.liability, true);
  assert.equal(parseVoiceCommand('没有承包', context).liability, false);
  const incomplete = parseVoiceCommand('开心果胡了，触发承包', context);
  assert.equal(incomplete.winnerId, 'player-right');
  assert.equal(incomplete.liablePlayerId, null);
});
test('confirm is an explicit standalone command; negation never confirms', () => {
  assert.equal(parseVoiceCommand('确认结算', context).kind, 'confirm');
  assert.equal(parseVoiceCommand('先不要确认结算', context).kind, 'unknown');
  assert.equal(parseVoiceCommand('不要记录下方平胡', context).kind, 'unknown');
  assert.equal(parseVoiceCommand('确认清一色', context).kind, 'win');
  assert.equal(parseVoiceCommand('取消', context).kind, 'cancel');
});
test('spoken dice and spoken settlement feed the same existing rules', () => {
  const dice = parseVoiceCommand('三和五', context);
  assert.equal(getDealGuide({ dealerSeat: 'top', dieOne: dice.values[0], dieTwo: dice.values[1] }).openingSeat, 'right');
  const command = parseVoiceCommand('开心果七对加清一色', context);
  const result = settleRound(match, { outcome: 'win', ...command });
  assert.equal(result.history[0].deltas['player-right'], 64);
  assert.equal(result.roundNumber, 2);
  assert.equal(match.roundNumber, 1);
});
test('v3 migrates a copy of v2 data and never clears or writes the v2 key', () => {
  const v2Raw = JSON.stringify(match);
  const memory = new Map([['hangzhou-mahjong-match-v2', v2Raw]]);
  const storage = createStorage({ getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) });
  assert.equal(STORAGE_KEY, 'hangzhou-mahjong-match-v3');
  assert.deepEqual(storage.load(), match);
  storage.clear();
  assert.equal(storage.load(), null);
  assert.equal(memory.get('hangzhou-mahjong-match-v2'), v2Raw);
});

function voiceFixture() {
  const instances = [];
  const timers = new Map();
  const transcripts = [];
  const statuses = [];
  const spoken = [];
  let nextTimer = 1;
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.started = true; this.onstart?.(); }
    abort() { this.aborted = true; this.onend?.(); }
    emit(text, isFinal = true) {
      const result = Object.assign([{ transcript: text }], { isFinal });
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
  }
  const scope = {
    isSecureContext: true, location: { protocol: 'https:' }, SpeechRecognition: Recognition,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { getVoices: () => [{ lang: 'zh-CN' }], speak: (value) => spoken.push(value), cancel() {} },
    setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const io = createVoiceIO({ scope, onTranscript: (text) => transcripts.push(text), onStatus: (value) => statuses.push(value) });
  const restart = () => { const pair = [...timers].find(([, value]) => value.delay === 350); assert.ok(pair); timers.delete(pair[0]); pair[1].fn(); };
  return { io, scope, instances, transcripts, statuses, spoken, restart, timers };
}
test('blocks insecure and file microphone access and detects unsupported synthesis', () => {
  const { scope } = voiceFixture();
  assert.equal(getVoiceCapabilities({ ...scope, isSecureContext: false }).recognition, false);
  assert.equal(getVoiceCapabilities({ ...scope, location: { protocol: 'file:' } }).recognition, false);
  assert.equal(getVoiceCapabilities({ ...scope, speechSynthesis: null }).synthesis, false);
});
test('only delivers a final utterance once; partial and duplicate results do not execute', () => {
  const f = voiceFixture(); f.io.start();
  assert.equal(f.instances[0].lang, 'zh-CN');
  f.instances[0].emit('三', false);
  assert.deepEqual(f.transcripts, []);
  f.instances[0].emit('三和五'); f.instances[0].emit('三和五');
  assert.deepEqual(f.transcripts, ['三和五']);
  f.io.stop();
});
test('pauses recognition during playback, then resumes, and stop cancels all restart timers', () => {
  const f = voiceFixture(); f.io.start(); const first = f.instances[0];
  f.io.speak('开心果赢四分');
  assert.equal(first.aborted, true);
  first.emit('确认结算');
  assert.deepEqual(f.transcripts, []);
  assert.equal(f.spoken[0].lang, 'zh-CN');
  f.spoken[0].onend(); f.restart();
  assert.equal(f.instances.length, 2);
  f.io.stop();
  assert.equal(f.io.active, false);
  assert.equal(f.timers.size, 0);
});
test('permission denial and network errors stop the session with actionable status', () => {
  for (const error of ['not-allowed', 'network']) {
    const f = voiceFixture(); f.io.start();
    f.instances[0].onerror({ error });
    assert.equal(f.io.active, false);
    assert.equal(f.statuses.at(-1).state, 'error');
    assert.ok(f.statuses.at(-1).message.length > 10);
    assert.equal(f.timers.size, 0);
  }
});

test('older speech callbacks cannot reopen the microphone during a newer announcement', () => {
  const f = voiceFixture(); f.io.start();
  f.io.speak('第一条'); const first = f.spoken[0];
  f.io.speak('第二条'); const second = f.spoken[1];
  first.onend();
  assert.equal([...f.timers.values()].some(({ delay }) => delay === 350), false);
  second.onerror();
  assert.equal(f.statuses.at(-1).state, 'error');
  f.restart();
  assert.equal(f.instances.length, 2);
  f.io.stop();
});
test('three silent sessions stop instead of retrying forever', () => {
  const f = voiceFixture(); f.io.start();
  f.instances[0].onend(); f.restart();
  f.instances[1].onend(); f.restart();
  f.instances[2].onend();
  assert.equal(f.io.active, false);
  assert.match(f.statuses.at(-1).message, /没听到/);
  assert.equal(f.timers.size, 0);
});
