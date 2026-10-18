// Counter-clockwise around the table as seen from above. For a player seated
// at the bottom of the screen, the next player is physically on their right.
export const TURN_ORDER = ['top', 'left', 'bottom', 'right'];

export function getRelativeSeats(dealerSeat) {
  const index = TURN_ORDER.indexOf(dealerSeat);
  if (index < 0) throw new Error('庄家座位无效');
  return {
    dealer: dealerSeat,
    next: TURN_ORDER[(index + 1) % 4],
    opposite: TURN_ORDER[(index + 2) % 4],
    previous: TURN_ORDER[(index + 3) % 4],
  };
}

export function getDealGuide({ dealerSeat, dieOne, dieTwo }) {
  for (const die of [dieOne, dieTwo]) {
    if (!Number.isInteger(die) || die < 1 || die > 6) {
      throw new Error('骰子点数必须是 1 到 6 的整数');
    }
  }

  const dealerIndex = TURN_ORDER.indexOf(dealerSeat);
  if (dealerIndex < 0) throw new Error('庄家座位无效');

  const total = dieOne + dieTwo;
  const openingSeat = TURN_ORDER[(dealerIndex + total - 1) % 4];
  const dealOrder = Array.from(
    { length: 4 },
    (_, index) => TURN_ORDER[(dealerIndex + index) % 4],
  );

  return {
    dealerSeat,
    dieOne,
    dieTwo,
    total,
    openingSeat,
    skippedStacks: total,
    wallCountDirection: 'right-to-left',
    dealOrder,
    finalCounts: { dealer: 14, others: 13 },
  };
}
