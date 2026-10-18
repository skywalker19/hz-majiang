import { calculateSettlement, getConfiguredWinTypes, getNextRoundState, WIN_TYPES } from './rules.js';
import { getPlayerAvatar } from './avatars.js';

export const SEATS = ['top', 'right', 'bottom', 'left'];
export const STORAGE_KEY = 'hangzhou-mahjong-match-v4';
const LEGACY_STORAGE_KEY = 'hangzhou-mahjong-match-v3';
const MIGRATION_KEY = 'hangzhou-mahjong-match-v4-migrated';

const clone = (value) => structuredClone(value);

function snapshotRoundRules(match) {
  return {
    baseScore: Number(match.baseScore),
    liabilityEnabled: match.liabilityEnabled,
    winTypeSettings: Object.fromEntries(getConfiguredWinTypes(match.winTypeSettings)
      .map(({ id, enabled, multiplier }) => [id, { enabled, multiplier }])),
  };
}

function recordedRoundRules(match, entry) {
  if (entry.rules) return clone(entry.rules);
  // Older records contain the multipliers actually used, but no complete settings snapshot.
  const rules = snapshotRoundRules(match);
  rules.baseScore = Number(entry.calculation?.details?.[0]?.baseScore ?? match.baseScore);
  const recordedTypes = entry.calculation?.winTypes ?? entry.calculation?.details?.[0]?.winTypes
    ?? (entry.calculation?.winType ? [entry.calculation.winType] : []);
  for (const type of recordedTypes) {
    if (rules.winTypeSettings[type.id]) rules.winTypeSettings[type.id] = { enabled: true, multiplier: type.multiplier };
  }
  if (entry.input.liablePlayerId) rules.liabilityEnabled = true;
  return rules;
}

export function getRoundEditContext(match, historyIndex) {
  validateMatch(match);
  if (!Number.isInteger(historyIndex) || historyIndex < 0 || historyIndex >= match.history.length) {
    throw new Error('找不到要修改的牌局记录');
  }
  const entry = match.history[historyIndex];
  const currentProfiles = Object.fromEntries(match.players.map(({ id, name, avatarId }) => [id, { name, avatarId }]));
  return {
    ...clone(match),
    ...clone(entry.before),
    ...recordedRoundRules(match, entry),
    players: entry.before.players.map((player) => ({ ...clone(player), ...currentProfiles[player.id] })),
    history: clone(match.history.slice(0, historyIndex)),
  };
}

export function reviseRound(match, historyIndex, roundInput) {
  let replay = getRoundEditContext(match, historyIndex);
  const editedAt = new Date().toISOString();
  for (let index = historyIndex; index < match.history.length; index += 1) {
    const original = match.history[index];
    const input = index === historyIndex ? roundInput : original.input;
    replay = settleRound({ ...replay, ...recordedRoundRules(match, original) }, input);
    const recalculated = replay.history.at(-1);
    replay.history[replay.history.length - 1] = {
      ...clone(original),
      ...recalculated,
      settledAt: original.settledAt,
      ...(index === historyIndex ? { editedAt } : {}),
    };
  }
  const updated = {
    ...replay,
    baseScore: match.baseScore,
    liabilityEnabled: match.liabilityEnabled,
    winTypeSettings: clone(match.winTypeSettings),
  };
  validateMatch(updated);
  return updated;
}

export function createMatch({ names, avatars, dealerSeat, baseScore, liabilityEnabled }) {
  const cleanNames = Array.isArray(names)
    ? names.map((name) => String(name).trim())
    : [];

  if (cleanNames.length !== 4 || cleanNames.some((name) => !name)) {
    throw new Error('请输入四位玩家的姓名');
  }
  if (cleanNames.some((name) => Array.from(name).length > 4)) {
    throw new Error('昵称最多 4 个字');
  }
  if (new Set(cleanNames).size !== 4) {
    throw new Error('四位玩家需要使用不同的姓名');
  }
  if (!SEATS.includes(dealerSeat)) {
    throw new Error('请选择首局庄家');
  }
  if (!(Number(baseScore) > 0)) {
    throw new Error('底分必须大于 0');
  }

  const players = SEATS.map((seat, index) => ({
    id: `player-${seat}`,
    seat,
    name: cleanNames[index],
    avatarId: getPlayerAvatar(avatars?.[index], seat).id,
    score: 0,
  }));

  return {
    version: 1,
    players,
    dealerId: `player-${dealerSeat}`,
    dealerRun: 1,
    baseScore: Number(baseScore),
    liabilityEnabled: Boolean(liabilityEnabled),
    winTypeSettings: Object.fromEntries(WIN_TYPES.map(({ id, multiplier }) => [id, { enabled: true, multiplier }])),
    roundNumber: 1,
    history: [],
    startedAt: new Date().toISOString(),
  };
}

export function renamePlayers(match, names, avatars) {
  validateMatch(match);
  const cleanNames = Array.isArray(names)
    ? names.map((name) => String(name).trim())
    : [];
  if (cleanNames.length !== 4 || cleanNames.some((name) => !name)) {
    throw new Error('请输入四位玩家的昵称');
  }
  if (cleanNames.some((name) => Array.from(name).length > 4)) {
    throw new Error('昵称最多 4 个字');
  }
  if (new Set(cleanNames).size !== 4) {
    throw new Error('四位玩家需要使用不同的昵称');
  }
  const namesBySeat = Object.fromEntries(SEATS.map((seat, index) => [seat, cleanNames[index]]));
  const avatarsBySeat = Object.fromEntries(SEATS.map((seat, index) => [seat,
    getPlayerAvatar(avatars?.[index] ?? match.players.find((player) => player.seat === seat)?.avatarId, seat).id,
  ]));
  const renamed = {
    ...clone(match),
    players: match.players.map((player) => ({ ...player, name: namesBySeat[player.seat], avatarId: avatarsBySeat[player.seat] })),
    history: match.history.map((entry) => ({
      ...entry,
      before: {
        ...entry.before,
        players: entry.before.players.map((player) => ({ ...player, name: namesBySeat[player.seat], avatarId: avatarsBySeat[player.seat] })),
      },
    })),
  };
  validateMatch(renamed);
  return renamed;
}

export function updateWinTypeSettings(match, settings) {
  validateMatch(match);
  const normalized = Object.fromEntries(WIN_TYPES.map(({ id, multiplier: defaultMultiplier }) => {
    const value = settings?.[id] ?? {};
    const multiplier = Number(value.multiplier ?? defaultMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 999) {
      throw new Error(`${WIN_TYPES.find((type) => type.id === id).label}倍率需在 0 到 999 之间`);
    }
    return [id, { enabled: value.enabled !== false, multiplier }];
  }));
  if (!Object.values(normalized).some(({ enabled }) => enabled)) {
    throw new Error('至少保留一种可选胡牌方式');
  }
  const updated = { ...clone(match), winTypeSettings: normalized };
  validateMatch(updated);
  return updated;
}

export function settleRound(match, roundInput) {
  validateMatch(match);
  const before = clone({
    players: match.players,
    dealerId: match.dealerId,
    dealerRun: match.dealerRun,
    roundNumber: match.roundNumber,
  });
  const input = clone(roundInput);
  let deltas = Object.fromEntries(match.players.map(({ id }) => [id, 0]));
  let calculation = null;

  if (input.outcome === 'win') {
    if (!match.liabilityEnabled && input.liablePlayerId) {
      throw new Error('本场未开启三摊承包');
    }
    const enabledWinTypeIds = new Set(
      getConfiguredWinTypes(match.winTypeSettings).filter(({ enabled }) => enabled).map(({ id }) => id),
    );
    const selectedWinTypeIds = input.winTypeIds ?? (input.winTypeId ? [input.winTypeId] : []);
    if (selectedWinTypeIds.some((id) => !enabledWinTypeIds.has(id))) {
      throw new Error('本场设置中已停用该胡牌方式');
    }
    calculation = calculateSettlement({
      players: match.players,
      dealerId: match.dealerId,
      dealerRun: match.dealerRun,
      baseScore: match.baseScore,
      winnerId: input.winnerId,
      winTypeId: input.winTypeId,
      winTypeIds: input.winTypeIds,
      winTypeMultipliers: Object.fromEntries(
        getConfiguredWinTypes(match.winTypeSettings).map(({ id, multiplier }) => [id, multiplier]),
      ),
      liablePlayerId: input.liablePlayerId,
    });
    deltas = calculation.deltas;
  } else if (input.outcome !== 'draw') {
    throw new Error('本局结果无效');
  }

  const next = getNextRoundState({
    dealerId: match.dealerId,
    dealerRun: match.dealerRun,
    outcome: input.outcome,
    winnerId: input.winnerId,
  });
  const players = match.players.map((player) => ({
    ...player,
    score: player.score + deltas[player.id],
  }));
  const historyEntry = {
    roundNumber: match.roundNumber,
    settledAt: new Date().toISOString(),
    input,
    before,
    deltas,
    calculation,
    rules: snapshotRoundRules(match),
  };
  const settled = {
    ...match,
    players,
    ...next,
    roundNumber: match.roundNumber + 1,
    history: [...match.history, historyEntry],
  };
  validateMatch(settled);
  return settled;
}

export function undoLastRound(match) {
  validateMatch(match);
  if (!match.history.length) {
    throw new Error('还没有可撤销的牌局');
  }
  const currentProfiles = Object.fromEntries(match.players.map(({ seat, name, avatarId }) => [seat,
    { name, avatarId: getPlayerAvatar(avatarId, seat).id },
  ]));
  const before = clone(match.history.at(-1).before);
  before.players = before.players.map((player) => ({ ...player, ...currentProfiles[player.seat] }));
  return {
    ...clone(match),
    ...before,
    history: clone(match.history.slice(0, -1)),
  };
}

export function validateMatch(match) {
  if (!match || match.version !== 1 || !Array.isArray(match.players)) {
    throw new Error('牌局数据已损坏');
  }
  const ids = match.players.map(({ id }) => id);
  const seats = match.players.map(({ seat }) => seat);
  const names = match.players.map(({ name }) => name);
  const winSettingsValid = !match.winTypeSettings || (
    WIN_TYPES.every(({ id }) => {
      const setting = match.winTypeSettings[id];
      return setting
        && typeof setting.enabled === 'boolean'
        && Number.isFinite(Number(setting.multiplier))
        && Number(setting.multiplier) > 0
        && Number(setting.multiplier) <= 999;
    })
    && Object.values(match.winTypeSettings).some(({ enabled }) => enabled)
  );
  if (
    ids.length !== 4
    || new Set(ids).size !== 4
    || new Set(seats).size !== 4
    || !SEATS.every((seat) => seats.includes(seat))
    || names.some((name) => typeof name !== 'string' || !name.trim())
    || !ids.includes(match.dealerId)
    || !Number.isInteger(match.dealerRun)
    || match.dealerRun < 1
    || !Number.isInteger(match.roundNumber)
    || match.roundNumber < 1
    || !(Number(match.baseScore) > 0)
    || !Array.isArray(match.history)
    || !winSettingsValid
  ) {
    throw new Error('牌局数据已损坏');
  }
  if (match.players.reduce((sum, player) => sum + Number(player.score), 0) !== 0) {
    throw new Error('牌局总分必须为 0');
  }
  return true;
}

export function createStorage(storage = localStorage) {
  return {
    save(match) {
      validateMatch(match);
      storage.setItem(STORAGE_KEY, JSON.stringify(match));
      storage.setItem(MIGRATION_KEY, 'true');
    },
    load() {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        validateMatch(parsed);
        return parsed;
      }
      if (storage.getItem(MIGRATION_KEY) === 'true') return null;
      const legacyRaw = storage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) {
        storage.setItem(MIGRATION_KEY, 'true');
        return null;
      }
      const parsed = JSON.parse(legacyRaw);
      validateMatch(parsed);
      storage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      storage.setItem(MIGRATION_KEY, 'true');
      return parsed;
    },
    clear() {
      storage.removeItem(STORAGE_KEY);
      storage.setItem(MIGRATION_KEY, 'true');
    },
  };
}
