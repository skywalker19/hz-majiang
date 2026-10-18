export const WIN_TYPES = [
  ['plain', '平胡', 1],
  ['sevenPairs', '七对', 2],
  ['baotou', '爆头', 2],
  ['kongDraw', '杠开', 2],
  ['luxuryPairs', '豪华七对', 4],
  ['caipiao', '财飘', 4],
  ['kongBaotou', '杠爆', 4],
  ['doubleLuxuryPairs', '双豪华七对', 8],
  ['kongPiao', '杠飘', 8],
  ['piaoKong', '飘杠', 8],
  ['tripleLuxuryPairs', '三豪华七对', 16],
  ['doubleCaipiao', '双财飘', 16],
].map(([id, label, multiplier]) => ({ id, label, multiplier }));

export function getDealerTier(dealerRun) {
  if (!Number.isInteger(dealerRun) || dealerRun < 1) {
    throw new Error('连庄局数必须至少为 1');
  }
  if (dealerRun === 1) return { label: '平庄', multiplier: 2 };
  if (dealerRun === 2) return { label: '一老', multiplier: 4 };
  return { label: '二老', multiplier: 8 };
}

export function calculateSettlement(input) {
  const {
    players,
    dealerId,
    dealerRun,
    baseScore,
    winnerId,
    winTypeId,
    liablePlayerId = null,
  } = input;
  const ids = players?.map(({ id }) => id) ?? [];

  if (ids.length !== 4 || new Set(ids).size !== 4) {
    throw new Error('必须有四名不同的玩家');
  }
  if (!ids.includes(dealerId) || !ids.includes(winnerId)) {
    throw new Error('庄家或胡家无效');
  }
  if (!(Number(baseScore) > 0)) {
    throw new Error('底分必须大于 0');
  }
  if (liablePlayerId === winnerId || (liablePlayerId && !ids.includes(liablePlayerId))) {
    throw new Error('承包者无效');
  }

  const winType = WIN_TYPES.find(({ id }) => id === winTypeId);
  if (!winType) throw new Error('胡牌方式无效');

  const dealerTier = getDealerTier(dealerRun);
  const deltas = Object.fromEntries(ids.map((id) => [id, 0]));
  const details = [];
  let totalWon = 0;

  for (const loserId of ids.filter((id) => id !== winnerId)) {
    const relationMultiplier = loserId === dealerId || winnerId === dealerId
      ? dealerTier.multiplier
      : 1;
    const amount = Number(baseScore) * winType.multiplier * relationMultiplier;
    totalWon += amount;
    details.push({
      loserId,
      amount,
      baseScore: Number(baseScore),
      winMultiplier: winType.multiplier,
      relationMultiplier,
    });
    deltas[loserId] = -amount;
  }

  if (liablePlayerId) {
    for (const id of ids) deltas[id] = 0;
    deltas[liablePlayerId] = -totalWon;
  }
  deltas[winnerId] = totalWon;

  return { deltas, details, totalWon, winType, dealerTier };
}

export function getNextRoundState({ dealerId, dealerRun, outcome, winnerId }) {
  getDealerTier(dealerRun);
  if (outcome === 'draw') return { dealerId, dealerRun };
  if (outcome !== 'win' || !winnerId) throw new Error('本局结果无效');
  return winnerId === dealerId
    ? { dealerId, dealerRun: dealerRun + 1 }
    : { dealerId: winnerId, dealerRun: 1 };
}
