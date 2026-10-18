import { getDealGuide } from './dealing.js';
import { getDealerTier } from './rules.js';
import { createSpeechOutput } from './speech.js';

// This panel controls announcements. Scorekeeping uses the table controls.
export function createVoiceAssistant(api) {
  const element = (selector) => document.querySelector(selector);
  const seatNames = { top: '上方', right: '右方', bottom: '下方', left: '左方' };
  const score = (value) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
  const preferencesKey = 'hangzhou-mahjong-v3-voice';
  const option = element('#voice-announcements');
  const speech = createSpeechOutput({ onStatus: ({ state, message }) => {
    element('#voice-status').textContent = message;
    element('#voice-status').dataset.state = state;
    element('#voice-stop').hidden = state !== 'speaking';
  } });
  let lastReply = '';
  try { option.checked = JSON.parse(localStorage.getItem(preferencesKey))?.announcements !== false; }
  catch { /* preferences are optional */ }
  if (!speech.supported) option.checked = false;
  option.disabled = !speech.supported;
  document.querySelectorAll('[data-speech-output], #voice-replay').forEach((button) => { button.disabled = !speech.supported; });
  element('#voice-capability').textContent = speech.supported
    ? '确认每局结算后自动朗读结果，也可点下方按钮播报当前牌局。'
    : '当前浏览器不支持语音播报，计分和结果文字仍可使用。';

  function updateSummary() {
    element('#voice-dashboard-status').textContent = !speech.supported ? '当前浏览器不支持播报'
      : option.checked ? '每局结算后自动朗读' : '自动播报已关闭 · 可手动重听';
  }

  function announce(text, force = false) {
    lastReply = text;
    const item = document.createElement('div');
    item.className = 'voice-message';
    const label = document.createElement('small');
    label.textContent = '牌局播报';
    const content = document.createElement('p');
    content.textContent = text;
    item.append(label, content);
    const history = element('#voice-chat');
    history.append(item);
    while (history.children.length > 12) history.firstElementChild.remove();
    history.scrollTop = history.scrollHeight;
    if (option.checked || force) speech.speak(text);
  }

  function dealerDescription(match) {
    const dealer = match.players.find(({ id }) => id === match.dealerId);
    const tier = getDealerTier(match.dealerRun);
    return `第 ${match.roundNumber} 局，${dealer.name}坐庄，${tier.label}，庄家倍数 ${tier.multiplier}。`;
  }

  function dealDescription() {
    const match = api.getMatch();
    if (!match) return '请先填好四人昵称并开局，再在发牌向导选择两颗骰子的点数。';
    const dealer = match.players.find(({ id }) => id === match.dealerId);
    const { dieOne, dieTwo } = api.getDice();
    const guide = getDealGuide({ dealerSeat: dealer.seat, dieOne, dieTwo });
    const player = match.players.find(({ seat }) => seat === guide.openingSeat);
    return `骰子 ${dieOne} 和 ${dieTwo}，共 ${guide.total} 点。从${seatNames[player.seat]}${player.name}面前的牌墙开门，从右往左数过 ${guide.skippedStacks} 墩，从下一墩起牌。${dealer.name}是庄家，先抓牌。`;
  }

  function broadcast(kind) {
    const match = api.getMatch();
    if (kind === 'sample') { announce('语音播报已准备好。每局确认结算后，会朗读得分和下一局庄家。', true); return; }
    if (kind === 'deal') { announce(dealDescription(), true); return; }
    if (!match) { announce('请先填好四人昵称并开始这场牌。', true); return; }
    if (kind === 'dealer') { announce(dealerDescription(match), true); return; }
    if (kind === 'scores') {
      announce(`当前累计分数。${match.players.map((player) => `${player.name}${player.score < 0 ? '输' : '赢'} ${score(Math.abs(player.score))} 分`).join('，')}。`, true);
    }
  }

  document.querySelectorAll('[data-open-voice]').forEach((button) => button.addEventListener('click', () => {
    api.openVoice(button);
    if (button.hasAttribute('data-voice-preview')) broadcast('sample');
  }));
  document.querySelectorAll('[data-speech-output]').forEach((button) => button.addEventListener('click', () => broadcast(button.dataset.speechOutput)));
  element('#voice-stop').addEventListener('click', () => speech.stop());
  element('#voice-replay').addEventListener('click', () => { if (lastReply) speech.speak(lastReply); });
  option.addEventListener('change', () => {
    if (!option.checked) speech.stop();
    try { localStorage.setItem(preferencesKey, JSON.stringify({ announcements: option.checked })); }
    catch { /* preferences are optional */ }
    updateSummary();
    if (option.checked) broadcast('sample');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) speech.stop(); });
  window.addEventListener('pagehide', () => speech.stop());
  updateSummary();
  lastReply = '每局确认结算后，播报本局得分、累计分数和下一局庄家。可随时关闭自动播报，或手动重听。';
  element('#voice-chat').textContent = lastReply;

  return {
    stop: () => speech.stop(),
    invalidatePending: () => { if (speech.speaking) speech.stop(); },
    roundSettled(entry, nextMatch) {
      if (entry.input.outcome === 'draw') {
        announce(`第 ${entry.roundNumber} 局流局已记录，四人不计分，庄家与老数不变。${dealerDescription(nextMatch)}`);
        return;
      }
      const winner = nextMatch.players.find(({ id }) => id === entry.input.winnerId);
      const dealer = nextMatch.players.find(({ id }) => id === nextMatch.dealerId);
      const tier = getDealerTier(nextMatch.dealerRun);
      announce(`第 ${entry.roundNumber} 局，${winner.name}${entry.calculation.winType.label}，本局赢 ${score(entry.deltas[winner.id])} 分，累计${winner.score < 0 ? '输' : '赢'} ${score(Math.abs(winner.score))} 分。下一局${dealer.name}坐庄，${tier.label}，庄家倍数 ${tier.multiplier}。`);
    },
  };
}
