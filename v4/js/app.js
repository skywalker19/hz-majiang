import { getDealGuide, getRelativeSeats } from './dealing.js';
import { calculateSettlement, getConfiguredWinTypes, getDealerTier, getNextRoundState, WIN_TYPES } from './rules.js';
import { createMatch, createStorage, getRoundEditContext, renamePlayers, reviseRound, SEATS, settleRound, undoLastRound, updateWinTypeSettings } from './state.js';
import { createVoiceAssistant } from './voice-app.js';
import { createTableFun } from './fun.js';
import { AVATARS, getPlayerAvatar } from './avatars.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const storage = createStorage();
const tableFun = createTableFun();
const seatLabel = { top: '上方', right: '右方', bottom: '下方', left: '左方' };
const scoreFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const HANGZHOU_NICKNAME_GROUPS = [
  { id: 'places', label: '杭州地名', description: '西湖十景、杭州景点和街道都在这一组。', names: [
    '苏堤春晓', '曲院风荷', '平湖秋月', '断桥残雪', '柳浪闻莺', '花港观鱼', '雷峰夕照', '双峰插云', '南屏晚钟', '三潭印月',
    '西湖', '断桥', '苏堤', '白堤', '雷峰塔', '灵隐寺', '九溪', '龙井',
    '河坊街', '南山路', '北山街', '武林路', '湖滨路', '中山路', '高银街', '孩儿巷', '曙光路', '凤起路', '庆春路', '体育场路',
  ] },
  { id: 'people', label: '杭州历史名人', description: '古代至民国，在杭州出生、生活或任职的人物。', names: [
    '苏轼', '白居易', '钱镠', '林逋', '岳飞', '于谦', '沈括', '范仲淹', '李渔', '洪昇', '龚自珍', '陈端生',
    '胡雪岩', '林启', '章太炎', '李叔同', '郁达夫', '丰子恺', '夏衍', '马一浮', '林风眠', '潘天寿', '吴昌硕', '黄宾虹',
    '林徽因', '戴望舒', '梁实秋',
  ] },
];
const WIN_TYPE_GROUPS = [
  { id: 'common', label: '常用牌型', ids: ['plain', 'allTriplets', 'pureSuit', 'thirteenOrphans'] },
  { id: 'pairs', label: '七对系列', ids: ['sevenPairs', 'luxuryPairs', 'doubleLuxuryPairs', 'tripleLuxuryPairs'] },
  { id: 'fortune', label: '财神与杠', ids: ['baotou', 'caipiao', 'doubleCaipiao', 'kongDraw', 'kongBaotou', 'kongPiao', 'piaoKong'] },
];

let match = null;
let storageError = '';
let toastTimer;
let dieOne = 1;
let dieTwo = 1;
let settlementDraft = newSettlementDraft();
let editingRoundIndex = null;
let voiceAssistant = null;
const drawerOpeners = new Map();
const avatarDrafts = {
  setup: Object.fromEntries(SEATS.map((seat) => [seat, getPlayerAvatar(null, seat).id])),
  nickname: {},
};
let avatarTarget = null;
const nicknameSeats = { setup: 'bottom', nickname: 'bottom' };
const nicknameGroups = { setup: 'places', nickname: 'places' };

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

function createAutoNicknames(groupId) {
  const group = HANGZHOU_NICKNAME_GROUPS.find(({ id }) => id === groupId) ?? HANGZHOU_NICKNAME_GROUPS[0];
  const names = [...group.names];
  for (let index = names.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [names[index], names[swapIndex]] = [names[swapIndex], names[index]];
  }
  return names.slice(0, SEATS.length);
}

function nicknameInput(context, seat) {
  return context === 'setup' ? $(`#player-${seat}`) : $(`#nickname-form input[name="${seat}"]`);
}

function renderNicknamePresets(context) {
  const container = $(`[data-nickname-presets="${context}"]`);
  $(context === 'setup' ? '#auto-fill-names' : '#auto-fill-match-names').textContent = nicknameGroups[context] === 'people'
    ? '随机分配四位历史名人' : '随机分配四个杭州地名';
  const seat = nicknameSeats[context];
  const seats = $('[data-nickname-seats]', container);
  seats.replaceChildren();
  for (const choice of SEATS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nickname-seat';
    button.dataset.nicknameSeat = choice;
    button.setAttribute('aria-pressed', String(choice === seat));
    const label = document.createElement('strong');
    label.textContent = seatLabel[choice];
    const current = document.createElement('small');
    current.textContent = nicknameInput(context, choice).value.trim() || '待选昵称';
    button.append(label, current);
    button.addEventListener('click', () => {
      nicknameSeats[context] = choice;
      renderNicknamePresets(context);
      $(`[data-nickname-seat="${choice}"]`, container)?.focus({ preventScroll: true });
    });
    seats.append(button);
  }
  const options = $('[data-nickname-options]', container);
  options.replaceChildren();
  const groupChoices = $('[data-nickname-groups]', container);
  groupChoices.replaceChildren();
  for (const group of HANGZHOU_NICKNAME_GROUPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nickname-group-choice';
    button.dataset.nicknameGroup = group.id;
    button.textContent = group.label;
    button.setAttribute('aria-pressed', String(nicknameGroups[context] === group.id));
    button.addEventListener('click', () => {
      nicknameGroups[context] = group.id;
      renderNicknamePresets(context);
      $(`[data-nickname-group="${group.id}"]`, container)?.focus({ preventScroll: true });
    });
    groupChoices.append(button);
  }
  const selectedName = nicknameInput(context, seat).value.trim();
  const usedNames = new Set(SEATS.filter((choice) => choice !== seat).map((choice) => nicknameInput(context, choice).value.trim()));
  for (const group of HANGZHOU_NICKNAME_GROUPS.filter(({ id }) => id === nicknameGroups[context])) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = `${group.label} · ${group.names.length} 项`;
    const description = document.createElement('p');
    description.className = 'nickname-group-note';
    description.textContent = group.description;
    const grid = document.createElement('div');
    grid.className = 'nickname-preset-grid';
    for (const name of group.names) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nickname-preset';
      button.dataset.nicknameOption = name;
      button.textContent = name;
      button.disabled = usedNames.has(name);
      button.setAttribute('aria-pressed', String(selectedName === name));
      button.setAttribute('aria-label', button.disabled ? `${name}，已被其他座位使用` : `${name}，选作${seatLabel[seat]}昵称`);
      button.addEventListener('click', () => {
        nicknameInput(context, seat).value = name;
        $(context === 'setup' ? '#setup-error' : '#nickname-error').textContent = '';
        renderNicknamePresets(context);
        $(`[data-nickname-option="${name}"]`, container)?.focus({ preventScroll: true });
      });
      grid.append(button);
    }
    section.append(heading, description, grid);
    options.append(section);
  }
}

for (const context of ['setup', 'nickname']) {
  for (const seat of SEATS) {
    const input = nicknameInput(context, seat);
    input.addEventListener('focus', () => { nicknameSeats[context] = seat; renderNicknamePresets(context); });
    input.addEventListener('input', () => renderNicknamePresets(context));
  }
  renderNicknamePresets(context);
}

function renderAvatarEditor(context) {
  const container = $(`[data-avatar-editor="${context}"]`);
  container.replaceChildren();
  for (const seat of SEATS) {
    const avatar = getPlayerAvatar(avatarDrafts[context][seat], seat);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'avatar-seat-choice';
    button.dataset.avatarSeat = seat;
    button.setAttribute('aria-label', `${seatLabel[seat]}：${avatar.label}，更换头像`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'avatar-dialog');
    const image = document.createElement('img');
    image.src = avatar.src;
    image.alt = '';
    image.width = 44;
    image.height = 44;
    const label = document.createElement('span');
    label.textContent = seatLabel[seat];
    const action = document.createElement('small');
    action.textContent = '换头像';
    button.append(image, label, action);
    button.addEventListener('click', () => openAvatarPicker(context, seat));
    container.append(button);
  }
}

function openAvatarPicker(context, seat) {
  tableFun.dismiss();
  avatarTarget = { context, seat };
  $('#avatar-title').textContent = `${seatLabel[seat]} · 选择头像`;
  const options = $('#avatar-options');
  options.replaceChildren();
  const selectedId = getPlayerAvatar(avatarDrafts[context][seat], seat).id;
  for (const [gender, title] of [['male', '男生 · 4 款'], ['female', '女生 · 4 款']]) {
    const group = document.createElement('section');
    group.className = 'avatar-option-group';
    const heading = document.createElement('h3');
    heading.id = `avatar-group-${gender}`;
    heading.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'avatar-option-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-labelledby', heading.id);
    for (const avatar of AVATARS.filter((item) => item.gender === gender)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'avatar-option';
      button.setAttribute('aria-pressed', String(avatar.id === selectedId));
      button.setAttribute('aria-label', avatar.label);
      const image = document.createElement('img');
      image.src = avatar.src;
      image.alt = '';
      image.width = 64;
      image.height = 64;
      const label = document.createElement('span');
      label.textContent = avatar.label;
      const mark = document.createElement('b');
      mark.className = 'avatar-selected-mark';
      mark.textContent = '✓';
      mark.setAttribute('aria-hidden', 'true');
      button.append(image, label, mark);
      button.addEventListener('click', () => {
        avatarDrafts[context][seat] = avatar.id;
        renderAvatarEditor(context);
        $('#avatar-dialog').close();
      });
      grid.append(button);
    }
    group.append(heading, grid);
    options.append(group);
  }
  $('#avatar-dialog').showModal();
  $('[aria-pressed="true"]', options)?.focus({ preventScroll: true });
}

$('#close-avatar-picker').addEventListener('click', () => $('#avatar-dialog').close());
$('#avatar-dialog').addEventListener('close', () => {
  if (!avatarTarget) return;
  const { context, seat } = avatarTarget;
  $(`[data-avatar-editor="${context}"] [data-avatar-seat="${seat}"]`)?.focus({ preventScroll: true });
  avatarTarget = null;
});
renderAvatarEditor('setup');

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
  $('#table-mood').textContent = tableFun.describeTable(match);
  $('[data-history-count]').textContent = String(match.history.length);
  $('#liability-status').textContent = match.liabilityEnabled ? '三摊承包开启' : '不算三摊承包';

  for (const player of match.players) {
    const card = $(`[data-seat="${player.seat}"]`);
    $('[data-player-name]', card).textContent = player.name;
    $('[data-player-avatar]', card).src = getPlayerAvatar(player.avatarId, player.seat).src;
    $('[data-player-score]', card).textContent = formatScore(player.score);
    $('[data-seat-relation]', card).textContent = `${seatLabel[player.seat]} · ${relationBySeat[player.seat]}`;
    card.classList.toggle('is-dealer', player.id === match.dealerId);
    card.classList.toggle('is-leading', player.score === Math.max(...match.players.map(({ score }) => score)) && player.score > 0);
  }
}

function showToast(message) {
  if ($('#voice-drawer').classList.contains('is-open')) return;
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function openDrawer(id, opener) {
  tableFun.dismiss();
  clearTimeout(toastTimer);
  $('#toast').classList.remove('is-visible');
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
  if (id === 'voice-drawer') voiceAssistant?.stop();
  if (id === 'settlement-drawer') {
    editingRoundIndex = null;
    $('#history-drawer').inert = false;
  }
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
  button.title = meta ? `${label} · ${meta}` : label;
  button.setAttribute('aria-pressed', String(selected));
  const strong = document.createElement('strong');
  strong.textContent = label;
  button.append(strong);
  if (meta) {
    const small = document.createElement('small');
    small.textContent = meta;
    button.append(small);
  }
  button.addEventListener('click', () => {
    voiceAssistant?.invalidatePending();
    onClick();
  });
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
        voiceAssistant?.invalidatePending();
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

function updateSetupScoringSummary() {
  const baseScore = Number($('#base-score').value);
  $('#setup-scoring-summary').textContent = `${baseScore > 0 ? `底分 ${formatScore(baseScore, false)}` : '底分待填写'} · ${$('#liability-enabled').checked ? '承包开启' : '不算承包'}`;
}

function selectSettlementWinType(id) {
  let limitReached = false;
  if (id === 'plain') {
    settlementDraft.winTypeIds = ['plain'];
  } else {
    const selected = settlementDraft.winTypeIds.filter((value) => value !== 'plain');
    if (selected.includes(id)) {
      settlementDraft.winTypeIds = selected.filter((value) => value !== id);
    } else if (selected.length >= 3) {
      limitReached = true;
    } else {
      settlementDraft.winTypeIds = [...selected, id];
    }
  }
  renderSettlementChoices();
  if (limitReached) {
    $('#win-type-selection-summary').textContent = '已选满 3 种，请先点已选胡法取消，再换选。';
    $('#win-type-selection-summary').classList.add('is-limit');
  }
  $(`#win-type-options [data-win-type-id="${id}"]`)?.focus({ preventScroll: true });
}

function renderSettlementChoices() {
  const source = editingRoundIndex === null ? match : getRoundEditContext(match, editingRoundIndex);
  const editing = editingRoundIndex !== null;
  $('#settlement-drawer').dataset.mode = editing ? 'edit' : 'new';
  $('#settlement-title').textContent = editing ? `修改第 ${source.roundNumber} 局` : '结束本局';
  $('#settlement-mode-label').textContent = editing ? '保存后重算后续牌局' : '确认后同时换庄';
  $('#confirm-settlement').textContent = editing ? '保存修改并重新计算' : '确认结算并开下一局';
  const editNote = $('#settlement-edit-note');
  editNote.hidden = !editing;
  if (editing) {
    const following = match.history.length - editingRoundIndex - 1;
    editNote.textContent = following ? `保存后将重新计算本局及后续 ${following} 局的分数、庄家和老数，后续各局的胡牌选择保持不变。`
      : '保存后更新本局结果、累计分数和下一局庄家，不增加局数。';
  }
  $$('[data-outcome]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.outcome === settlementDraft.outcome));
  });
  const isDraw = settlementDraft.outcome === 'draw';
  $('#winner-section').hidden = isDraw;
  $('#win-type-section').hidden = isDraw;
  $('#liability-section').hidden = isDraw || !source.liabilityEnabled;

  const winnerTarget = $('#winner-options');
  winnerTarget.innerHTML = '';
  for (const player of source.players) {
    winnerTarget.append(createChoiceButton({
      label: player.name,
      meta: player.id === source.dealerId ? '本局庄家' : seatLabel[player.seat],
      selected: settlementDraft.winnerId === player.id,
      onClick: () => {
        settlementDraft.winnerId = player.id;
        if (settlementDraft.liablePlayerId === player.id) settlementDraft.liablePlayerId = null;
        renderSettlementChoices();
      },
      className: 'player-choice',
    }));
  }

  const availableWinTypes = getConfiguredWinTypes(source.winTypeSettings).filter(({ enabled }) => enabled);
  settlementDraft.winTypeIds = settlementDraft.winTypeIds.filter((id) => availableWinTypes.some((type) => type.id === id));
  if (!settlementDraft.winTypeIds.length) settlementDraft.winTypeIds = [availableWinTypes[0].id];
  const typeTarget = $('#win-type-options');
  typeTarget.innerHTML = '';
  for (const group of WIN_TYPE_GROUPS) {
    const types = group.ids.map((id) => availableWinTypes.find((type) => type.id === id)).filter(Boolean);
    if (!types.length) continue;
    const section = document.createElement('section');
    section.className = 'win-type-group';
    section.dataset.group = group.id;
    section.setAttribute('aria-labelledby', `win-type-group-${group.id}`);
    const heading = document.createElement('h3');
    heading.id = `win-type-group-${group.id}`;
    heading.textContent = group.label;
    const grid = document.createElement('div');
    grid.className = 'win-type-grid';
    for (const winType of types) {
      const selected = settlementDraft.winTypeIds.includes(winType.id);
      const button = createChoiceButton({
        label: winType.label,
        meta: `${selected ? '✓ ' : ''}×${winType.multiplier}`,
        selected,
        onClick: () => selectSettlementWinType(winType.id),
        className: 'win-type-choice',
      });
      button.dataset.winTypeId = winType.id;
      button.setAttribute('aria-label', `${winType.label}，倍率 ${winType.multiplier}${selected ? '，已选' : ''}`);
      grid.append(button);
    }
    section.append(heading, grid);
    typeTarget.append(section);
  }
  const selectedTypes = availableWinTypes.filter(({ id }) => settlementDraft.winTypeIds.includes(id));
  const summary = $('#win-type-selection-summary');
  summary.classList.remove('is-limit');
  summary.textContent = selectedTypes[0]?.id === 'plain' ? '已选平胡 · 单独计算'
    : `已选 ${selectedTypes.length}/3：${selectedTypes.map(({ label }) => label).join(' + ')}`;
  const multiplier = selectedTypes.reduce((value, type) => value * type.multiplier, 1);
  $('#win-type-combined-multiplier').textContent = `合计 ×${multiplier}`;

  $$('[data-liability]').forEach((button) => {
    button.setAttribute('aria-pressed', String(String(settlementDraft.liability) === button.dataset.liability));
  });
  $('#liable-player-wrap').hidden = !settlementDraft.liability;
  const liableTarget = $('#liable-player-options');
  liableTarget.innerHTML = '';
  for (const player of source.players.filter(({ id }) => id !== settlementDraft.winnerId)) {
    liableTarget.append(createChoiceButton({
      label: player.name,
      meta: player.id === source.dealerId ? '本局庄家' : seatLabel[player.seat],
      selected: settlementDraft.liablePlayerId === player.id,
      onClick: () => {
        settlementDraft.liablePlayerId = player.id;
        renderSettlementChoices();
      },
      className: 'player-choice',
    }));
  }
  renderSettlementPreview(source);
}

function renderSettlementPreview(source) {
  const target = $('#settlement-preview-list');
  const confirmButton = $('#confirm-settlement');
  const error = $('#settlement-error');
  const availableWinTypes = getConfiguredWinTypes(source.winTypeSettings).filter(({ enabled }) => enabled);
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
          players: source.players,
          dealerId: source.dealerId,
          dealerRun: source.dealerRun,
          baseScore: source.baseScore,
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

  const deltas = result?.deltas ?? Object.fromEntries(source.players.map(({ id }) => [id, 0]));
  for (const player of source.players) {
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
    $('#preview-summary').textContent = editingRoundIndex === null ? '庄家、老数和分数都不变' : '本局改为流局，不计分，按本局开始时的庄家和老数继续';
    confirmButton.disabled = false;
  } else if (result) {
    const winner = playerById(settlementDraft.winnerId, source);
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

function openRoundEditor(roundNumber, opener) {
  const index = match.history.findIndex((entry) => entry.roundNumber === roundNumber);
  if (index < 0) { showToast('找不到这局记录，请重新打开牌局记录'); return; }
  const entry = match.history[index];
  voiceAssistant?.invalidatePending();
  editingRoundIndex = index;
  settlementDraft = {
    outcome: entry.input.outcome,
    winnerId: entry.input.winnerId ?? null,
    winTypeIds: [...(entry.input.winTypeIds ?? (entry.input.winTypeId ? [entry.input.winTypeId] : ['plain']))],
    liability: Boolean(entry.input.liablePlayerId),
    liablePlayerId: entry.input.liablePlayerId ?? null,
  };
  renderSettlementChoices();
  $('#history-drawer').inert = true;
  openDrawer('settlement-drawer', opener);
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
    if (entry.editedAt) {
      const edited = document.createElement('small');
      edited.className = 'history-edited';
      edited.textContent = '已修改';
      heading.append(edited);
    }
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
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'secondary-button history-edit';
    editButton.textContent = '修改结果';
    editButton.setAttribute('aria-label', `修改第 ${entry.roundNumber} 局结果`);
    editButton.addEventListener('click', () => openRoundEditor(entry.roundNumber, editButton));
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    actions.append(editButton, exportButton);
    card.append(heading, deltas, actions);
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
      avatars: SEATS.map((seat) => avatarDrafts.setup[seat]),
      dealerSeat,
      baseScore: $('#base-score').value,
      liabilityEnabled: $('#liability-enabled').checked,
    });
    storage.save(match);
    storageError = '';
    voiceAssistant?.invalidatePending();
    $('#setup-error').textContent = '';
    renderApp();
    showToast(tableFun.enabled ? '牌桌摆好了，祝四位手气旺！' : '座位已固定，开始第一局');
  } catch (error) {
    $('#setup-error').textContent = error.message;
    if (!(Number($('#base-score').value) > 0)) {
      $('#setup-scoring').open = true;
      $('#base-score').focus();
    }
  }
});

$('#base-score').addEventListener('input', updateSetupScoringSummary);
$('#liability-enabled').addEventListener('change', updateSetupScoringSummary);

$('#auto-fill-names').addEventListener('click', () => {
  const names = createAutoNicknames(nicknameGroups.setup);
  SEATS.forEach((seat, index) => { $(`#player-${seat}`).value = names[index]; });
  renderNicknamePresets('setup');
  $('#setup-error').textContent = '';
});

$('#open-deal-guide').addEventListener('click', (event) => {
  voiceAssistant?.invalidatePending();
  dieOne = 1;
  dieTwo = 1;
  renderDealGuide();
  openDrawer('deal-drawer', event.currentTarget);
});

$('#open-settlement').addEventListener('click', (event) => {
  voiceAssistant?.invalidatePending();
  editingRoundIndex = null;
  settlementDraft = newSettlementDraft();
  renderSettlementChoices();
  openDrawer('settlement-drawer', event.currentTarget);
});

$('#open-history').addEventListener('click', (event) => {
  renderHistory();
  openDrawer('history-drawer', event.currentTarget);
});

$('#open-reset').addEventListener('click', () => { tableFun.dismiss(); $('#reset-dialog').showModal(); });

$('#open-settings').addEventListener('click', () => {
  tableFun.dismiss();
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
    voiceAssistant?.invalidatePending();
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
  const names = createAutoNicknames(nicknameGroups.nickname);
  SEATS.forEach((seat, index) => { form.elements.namedItem(seat).value = names[index]; });
  renderNicknamePresets('nickname');
  $('#nickname-error').textContent = '';
});

$('#open-nickname-editor').addEventListener('click', () => {
  tableFun.dismiss();
  const form = $('#nickname-form');
  for (const player of match.players) form.elements.namedItem(player.seat).value = player.name;
  const currentGroup = HANGZHOU_NICKNAME_GROUPS.find((group) => match.players.every(({ name }) => group.names.includes(name)));
  if (currentGroup) nicknameGroups.nickname = currentGroup.id;
  renderNicknamePresets('nickname');
  avatarDrafts.nickname = Object.fromEntries(match.players.map((player) => [player.seat, getPlayerAvatar(player.avatarId, player.seat).id]));
  renderAvatarEditor('nickname');
  $('#nickname-error').textContent = '';
  $('#nickname-dialog').showModal();
});

$('#cancel-nickname-edit').addEventListener('click', () => $('#nickname-dialog').close());

$('#nickname-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const updatedMatch = renamePlayers(match, SEATS.map((seat) => form.elements.namedItem(seat).value), SEATS.map((seat) => avatarDrafts.nickname[seat]));
    storage.save(updatedMatch);
    match = updatedMatch;
    voiceAssistant?.invalidatePending();
    renderDashboard();
    $('#nickname-dialog').close();
    showToast('昵称与头像已更新');
  } catch (error) {
    $('#nickname-error').textContent = error.message;
  }
});

$$('[data-close-drawer]').forEach((button) => {
  button.addEventListener('click', () => closeDrawer(button.dataset.closeDrawer));
});

$$('[data-outcome]').forEach((button) => {
  button.addEventListener('click', () => {
    voiceAssistant?.invalidatePending();
    settlementDraft.outcome = button.dataset.outcome;
    renderSettlementChoices();
  });
});

$$('[data-liability]').forEach((button) => {
  button.addEventListener('click', () => {
    voiceAssistant?.invalidatePending();
    settlementDraft.liability = button.dataset.liability === 'true';
    if (!settlementDraft.liability) settlementDraft.liablePlayerId = null;
    renderSettlementChoices();
  });
});

function confirmSettlement() {
  if ($('#confirm-settlement').disabled) return false;
  $('#confirm-settlement').disabled = true;
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
    if (editingRoundIndex !== null) {
      const roundNumber = match.history[editingRoundIndex].roundNumber;
      const updatedMatch = reviseRound(match, editingRoundIndex, input);
      storage.save(updatedMatch);
      match = updatedMatch;
      voiceAssistant?.invalidatePending();
      tableFun.dismiss();
      renderDashboard();
      renderHistory();
      // The record button was rebuilt; return focus to a stable control in history.
      drawerOpeners.set('settlement-drawer', $('#history-drawer .close-button'));
      closeDrawer('settlement-drawer');
      showToast(`第 ${roundNumber} 局已修改，分数和庄家已重新计算`);
      voiceAssistant?.matchCorrected(roundNumber, match);
      return true;
    }
    const winnerName = input.winnerId ? playerById(input.winnerId).name : '';
    const updatedMatch = settleRound(match, input);
    storage.save(updatedMatch);
    match = updatedMatch;
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
    voiceAssistant?.roundSettled(match.history.at(-1), match);
    tableFun.celebrate(match.history.at(-1), match);
    return true;
  } catch (error) {
    $('#confirm-settlement').disabled = false;
    $('#settlement-error').textContent = error.message;
    return false;
  }
}

$('#confirm-settlement').addEventListener('click', confirmSettlement);

$('#undo-round').addEventListener('click', () => {
  tableFun.dismiss();
  if (!match.history.length) return;
  if (!window.confirm('撤销上一局？分数、庄家和老数都会恢复。')) return;
  try {
    match = undoLastRound(match);
    storage.save(match);
    voiceAssistant?.invalidatePending();
    renderDashboard();
    renderHistory();
    showToast('上一局已撤销');
  } catch (error) {
    showToast(error.message);
  }
});

$('#confirm-reset').addEventListener('click', () => {
  tableFun.dismiss();
  voiceAssistant?.invalidatePending();
  voiceAssistant?.stop();
  storage.clear();
  match = null;
  storageError = '';
  $('#setup-form').reset();
  nicknameSeats.setup = 'bottom';
  nicknameGroups.setup = 'places';
  renderNicknamePresets('setup');
  avatarDrafts.setup = Object.fromEntries(SEATS.map((seat) => [seat, getPlayerAvatar(null, seat).id]));
  renderAvatarEditor('setup');
  tableFun.refreshControls();
  $('#liability-enabled').checked = true;
  $('#base-score').value = '1';
  $('#setup-scoring').open = false;
  updateSetupScoringSummary();
  $('input[name="dealer-seat"][value="bottom"]').checked = true;
  $('#setup-error').textContent = '';
  renderApp();
  showToast('已清除，可以重新摆座位');
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.querySelector('dialog[open]')) return;
  const openDrawerElement = $('#settlement-drawer').classList.contains('is-open')
    ? $('#settlement-drawer') : $$('.drawer.is-open').at(-1);
  if (openDrawerElement) closeDrawer(openDrawerElement.id);
});

voiceAssistant = createVoiceAssistant({
  getMatch: () => match,
  getDice: () => ({ dieOne, dieTwo }),
  openVoice: (opener) => openDrawer('voice-drawer', opener),
  isFunEnabled: () => tableFun.enabled,
});

buildDiceOptions();
updateSetupScoringSummary();
renderApp();
