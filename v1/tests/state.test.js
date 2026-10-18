import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch,
  createStorage,
  settleRound,
  undoLastRound,
  validateMatch,
} from '../js/state.js';

const config = {
  names: ['阿青', '阿福', '小杭', '老周'],
  dealerSeat: 'top',
  baseScore: 1,
  liabilityEnabled: true,
};

test('creates a zero-sum match with four fixed seats', () => {
  const match = createMatch(config);
  assert.deepEqual(match.players.map((player) => player.seat), ['top', 'right', 'bottom', 'left']);
  assert.equal(match.players.reduce((sum, player) => sum + player.score, 0), 0);
  assert.equal(match.dealerId, 'player-top');
  assert.equal(match.dealerRun, 1);
  assert.equal(match.roundNumber, 1);
});

test('rejects blank or repeated names and invalid base scores', () => {
  assert.throws(() => createMatch({ ...config, names: ['阿青', '', '小杭', '老周'] }), /姓名/);
  assert.throws(() => createMatch({ ...config, names: ['阿青', '阿青', '小杭', '老周'] }), /不同/);
  assert.throws(() => createMatch({ ...config, baseScore: 0 }), /底分/);
});

test('settles a win atomically and undo restores the exact snapshot', () => {
  const initial = createMatch(config);
  const winnerId = initial.players[1].id;
  const settled = settleRound(initial, {
    outcome: 'win',
    winnerId,
    winTypeId: 'plain',
    liablePlayerId: null,
  });
  assert.equal(settled.dealerId, winnerId);
  assert.equal(settled.dealerRun, 1);
  assert.equal(settled.roundNumber, 2);
  assert.deepEqual(settled.players.map((player) => player.score), [-2, 4, -1, -1]);
  assert.equal('history' in settled.history[0].before, false);
  assert.deepEqual(undoLastRound(settled), initial);
});

test('dealer win increases the run and two-old remains capped by rules', () => {
  const initial = createMatch(config);
  const afterFirst = settleRound(initial, {
    outcome: 'win',
    winnerId: initial.dealerId,
    winTypeId: 'plain',
    liablePlayerId: null,
  });
  const afterSecond = settleRound(afterFirst, {
    outcome: 'win',
    winnerId: afterFirst.dealerId,
    winTypeId: 'plain',
    liablePlayerId: null,
  });
  assert.equal(afterFirst.dealerRun, 2);
  assert.equal(afterSecond.dealerRun, 3);
});

test('draw records history but preserves scores, dealer, and run', () => {
  const initial = createMatch(config);
  const settled = settleRound(initial, {
    outcome: 'draw',
    winnerId: null,
    winTypeId: null,
    liablePlayerId: null,
  });
  assert.deepEqual(settled.players, initial.players);
  assert.equal(settled.dealerId, initial.dealerId);
  assert.equal(settled.dealerRun, initial.dealerRun);
  assert.equal(settled.history.length, 1);
  assert.equal(settled.roundNumber, 2);
});

test('liability is blocked when disabled', () => {
  const initial = createMatch({ ...config, liabilityEnabled: false });
  assert.throws(
    () => settleRound(initial, {
      outcome: 'win',
      winnerId: initial.players[1].id,
      winTypeId: 'plain',
      liablePlayerId: initial.players[2].id,
    }),
    /未开启/,
  );
});

test('storage adapter saves, loads, and clears JSON', () => {
  const memory = new Map();
  const storage = createStorage({
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  });
  const match = createMatch(config);
  storage.save(match);
  assert.deepEqual(storage.load(), match);
  storage.clear();
  assert.equal(storage.load(), null);
});

test('validation rejects corrupted and non-zero-sum matches', () => {
  assert.throws(() => validateMatch(null), /损坏/);
  const match = createMatch(config);
  match.players[0].score = 2;
  assert.throws(() => validateMatch(match), /总分/);
});

test('decimal bottom scores remain valid and zero-sum', () => {
  const initial = createMatch({ ...config, baseScore: 0.15 });
  const settled = settleRound(initial, {
    outcome: 'win',
    winnerId: initial.players[1].id,
    winTypeId: 'plain',
    liablePlayerId: null,
  });
  assert.equal(validateMatch(settled), true);
  assert.ok(Math.abs(settled.players.reduce((sum, player) => sum + player.score, 0)) < 1e-9);
});

test('undo requires history', () => {
  assert.throws(() => undoLastRound(createMatch(config)), /可撤销/);
});
