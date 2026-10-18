import { calculateSettlement, getConfiguredWinTypes, getNextRoundState, WIN_TYPES } from './rules.js';

export const SEATS = ['top', 'right', 'bottom', 'left'];
export const STORAGE_KEY = 'hangzhou-mahjong-match-v2';
const LEGACY_STORAGE_KEY = 'hangzhou-mahjong-match-v1';
const MIGRATION_KEY = 'hangzhou-mahjong-match-v2-migrated';

const clone = (value) => structuredClone(value);

export function createMatch({ names, dealerSeat, baseScore, liabilityEnabled }) {
  const cleanNames = Array.isArray(names)
    ? names.map((name) => String(name).trim())
    : [];

  if (cleanNames.length !== 4 || cleanNames.some((name) => !name)) {
    throw new Error('请输入四位玩家的姓名');
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

export function renamePlayers(match, names) {
  validateMatch(match);
  const cleanNames = Array.isArray(names)
    ? names.map((name) => String(name).trim())
    : [];
  if (cleanNames.length !== 4 || cleanNames.some((name) => !name)) {
    throw new Error('请输入四位玩家的昵称');
  }
  if (cleanNames.some((name) => name.length > 12)) {
    throw new Error('昵称最多 12 个字');
  }
  if (new Set(cleanNames).size !== 4) {
    throw new Error('四位玩家需要使用不同的昵称');
  }
  const namesBySeat = Object.fromEntries(SEATS.map((seat, index) => [seat, cleanNames[index]]));
  const renamed = {
    ...clone(match),
    players: match.players.map((player) => ({ ...player, name: namesBySeat[player.seat] })),
    history: match.history.map((entry) => ({
      ...entry,
      before: {
        ...entry.before,
        players: entry.before.players.map((player) => ({ ...player, name: namesBySeat[player.seat] })),
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
  const currentNames = Object.fromEntries(match.players.map(({ seat, name }) => [seat, name]));
  const before = clone(match.history.at(-1).before);
  before.players = before.players.map((player) => ({ ...player, name: currentNames[player.seat] }));
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
