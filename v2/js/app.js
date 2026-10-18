import { getDealGuide, getRelativeSeats } from './dealing.js';
import { calculateSettlement, getConfiguredWinTypes, getDealerTier, getNextRoundState, WIN_TYPES } from './rules.js';
import { createMatch, createStorage, renamePlayers, SEATS, settleRound, undoLastRound, updateWinTypeSettings } from './state.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const storage = createStorage();
const seatLabel = { top: '上方', right: '右方', bottom: '下方', left: '左方' };
const scoreFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const autoNicknames = ['稳赢王', '开心果', '常胜将', '乐开花', '喜提胜', '赢麻了', '胜利喵', '高兴星', '哈哈赢', '冠军仔', '好心情', '喜上加喜'];

let match = null;
let storageError = '';
let toastTimer;
let dieOne = 1;
let dieTwo = 1;
let settlementDraft = newSettlementDraft();
const drawerOpeners = new Map();

try {
  match = storage.load();
} catch (error) {
  storageError = '本机保存的牌局无法读取。请重新开一场，原始数据不会被静默修改。';
}

function newSettlementDraft() {
  return {
    outcome: 'win',
    winnerId: null,
    winTypeIds: ['plain'],
    liability: false,
    liablePlayerId: null,
  };
}

function playerById(id, source = match) {
  return source?.players.find((player) => player.id === id);
}

function formatScore(value, withSign = true) {
  const number = Number(value);
  const sign = withSign && number > 0 ? '+' : '';
  return `${sign}${scoreFormatter.format(number)}`;
}

function createAutoNicknames() {
  const names = [...autoNicknames];
  for (let index = names.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [names[index], names[swapIndex]] = [names[swapIndex], names[index]];
  }
  return names.slice(0, SEATS.length);
}

function renderApp() {
  const hasMatch = Boolean(match);
  $('#setup-view').hidden = hasMatch;
  $('#dashboard-view').hidden = !hasMatch;
  if (hasMatch) renderDashboard();
  if (!hasMatch && storageError) $('#setup-error').textContent = storageError;
}

function renderDashboard() {
  const dealer = playerById(match.dealerId);
  const tier = getDealerTier(match.dealerRun);
  const relatives = getRelativeSeats(dealer.seat);
  const relationBySeat = {
    [relatives.dealer]: '庄家',
    [relatives.next]: '下家',
    [relatives.opposite]: '对家',
    [relatives.previous]: '上家',
  };

  $('#round-label').textContent = `第 ${match.roundNumber} 局`;
  $('#dealer-tier').textContent = `${dealer.name} · ${tier.label} ×${tier.multiplier}`;
  $('#center-dealer-name').textContent = dealer.name;
  $('#center-tier-label').textContent = `${tier.label} · 庄闲 ×${tier.multiplier}`;
  $('[data-history-count]').textContent = String(match.history.length);
  $('#liability-status').textContent = match.liabilityEnabled ? '三摊承包开启' : '不算三摊承包';

  for (const player of match.players) {
    const card = $(`[data-seat="${player.seat}"]`);
    $('[data-player-name]', card).textContent = player.name;
    $('[data-player-score]', card).textContent = formatScore(player.score);
    $('[data-seat-relation]', card).textContent = `${seatLabel[player.seat]} · ${relationBySeat[player.seat]}`;
    card.classList.toggle('is-dealer', player.id === match.dealerId);
    card.classList.toggle('is-leading', player.score === Math.max(...match.players.map(({ score }) => score)) && player.score > 0);
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function openDrawer(id, opener) {
  drawerOpeners.set(id, opener ?? document.activeElement);
  const drawer = document.getElementById(id);
  drawer.hidden = false;
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => drawer.classList.add('is-open'));
  setTimeout(() => $('button:not([disabled])', drawer)?.focus(), 80);
}

function closeDrawer(id) {
  const drawer = document.getElementById(id);
  if (drawer.hidden) return;
  drawer.classList.remove('is-open');
  setTimeout(() => {
    drawer.hidden = true;
    if (!$$('.drawer.is-open').length) document.body.classList.remove('drawer-open');
    drawerOpeners.get(id)?.focus();
  }, 180);
}

function createChoiceButton({ label, meta, selected, onClick, className = '' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-pressed', String(selected));
  const strong = document.createElement('strong');
  strong.textContent = label;
  button.append(strong);
  if (meta) {
    const small = document.createElement('small');
    small.textContent = meta;
    button.append(small);
  }
  button.addEventListener('click', onClick);
  return button;
}

function buildDiceOptions() {
  for (const [targetId, dieKey] of [['die-one-options', 'one'], ['die-two-options', 'two']]) {
    const target = document.getElementById(targetId);
    target.innerHTML = '';
    for (let value = 1; value <= 6; value += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'die-button';
      button.dataset.die = dieKey;
      button.dataset.value = String(value);
      button.setAttribute('aria-label', `${value} 点`);
      button.textContent = String(value);
      button.addEventListener('click', () => {
        if (dieKey === 'one') dieOne = value;
        else dieTwo = value;
        renderDealGuide();
      });
      target.append(button);
    }
  }
}

function renderWinTypeSettings() {
  const target = $('#win-type-settings-list');
  target.innerHTML = '';
  for (const type of getConfiguredWinTypes(match.winTypeSettings)) {
    const row = document.createElement('div');
    row.className = 'win-type-setting';
    const toggle = document.createElement('label');
    toggle.className = 'win-type-setting-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = `enabled-${type.id}`;
    checkbox.checked = type.enabled;
    const title = document.createElement('span');
    title.textContent = type.label;
    toggle.append(checkbox, title);

    const multiplierLabel = document.createElement('label');
    multiplierLabel.className = 'win-type-multiplier';
    multiplierLabel.textContent = '倍率';
    const multiplier = document.createElement('input');
    multiplier.type = 'number';
    multiplier.name = `multiplier-${type.id}`;
    multiplier.min = '0.1';
    multiplier.max = '999';
    multiplier.step = '0.1';
    multiplier.value = String(type.multiplier);
    multiplier.required = true;
    multiplierLabel.append(multiplier);
    row.append(toggle, multiplierLabel);
    target.append(row);
  }
}

function renderDealGuide() {
  const dealer = playerById(match.dealerId);
  const guide = getDealGuide({ dealerSeat: dealer.seat, dieOne, dieTwo });
  $$('.die-button').forEach((button) => {
    const selected = button.dataset.die === 'one'
      ? Number(button.dataset.value) === dieOne
      : Number(button.dataset.value) === dieTwo;
    button.setAttribute('aria-pressed', String(selected));
  });
  $('#dice-total').textContent = String(guide.total);

  const miniTable = $('#deal-seat-map');
  miniTable.innerHTML = '';
  for (const seat of SEATS) {
    const player = match.players.find((item) => item.seat === seat);
    const marker = document.createElement('div');
    marker.className = `mini-seat mini-seat--${seat}`;
    marker.classList.toggle('is-dealer', seat === guide.dealerSeat);
    marker.classList.toggle('is-opening-wall', seat === guide.openingSeat);
    const name = document.createElement('strong');
    name.textContent = player.name;
    const role = document.createElement('span');
    role.textContent = seat === guide.openingSeat ? '从这里开门' : seat === guide.dealerSeat ? '庄家' : seatLabel[seat];
    marker.append(name, role);
    miniTable.append(marker);
  }
  const center = document.createElement('div');
  center.className = 'mini-table-center';
  center.innerHTML = `<b>${guide.total}</b><span>从右往左数墩</span>`;
  miniTable.append(center);

  const openingPlayer = match.players.find((player) => player.seat === guide.openingSeat);
  $('#opening-wall-result').textContent = `从 ${openingPlayer.name} 面前的牌墙开门，从右往左数过 ${guide.skippedStacks} 墩，从下一墩开始拿牌。`;

  const orderNames = guide.dealOrder.map((seat) => match.players.find((player) => player.seat === seat).name);
  const steps = [
    `${orderNames.join(' → ')}，依次每人拿 4 张。`,
    '按同样顺序共拿三轮，每人先拿到 12 张。',
    `${dealer.name} 跳牌拿 2 张，其余三家依次各拿 1 张。`,
    `最后 ${dealer.name} 14 张，其他人各 13 张，由庄家先出牌。`,
  ];
  const list = $('#deal-steps');
  list.innerHTML = '';
  for (const text of steps) {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  }
}

function renderSettlementChoices() {
  $$('[data-outcome]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.outcome === settlementDraft.outcome));
  });
  const isDraw = settlementDraft.outcome === 'draw';
  $('#winner-section').hidden = isDraw;
  $('#win-type-section').hidden = isDraw;
  $('#liability-section').hidden = isDraw || !match.liabilityEnabled;

  const winnerTarget = $('#winner-options');
  winnerTarget.innerHTML = '';
  for (const player of match.players) {
    winnerTarget.append(createChoiceButton({
      label: player.name,
      meta: player.id === match.dealerId ? '当前庄家' : seatLabel[player.seat],
      selected: settlementDraft.winnerId === player.id,
      onClick: () => {
        settlementDraft.winnerId = player.id;
        if (settlementDraft.liablePlayerId === player.id) settlementDraft.liablePlayerId = null;
        renderSettlementChoices();
      },
      className: 'player-choice',
    }));
  }

  const availableWinTypes = getConfiguredWinTypes(match.winTypeSettings).filter(({ enabled }) => enabled);
  settlementDraft.winTypeIds = settlementDraft.winTypeIds.filter((id) => availableWinTypes.some((type) => type.id === id));
  if (!settlementDraft.winTypeIds.length) settlementDraft.winTypeIds = [availableWinTypes[0].id];
  const typeTarget = $('#win-type-options');
  typeTarget.innerHTML = '';
  for (const winType of availableWinTypes) {
    typeTarget.append(createChoiceButton({
      label: winType.label,
      meta: `×${winType.multiplier}`,
      selected: settlementDraft.winTypeIds.includes(winType.id),
      onClick: () => {
        if (winType.id === 'plain') {
          settlementDraft.winTypeIds = ['plain'];
        } else {
          const selected = settlementDraft.winTypeIds.filter((id) => id !== 'plain');
          if (selected.includes(winType.id)) {
            settlementDraft.winTypeIds = selected.filter((id) => id !== winType.id);
            if (!settlementDraft.winTypeIds.length) settlementDraft.winTypeIds = ['plain'];
          } else if (selected.length >= 3) {
            showToast('最多同时选择三种胡牌方式');
          } else {
            settlementDraft.winTypeIds = [...selected, winType.id];
          }
        }
        renderSettlementChoices();
      },
      className: 'win-type-choice',
    }));
  }

  $$('[data-liability]').forEach((button) => {
    button.setAttribute('aria-pressed', String(String(settlementDraft.liability) === button.dataset.liability));
  });
  $('#liable-player-wrap').hidden = !settlementDraft.liability;
  const liableTarget = $('#liable-player-options');
  liableTarget.innerHTML = '';
  for (const player of match.players.filter(({ id }) => id !== settlementDraft.winnerId)) {
    liableTarget.append(createChoiceButton({
      label: player.name,
      meta: player.id === match.dealerId ? '当前庄家' : seatLabel[player.seat],
      selected: settlementDraft.liablePlayerId === player.id,
      onClick: () => {
        settlementDraft.liablePlayerId = player.id;
        renderSettlementChoices();
      },
      className: 'player-choice',
    }));
  }
  renderSettlementPreview();
}

function renderSettlementPreview() {
  const target = $('#settlement-preview-list');
  const confirmButton = $('#confirm-settlement');
  const error = $('#settlement-error');
  const availableWinTypes = getConfiguredWinTypes(match.winTypeSettings).filter(({ enabled }) => enabled);
  target.innerHTML = '';
  error.textContent = '';
  let result = null;

  if (settlementDraft.outcome === 'win') {
    if (!settlementDraft.winnerId) {
      error.textContent = '先选择本局谁胡了。';
    } else if (settlementDraft.liability && !settlementDraft.liablePlayerId) {
      error.textContent = '请选择三摊承包者。';
    } else {
      try {
        result = calculateSettlement({
          players: match.players,
          dealerId: match.dealerId,
          dealerRun: match.dealerRun,
          baseScore: match.baseScore,
          winnerId: settlementDraft.winnerId,
          winTypeIds: settlementDraft.winTypeIds,
          winTypeMultipliers: Object.fromEntries(availableWinTypes.map(({ id, multiplier }) => [id, multiplier])),
          liablePlayerId: settlementDraft.liability ? settlementDraft.liablePlayerId : null,
        });
      } catch (calculationError) {
        error.textContent = calculationError.message;
      }
    }
  }

  const deltas = result?.deltas ?? Object.fromEntries(match.players.map(({ id }) => [id, 0]));
  for (const player of match.players) {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const identity = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = player.name;
    const formula = document.createElement('small');
    if (settlementDraft.outcome === 'draw') {
      formula.textContent = '流局不计分';
    } else if (!result) {
      formula.textContent = '等待选择';
    } else if (player.id === settlementDraft.winnerId) {
      formula.textContent = settlementDraft.liability ? '收取承包总额' : '收取三家合计';
    } else if (settlementDraft.liability) {
      formula.textContent = player.id === settlementDraft.liablePlayerId
        ? '三摊承包：支付三家总额'
        : `由 ${playerById(settlementDraft.liablePlayerId).name} 承包`;
    } else {
      const detail = result.details.find(({ loserId }) => loserId === player.id);
      formula.textContent = `${formatScore(detail.baseScore, false)} × 胡法 ${detail.winMultiplier} × 庄闲 ${detail.relationMultiplier}`;
    }
    identity.append(name, formula);
    const delta = document.createElement('b');
    delta.className = deltas[player.id] > 0 ? 'is-positive' : deltas[player.id] < 0 ? 'is-negative' : '';
    delta.textContent = formatScore(deltas[player.id]);
    row.append(identity, delta);
    target.append(row);
  }

  if (settlementDraft.outcome === 'draw') {
    $('#preview-summary').textContent = '庄家、老数和分数都不变';
    confirmButton.disabled = false;
  } else if (result) {
    const winner = playerById(settlementDraft.winnerId);
    $('#preview-summary').textContent = `${winner.name} ${result.winType.label} ×${result.winType.multiplier}，共得 ${formatScore(result.totalWon, false)} 分`;
    confirmButton.disabled = false;
  } else {
    $('#preview-summary').textContent = '补全上面的选择后再确认';
    confirmButton.disabled = true;
  }
}

function exportRoundScreenshot(entry) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1320;
  const context = canvas.getContext('2d');
  if (!context) {
    showToast('无法生成截图，请换一个浏览器重试');
    return;
  }

  const { width, height } = canvas;
  context.fillStyle = '#073d35';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#edf4ef';
  context.fillRect(34, 34, width - 68, height - 68);
  context.fillStyle = '#0b5a4a';
  context.fillRect(34, 34, width - 68, 225);
  context.fillStyle = '#fff9e8';
  context.font = '800 34px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText('杭州麻将 · 牌局记录', 78, 100);
  context.font = '700 58px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`第 ${entry.roundNumber} 局`, 78, 187);

  const beforeDealer = playerById(entry.before.dealerId, entry.before);
  const beforeTier = getDealerTier(entry.before.dealerRun);
  const isDraw = entry.input.outcome === 'draw';
  const winner = isDraw ? null : playerById(entry.input.winnerId, entry.before);
  const next = getNextRoundState({
    dealerId: entry.before.dealerId,
    dealerRun: entry.before.dealerRun,
    ...entry.input,
  });
  const nextDealer = playerById(next.dealerId, entry.before);
  const nextTier = getDealerTier(next.dealerRun);

  context.fillStyle = '#18332e';
  context.font = '800 45px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(isDraw ? '流局' : `${winner.name} 胡牌`, 78, 352);
  context.font = '700 32px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillStyle = '#60756f';
  context.fillText(isDraw ? '庄家与老数保持不变' : entry.calculation.winType.label, 78, 410);

  context.fillStyle = '#fff9e8';
  context.fillRect(78, 462, width - 156, 150);
  context.fillStyle = '#60756f';
  context.font = '700 25px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText('本局胡法倍率', 110, 510);
  context.fillStyle = '#d94836';
  context.font = '900 58px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(isDraw ? '—' : `×${entry.calculation.winType.multiplier}`, 110, 580);
  context.fillStyle = '#18332e';
  context.font = '750 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(isDraw ? '本局未计分' : `胡家净得 ${formatScore(entry.calculation.totalWon, false)} 分`, 420, 570);

  context.fillStyle = '#18332e';
  context.font = '800 29px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText('四人收支', 78, 688);
  context.fillStyle = '#fff';
  context.fillRect(78, 720, width - 156, 290);
  entry.before.players.forEach((player, index) => {
    const y = 780 + index * 62;
    context.fillStyle = index % 2 ? '#f6f8f5' : '#fff';
    context.fillRect(78, y - 38, width - 156, 58);
    context.fillStyle = '#18332e';
    context.font = '700 27px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(`${player.name}${player.id === entry.before.dealerId ? ' · 庄' : ''}`, 108, y);
    const delta = entry.deltas[player.id] ?? 0;
    context.textAlign = 'right';
    context.fillStyle = delta > 0 ? '#08795f' : delta < 0 ? '#bb382e' : '#60756f';
    context.font = '850 30px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(formatScore(delta), width - 108, y);
    context.textAlign = 'left';
  });

  context.fillStyle = '#18332e';
  context.font = '700 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`本局庄家：${beforeDealer.name} · ${beforeTier.label} ×${beforeTier.multiplier}`, 78, 1085);
  context.fillText(`下一局庄家：${nextDealer.name} · ${nextTier.label} ×${nextTier.multiplier}`, 78, 1132);
  if (!isDraw && entry.input.liablePlayerId) {
    const liablePlayer = playerById(entry.input.liablePlayerId, entry.before);
    context.fillStyle = '#a92f25';
    context.fillText(`三摊承包：${liablePlayer.name}`, 78, 1179);
  }
  context.fillStyle = '#60756f';
  context.font = '500 21px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(new Date(entry.settledAt).toLocaleString('zh-CN'), 78, 1250);

  const filename = `杭州麻将-第${entry.roundNumber}局.png`;
  try {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename;
    link.click();
    showToast('牌局截图已导出');
  } catch {
    showToast('截图导出失败，请重试');
  }
}

function renderHistory() {
  const target = $('#history-list');
  target.innerHTML = '';
  $('#undo-round').disabled = match.history.length === 0;
  if (!match.history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span aria-hidden="true">局</span><strong>还没有结算记录</strong><p>完成第一局后，计算明细会出现在这里。</p>';
    target.append(empty);
    return;
  }

  for (const entry of [...match.history].reverse()) {
    const card = document.createElement('article');
    card.className = 'history-card';
    const beforeDealer = playerById(entry.before.dealerId, entry.before);
    const beforeTier = getDealerTier(entry.before.dealerRun);
    const heading = document.createElement('div');
    heading.className = 'history-heading';
    const title = document.createElement('h3');
    const meta = document.createElement('span');
    if (entry.input.outcome === 'draw') {
      title.textContent = `第 ${entry.roundNumber} 局 · 流局`;
      meta.textContent = `${beforeDealer.name} 保持 ${beforeTier.label}`;
    } else {
      const winner = playerById(entry.input.winnerId, entry.before);
      title.textContent = `第 ${entry.roundNumber} 局 · ${winner.name} ${entry.calculation.winType.label}`;
      const next = getNextRoundState({
        dealerId: entry.before.dealerId,
        dealerRun: entry.before.dealerRun,
        ...entry.input,
      });
      const nextDealer = playerById(next.dealerId, entry.before);
      const nextTier = getDealerTier(next.dealerRun);
      meta.textContent = `${nextDealer.name} 接下来是 ${nextTier.label} ×${nextTier.multiplier}`;
    }
    heading.append(title, meta);
    const deltas = document.createElement('div');
    deltas.className = 'history-deltas';
    for (const player of entry.before.players) {
      const item = document.createElement('span');
      const playerName = document.createElement('small');
      playerName.textContent = player.name;
      const playerDelta = document.createElement('b');
      playerDelta.className = entry.deltas[player.id] > 0
        ? 'is-positive'
        : entry.deltas[player.id] < 0
          ? 'is-negative'
          : '';
      playerDelta.textContent = formatScore(entry.deltas[player.id]);
      item.append(playerName, playerDelta);
      deltas.append(item);
    }
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'secondary-button history-export';
    exportButton.textContent = '导出截图';
    exportButton.addEventListener('click', () => exportRoundScreenshot(entry));
    card.append(heading, deltas, exportButton);
    target.append(card);
  }
}

$('#setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const names = SEATS.map((seat) => $(`#player-${seat}`).value);
  const dealerSeat = $('input[name="dealer-seat"]:checked')?.value;
  try {
    match = createMatch({
      names,
      dealerSeat,
      baseScore: $('#base-score').value,
      liabilityEnabled: $('#liability-enabled').checked,
    });
    storage.save(match);
    storageError = '';
    $('#setup-error').textContent = '';
    renderApp();
    showToast('座位已固定，开始第一局');
  } catch (error) {
    $('#setup-error').textContent = error.message;
  }
});

$('#auto-fill-names').addEventListener('click', () => {
  const names = createAutoNicknames();
  SEATS.forEach((seat, index) => { $(`#player-${seat}`).value = names[index]; });
  $('#setup-error').textContent = '';
});

$('#open-deal-guide').addEventListener('click', (event) => {
  dieOne = 1;
  dieTwo = 1;
  renderDealGuide();
  openDrawer('deal-drawer', event.currentTarget);
});

$('#open-settlement').addEventListener('click', (event) => {
  settlementDraft = newSettlementDraft();
  renderSettlementChoices();
  openDrawer('settlement-drawer', event.currentTarget);
});

$('#open-history').addEventListener('click', (event) => {
  renderHistory();
  openDrawer('history-drawer', event.currentTarget);
});

$('#open-reset').addEventListener('click', () => $('#reset-dialog').showModal());

$('#open-settings').addEventListener('click', () => {
  renderWinTypeSettings();
  $('#settings-error').textContent = '';
  $('#settings-dialog').showModal();
});

$('#cancel-settings').addEventListener('click', () => $('#settings-dialog').close());

$('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const settings = Object.fromEntries(WIN_TYPES.map(({ id }) => [id, {
    enabled: form.elements.namedItem(`enabled-${id}`).checked,
    multiplier: form.elements.namedItem(`multiplier-${id}`).value,
  }]));
  try {
    const updatedMatch = updateWinTypeSettings(match, settings);
    storage.save(updatedMatch);
    match = updatedMatch;
    $('#settings-dialog').close();
    showToast('胡牌设置已保存');
  } catch (error) {
    $('#settings-error').textContent = error.message;
  }
});

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } else {
      document.body.classList.toggle('fullscreen-fallback');
    }
  } catch {
    document.body.classList.toggle('fullscreen-fallback');
  }
  updateFullscreenLabel();
}

function updateFullscreenLabel() {
  const active = Boolean(document.fullscreenElement) || document.body.classList.contains('fullscreen-fallback');
  $('#toggle-fullscreen').textContent = active ? '退出全屏' : '进入全屏';
}

$('#toggle-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenLabel);

$('#auto-fill-match-names').addEventListener('click', () => {
  const form = $('#nickname-form');
  const names = createAutoNicknames();
  SEATS.forEach((seat, index) => { form.elements.namedItem(seat).value = names[index]; });
  $('#nickname-error').textContent = '';
});

$('#open-nickname-editor').addEventListener('click', () => {
  const form = $('#nickname-form');
  for (const player of match.players) form.elements.namedItem(player.seat).value = player.name;
  $('#nickname-error').textContent = '';
  $('#nickname-dialog').showModal();
});

$('#cancel-nickname-edit').addEventListener('click', () => $('#nickname-dialog').close());

$('#nickname-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const updatedMatch = renamePlayers(match, SEATS.map((seat) => form.elements.namedItem(seat).value));
    storage.save(updatedMatch);
    match = updatedMatch;
    renderDashboard();
    $('#nickname-dialog').close();
    showToast('昵称已更新');
  } catch (error) {
    $('#nickname-error').textContent = error.message;
  }
});

$$('[data-close-drawer]').forEach((button) => {
  button.addEventListener('click', () => closeDrawer(button.dataset.closeDrawer));
});

$$('[data-outcome]').forEach((button) => {
  button.addEventListener('click', () => {
    settlementDraft.outcome = button.dataset.outcome;
    renderSettlementChoices();
  });
});

$$('[data-liability]').forEach((button) => {
  button.addEventListener('click', () => {
    settlementDraft.liability = button.dataset.liability === 'true';
    if (!settlementDraft.liability) settlementDraft.liablePlayerId = null;
    renderSettlementChoices();
  });
});

$('#confirm-settlement').addEventListener('click', () => {
  const beforeDealerId = match.dealerId;
  const beforeDealerRun = match.dealerRun;
  const input = {
    outcome: settlementDraft.outcome,
    winnerId: settlementDraft.outcome === 'win' ? settlementDraft.winnerId : null,
    winTypeIds: settlementDraft.outcome === 'win' ? [...settlementDraft.winTypeIds] : null,
    liablePlayerId: settlementDraft.outcome === 'win' && settlementDraft.liability
      ? settlementDraft.liablePlayerId
      : null,
  };
  try {
    const winnerName = input.winnerId ? playerById(input.winnerId).name : '';
    match = settleRound(match, input);
    storage.save(match);
    renderDashboard();
    closeDrawer('settlement-drawer');
    if (input.outcome === 'draw') {
      showToast('流局已记录，庄家和老数不变');
    } else if (input.winnerId === beforeDealerId) {
      const tier = getDealerTier(beforeDealerRun + 1);
      showToast(`${winnerName} 连庄，进入${tier.label} ×${tier.multiplier}`);
    } else {
      showToast(`${winnerName} 胡牌并接庄，从平庄 ×2 开始`);
    }
  } catch (error) {
    $('#settlement-error').textContent = error.message;
  }
});

$('#undo-round').addEventListener('click', () => {
  if (!match.history.length) return;
  if (!window.confirm('撤销上一局？分数、庄家和老数都会恢复。')) return;
  try {
    match = undoLastRound(match);
    storage.save(match);
    renderDashboard();
    renderHistory();
    showToast('上一局已撤销');
  } catch (error) {
    showToast(error.message);
  }
});

$('#confirm-reset').addEventListener('click', () => {
  storage.clear();
  match = null;
  storageError = '';
  $('#setup-form').reset();
  $('#liability-enabled').checked = true;
  $('#base-score').value = '1';
  $('input[name="dealer-seat"][value="bottom"]').checked = true;
  $('#setup-error').textContent = '';
  renderApp();
  showToast('已清除，可以重新摆座位');
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const openDrawerElement = $$('.drawer.is-open').at(-1);
  if (openDrawerElement) closeDrawer(openDrawerElement.id);
});

buildDiceOptions();
renderApp();
