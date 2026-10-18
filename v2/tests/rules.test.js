import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSettlement,
  getDealerTier,
  getNextRoundState,
  WIN_TYPES,
} from '../js/rules.js';

const players = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('contains every approved win type and multiplier', () => {
  assert.deepEqual(
    Object.fromEntries(WIN_TYPES.map(({ id, multiplier }) => [id, multiplier])),
    {
      plain: 1,
      sevenPairs: 2,
      baotou: 2,
      kongDraw: 2,
      luxuryPairs: 4,
      caipiao: 4,
      kongBaotou: 4,
      doubleLuxuryPairs: 8,
      kongPiao: 8,
      piaoKong: 8,
      tripleLuxuryPairs: 16,
      doubleCaipiao: 16,
      pureSuit: 8,
      thirteenOrphans: 2,
      allTriplets: 2,
    },
  );
});

test('dealer tiers are 平庄 ×2, 一老 ×4, 二老 ×8 capped', () => {
  assert.deepEqual(getDealerTier(1), { label: '平庄', multiplier: 2 });
  assert.deepEqual(getDealerTier(2), { label: '一老', multiplier: 4 });
  assert.deepEqual(getDealerTier(3), { label: '二老', multiplier: 8 });
  assert.deepEqual(getDealerTier(9), { label: '二老', multiplier: 8 });
});

test('non-dealer plain win charges dealer by tier and other players ×1', () => {
  const result = calculateSettlement({
    players,
    dealerId: 'a',
    dealerRun: 2,
    baseScore: 1,
    winnerId: 'b',
    winTypeId: 'plain',
    liablePlayerId: null,
  });
  assert.deepEqual(result.deltas, { a: -4, b: 6, c: -1, d: -1 });
});

test('dealer explosive-pair win multiplies type ×2 by tier ×4', () => {
  const result = calculateSettlement({
    players,
    dealerId: 'a',
    dealerRun: 2,
    baseScore: 1,
    winnerId: 'a',
    winTypeId: 'baotou',
    liablePlayerId: null,
  });
  assert.deepEqual(result.deltas, { a: 24, b: -8, c: -8, d: -8 });
});

test('liability moves the normal total to one payer', () => {
  const result = calculateSettlement({
    players,
    dealerId: 'a',
    dealerRun: 2,
    baseScore: 1,
    winnerId: 'b',
    winTypeId: 'plain',
    liablePlayerId: 'c',
  });
  assert.deepEqual(result.deltas, { a: 0, b: 6, c: -6, d: 0 });
});

test('decimal base scores are rounded to two score places', () => {
  const result = calculateSettlement({
    players,
    dealerId: 'a',
    dealerRun: 1,
    baseScore: 0.15,
    winnerId: 'b',
    winTypeId: 'plain',
    liablePlayerId: null,
  });
  assert.deepEqual(result.deltas, { a: -0.3, b: 0.6, c: -0.15, d: -0.15 });
});

test('dealer win increments run, non-dealer win resets it, draw preserves it', () => {
  assert.deepEqual(
    getNextRoundState({ dealerId: 'a', dealerRun: 1, outcome: 'win', winnerId: 'a' }),
    { dealerId: 'a', dealerRun: 2 },
  );
  assert.deepEqual(
    getNextRoundState({ dealerId: 'a', dealerRun: 2, outcome: 'win', winnerId: 'c' }),
    { dealerId: 'c', dealerRun: 1 },
  );
  assert.deepEqual(
    getNextRoundState({ dealerId: 'a', dealerRun: 2, outcome: 'draw', winnerId: null }),
    { dealerId: 'a', dealerRun: 2 },
  );
});

test('rejects invalid scoring inputs', () => {
  assert.throws(() => getDealerTier(0), /至少为 1/);
  assert.throws(
    () => calculateSettlement({
      players,
      dealerId: 'a',
      dealerRun: 1,
      baseScore: 0,
      winnerId: 'b',
      winTypeId: 'plain',
    }),
    /底分/,
  );
  assert.throws(
    () => calculateSettlement({
      players,
      dealerId: 'a',
      dealerRun: 1,
      baseScore: 1,
      winnerId: 'b',
      winTypeId: 'plain',
      liablePlayerId: 'b',
    }),
    /承包者/,
  );
});
