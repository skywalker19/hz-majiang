import test from 'node:test';
import assert from 'node:assert/strict';
import { TURN_ORDER, getDealGuide, getRelativeSeats } from '../js/dealing.js';

test('maps a bottom dealer to right-hand next player', () => {
  assert.deepEqual(getRelativeSeats('bottom'), {
    dealer: 'bottom',
    next: 'right',
    opposite: 'top',
    previous: 'left',
  });
});

for (const dealerSeat of TURN_ORDER) {
  for (let total = 2; total <= 12; total += 1) {
    const dieOne = Math.max(1, total - 6);
    const dieTwo = total - dieOne;
    test(`${dealerSeat} dealer and total ${total}`, () => {
      const guide = getDealGuide({ dealerSeat, dieOne, dieTwo });
      const expected = TURN_ORDER[(TURN_ORDER.indexOf(dealerSeat) + total - 1) % 4];
      assert.equal(guide.openingSeat, expected);
      assert.equal(guide.skippedStacks, total);
      assert.equal(guide.wallCountDirection, 'right-to-left');
      assert.equal(guide.dealOrder[0], dealerSeat);
      assert.deepEqual(guide.finalCounts, { dealer: 14, others: 13 });
    });
  }
}

test('rejects invalid dice', () => {
  assert.throws(() => getDealGuide({ dealerSeat: 'top', dieOne: 0, dieTwo: 2 }), /1 到 6/);
  assert.throws(() => getDealGuide({ dealerSeat: 'top', dieOne: 7, dieTwo: 2 }), /1 到 6/);
  assert.throws(() => getDealGuide({ dealerSeat: 'top', dieOne: 1.5, dieTwo: 2 }), /整数/);
});

test('rejects an invalid dealer seat', () => {
  assert.throws(() => getDealGuide({ dealerSeat: 'center', dieOne: 2, dieTwo: 2 }), /庄家座位/);
});
