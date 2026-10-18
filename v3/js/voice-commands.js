import { getRelativeSeats } from './dealing.js';

const VOICE_TYPE_ALIASES = [
  ['plain', ['平胡', '平和', '普通胡']],
  ['sevenPairs', ['七对', '七对子']],
  ['baotou', ['爆头', '包头', '抱头']],
  ['kongDraw', ['杠开', '杠上开花']],
  ['luxuryPairs', ['豪华七对']],
  ['caipiao', ['财飘', '财漂']],
  ['kongBaotou', ['杠爆', '杠爆头']],
  ['doubleLuxuryPairs', ['双豪华七对', '双豪七对']],
  ['kongPiao', ['杠飘', '杠漂']],
  ['piaoKong', ['飘杠', '漂杠']],
  ['tripleLuxuryPairs', ['三豪华七对', '三豪七对']],
  ['doubleCaipiao', ['双财飘', '双财漂']],
  ['pureSuit', ['清一色']],
  ['thirteenOrphans', ['十三不靠']],
  ['allTriplets', ['碰碰胡', '碰碰和', '对对胡']],
];

export function normalizeVoiceText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/13不靠/g, '十三不靠').replace(/7对/g, '七对')
    .replace(/[，。！？、,!?;；：:]/g, ' ').replace(/\s+/g, ' ').trim();
}

function voiceNumber(token) {
  if (/^\d+$/.test(token)) return Number(token);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (token === '十') return 10;
  if (token.startsWith('十') && token.length === 2) return 10 + digits[token[1]];
  return token.length === 1 ? digits[token] : NaN;
}

function voicePlayerMentions(text, { players = [], dealerId } = {}) {
  const aliases = players.map((player) => ({ alias: normalizeVoiceText(player.name).replace(/\s/g, ''), id: player.id }));
  const seats = { top: ['上方', '上面', '上边'], right: ['右方', '右边'], bottom: ['下方', '下面', '下边'], left: ['左方', '左边'] };
  for (const player of players) {
    for (const alias of seats[player.seat] ?? []) aliases.push({ alias, id: player.id });
  }
  const dealer = players.find(({ id }) => id === dealerId);
  if (dealer) {
    const relative = getRelativeSeats(dealer.seat);
    for (const [alias, seat] of [['庄家', dealer.seat], ['下家', relative.next], ['对家', relative.opposite], ['上家', relative.previous]]) {
      aliases.push({ alias, id: players.find((player) => player.seat === seat)?.id });
    }
  }
  const mentions = [];
  for (const { alias, id } of aliases.sort((a, b) => b.alias.length - a.alias.length)) {
    if (!alias || !id) continue;
    let index = text.indexOf(alias);
    while (index !== -1) {
      const end = index + alias.length;
      if (!mentions.some((entry) => index < entry.end && end > entry.index)) mentions.push({ id, index, end });
      index = text.indexOf(alias, end);
    }
  }
  return mentions.sort((a, b) => a.index - b.index);
}

export function parseVoiceCommand(value, context = {}) {
  const text = normalizeVoiceText(value);
  const compact = text.replace(/\s/g, '');
  if (!compact) return { kind: 'unknown' };
  if (/^(?:小助手)?(?:确认(?:结算|记录|记账)?|确定(?:结算)?|记上|确认这局)$/.test(compact)) return { kind: 'confirm' };
  if (/^(?:取消(?:结算|记录)?|不要结算|先别记|不对|重来|算了)$/.test(compact)) return { kind: 'cancel' };
  if (/不要|先别|不是|不算/.test(compact)) return { kind: 'unknown' };
  if (/^(?:停止(?:对话|语音|收音)?|结束对话|关闭语音|别听了)$/.test(compact)) return { kind: 'stop' };
  if (/^(?:重听|再说一遍|重复一遍|再播报一次)$/.test(compact)) return { kind: 'repeat' };
  if (/^(?:你好|帮助|语音帮助|你会什么|怎么用|可以怎么说)$/.test(compact)) return { kind: 'help' };
  if (/(?:谁是庄家|庄家是谁|现在谁坐庄|谁坐庄|现在几老|当前庄家)/.test(compact)) return { kind: 'dealer' };
  if (/(?:分数|比分|报分|谁领先|谁赢得最多|大家多少分)/.test(compact) && !/(?:平胡|七对|清一色|胡了|和了|自摸)/.test(compact)) return { kind: 'scores' };
  if (/^(?:这局|本局)?(?:是|算)?(?:流局|荒庄)(?:了)?$/.test(compact)) return { kind: 'draw' };

  const diceText = text
    .replace(/[两二2](?:颗|个|枚)(?:骰子|色子|筛子)/g, '骰子')
    .replace(/第[一二12](?:颗|个|枚)(?:骰子|色子)?/g, ' ');
  const numberTokens = diceText.match(/\d+|[零〇一二两三四五六七八九十]+/g) ?? [];
  const diceWords = /骰|色子|筛子|摇[出了到]|掷出|点数|第[一二][颗个]|开门|起牌|抓牌|拿牌|合计.*点/.test(compact);
  const bareNumbers = /^[\d零〇一二两三四五六七八九十和加与点是个颗两\s+]+$/.test(text);
  if (diceWords || bareNumbers) {
    if (/[-负]\s*[\d一二两三四五六七八九十]|\d\.\d/.test(text)) return { kind: 'dicePrompt' };
    const doubles = compact.match(/(?:两|2)(?:个|颗)(?:骰子)?(?:都是|都|是)?([一二两三四五六1-6])(?:点)?$/);
    if (doubles) return { kind: 'dice', values: [voiceNumber(doubles[1]), voiceNumber(doubles[1])] };
    let values = numberTokens.map(voiceNumber);
    if (numberTokens.length === 1 && !/总|合计/.test(compact) && /^[1-6一二两三四五六]{2}$/.test(numberTokens[0])) {
      values = [...numberTokens[0]].map(voiceNumber);
    }
    if (values.length === 2 && values.every((number) => Number.isInteger(number) && number >= 1 && number <= 6)) {
      return { kind: 'dice', values };
    }
    if (values.length === 1 && values[0] >= 1 && values[0] <= 6 && !/总|合计/.test(compact)) return { kind: 'dicePartial', value: values[0] };
    return { kind: 'dicePrompt' };
  }

  const typeIds = [];
  let remaining = compact;
  const aliases = VOICE_TYPE_ALIASES.flatMap(([id, entries]) => entries.map((alias) => ({ id, alias }))).sort((a, b) => b.alias.length - a.alias.length);
  for (const { id, alias } of aliases) {
    if (remaining.includes(alias)) {
      if (!typeIds.includes(id)) typeIds.push(id);
      remaining = remaining.replaceAll(alias, ' '.repeat(alias.length));
    }
  }
  const mentions = voicePlayerMentions(compact, context);
  const noLiability = /没有承包|不承包|无承包|没承包/.test(compact);
  const liabilityAt = noLiability ? -1 : compact.search(/承包|包三[摊家]/);
  let liableMention = null;
  if (liabilityAt >= 0) {
    // The player immediately before “承包”, or immediately after “由…承包”.
    const before = mentions.filter((entry) => entry.end <= liabilityAt);
    liableMention = before.at(-1) ?? mentions.find((entry) => entry.index > liabilityAt) ?? null;
    // “阿青胡了，触发承包” names a winner, not a liable player.
    if (liableMention && /胡了|和了|平胡|七对|爆头/.test(compact.slice(liableMention.end, liabilityAt))) liableMention = null;
  }
  const winnerMentions = mentions.filter((entry) => entry !== liableMention);
  const winnerIds = [...new Set(winnerMentions.map(({ id }) => id))];
  const winWords = /胡了|胡牌|和了|自摸|赢了|有人胡|我胡|胡$/.test(compact);
  if (typeIds.length || winnerIds.length || winWords || liabilityAt >= 0 || noLiability) {
    if (winnerIds.length > 1) return { kind: 'ambiguousPlayer' };
    return {
      kind: 'win', winnerId: winnerIds[0] ?? null, winTypeIds: typeIds,
      liability: noLiability ? false : liabilityAt >= 0 ? true : null,
      liablePlayerId: liableMention?.id ?? null,
    };
  }
  return { kind: 'unknown' };
}
