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
  ['pureSuit', '清一色', 8],
  ['thirteenOrphans', '十三不靠', 2],
  ['allTriplets', '碰碰胡', 2],
].map(([id, label, multiplier]) => ({ id, label, multiplier }));

export function getConfiguredWinTypes(settings = null) {
  return WIN_TYPES.map((type) => {
    const configured = settings?.[type.id];
    return {
      ...type,
      enabled: configured?.enabled !== false,
      multiplier: Number(configured?.multiplier ?? type.multiplier),
    };
  });
}

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
    winTypeIds = winTypeId ? [winTypeId] : [],
    winTypeMultipliers = {},
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

  if (
    !Array.isArray(winTypeIds)
    || winTypeIds.length < 1
    || winTypeIds.length > 3
    || new Set(winTypeIds).size !== winTypeIds.length
  ) {
    throw new Error('请选择一至三种不同的胡牌方式');
  }
  const winTypes = winTypeIds.map((id) => {
    const type = WIN_TYPES.find((item) => item.id === id);
    if (!type) return null;
    const multiplier = Number(winTypeMultipliers[id] ?? type.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error('胡牌倍率必须大于 0');
    return { ...type, multiplier };
  });
  if (winTypes.some((type) => !type)) throw new Error('胡牌方式无效');
  const winMultiplier = winTypes.reduce((total, { multiplier }) => total * multiplier, 1);
  const winType = {
    id: winTypes.map(({ id }) => id).join('+'),
    label: winTypes.map(({ label }) => label).join(' + '),
    multiplier: winMultiplier,
  };

  const dealerTier = getDealerTier(dealerRun);
  const deltas = Object.fromEntries(ids.map((id) => [id, 0]));
  const details = [];
  let totalWon = 0;

  for (const loserId of ids.filter((id) => id !== winnerId)) {
    const relationMultiplier = loserId === dealerId || winnerId === dealerId
      ? dealerTier.multiplier
      : 1;
    const amount = Number(baseScore) * winMultiplier * relationMultiplier;
    totalWon += amount;
    details.push({
      loserId,
      amount,
      baseScore: Number(baseScore),
      winMultiplier,
      winTypes,
      relationMultiplier,
    });
    deltas[loserId] = -amount;
  }

  if (liablePlayerId) {
    for (const id of ids) deltas[id] = 0;
    deltas[liablePlayerId] = -totalWon;
  }
  deltas[winnerId] = totalWon;

  return { deltas, details, totalWon, winType, winTypes, dealerTier };
}

export function getNextRoundState({ dealerId, dealerRun, outcome, winnerId }) {
  getDealerTier(dealerRun);
  if (outcome === 'draw') return { dealerId, dealerRun };
  if (outcome !== 'win' || !winnerId) throw new Error('本局结果无效');
  return winnerId === dealerId
    ? { dealerId, dealerRun: dealerRun + 1 }
    : { dealerId: winnerId, dealerRun: 1 };
}
