import { calculateSettlement, getNextRoundState } from './rules.js';

export const SEATS = ['top', 'right', 'bottom', 'left'];
export const STORAGE_KEY = 'hangzhou-mahjong-match-v1';

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
    roundNumber: 1,
    history: [],
    startedAt: new Date().toISOString(),
  };
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
    calculation = calculateSettlement({
      players: match.players,
      dealerId: match.dealerId,
      dealerRun: match.dealerRun,
      baseScore: match.baseScore,
      winnerId: input.winnerId,
      winTypeId: input.winTypeId,
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
  const before = clone(match.history.at(-1).before);
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
    },
    load() {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      validateMatch(parsed);
      return parsed;
    },
    clear() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}
