import { getDealerTier } from './rules.js';

const FUN_PREFERENCE_KEY = 'hangzhou-mahjong-v4-fun';
const TABLE_EFFECTS = {
  win: { duration: 2200, particles: 10, rings: 1 },
  one: { duration: 2600, particles: 12, rings: 1 },
  two: { duration: 3000, particles: 18, rings: 2 },
  three: { duration: 3400, particles: 24, rings: 3 },
  draw: { duration: 2000, particles: 0, rings: 0 },
};

export function getRoundCelebration(entry, nextMatch) {
  if (entry.input.outcome === 'draw') {
    return { stamp: '流', title: '歇一歇，再开局', note: '庄家和老数保持不变', kind: 'draw', effect: 'draw' };
  }
  const sameDealer = entry.before.dealerId === nextMatch.dealerId;
  const before = getDealerTier(entry.before.dealerRun);
  const next = getDealerTier(nextMatch.dealerRun);
  if (sameDealer && next.multiplier > before.multiplier) {
    const titles = { '一老': '一老坐稳了！', '二老': '二老手气旺！', '三老': '三老出山！' };
    const effects = { '一老': 'one', '二老': 'two', '三老': 'three' };
    return { stamp: next.label, title: titles[next.label], note: `${next.label} · 庄家 ×${next.multiplier}`, kind: 'promotion', effect: effects[next.label] };
  }
  return { stamp: '胡', title: '胡啦，这把漂亮！', note: sameDealer ? `连庄继续 · ${next.label}` : '好牌配好手，下一局继续', kind: 'win', effect: 'win' };
}

// Presentation consumes an already saved settlement. It never changes scores,
// dealer progression or the confirmation flow.
export function createTableFun({ scope = window } = {}) {
  const doc = scope.document;
  const panel = doc.querySelector('#round-celebration');
  const particleLayer = panel?.querySelector('.effect-particles');
  const ringLayer = panel?.querySelector('.effect-rings');
  const media = scope.matchMedia?.('(prefers-reduced-motion: reduce)');
  const later = scope.setTimeout.bind(scope);
  const clear = scope.clearTimeout.bind(scope);
  const score = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
  let enabled = true;
  let timers = [];
  try {
    const saved = scope.localStorage.getItem(FUN_PREFERENCE_KEY);
    if (saved !== null) enabled = saved !== 'false';
  } catch { /* the preference can remain local to this page */ }

  function dismiss() {
    timers.forEach(clear);
    timers = [];
    if (panel) panel.hidden = true;
    particleLayer?.replaceChildren();
    ringLayer?.replaceChildren();
    doc.querySelectorAll('.score-bump, .dealer-promoted').forEach((element) => {
      element.classList.remove('score-bump', 'dealer-promoted');
    });
  }

  function synchronize() {
    doc.body.dataset.fun = enabled ? 'on' : 'off';
    doc.querySelectorAll('[data-fun-toggle]').forEach((input) => { input.checked = enabled; });
    doc.querySelectorAll('[data-fun-state]').forEach((label) => {
      label.textContent = enabled ? '已开启 · 胡牌与连庄结算特效' : '已关闭 · 结算时不自动播放';
    });
  }

  doc.querySelectorAll('[data-fun-toggle]').forEach((input) => input.addEventListener('change', () => {
    enabled = input.checked;
    try { scope.localStorage.setItem(FUN_PREFERENCE_KEY, String(enabled)); }
    catch { /* disabled storage must not block the switch */ }
    dismiss();
    synchronize();
  }));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) dismiss(); });
  scope.addEventListener('pagehide', dismiss);
  media?.addEventListener?.('change', () => { if (media.matches) dismiss(); });
  doc.querySelectorAll('[data-preview-effect]').forEach((button) => button.addEventListener('click', () => preview(button.dataset.previewEffect)));
  synchronize();

  function showEffect(copy, { detail, scoreText = '', previewing = false }) {
    dismiss();
    if (!panel) return;
    const profile = TABLE_EFFECTS[copy.effect];
    if (!profile) return;
    const duration = media?.matches ? 2200 : profile.duration;
    panel.dataset.kind = copy.kind;
    panel.dataset.effect = copy.effect;
    panel.style.setProperty('--effect-lifetime', `${duration}ms`);
    panel.querySelector('[data-celebration-stamp]').textContent = copy.stamp;
    panel.querySelector('[data-celebration-title]').textContent = copy.title;
    panel.querySelector('[data-celebration-detail]').textContent = detail;
    const amount = panel.querySelector('[data-celebration-score]');
    amount.hidden = !scoreText;
    amount.textContent = scoreText;
    panel.querySelector('[data-celebration-note]').textContent = copy.note;
    panel.querySelector('[data-effect-preview-label]').hidden = !previewing;
    if (!media?.matches) {
      for (let index = 0; ringLayer && index < profile.rings; index += 1) {
        const ring = doc.createElement('i');
        ring.className = 'effect-ring';
        ring.style.setProperty('--ring-index', String(index));
        ringLayer.append(ring);
      }
      const radius = Math.min(scope.innerWidth || 390, 480) * .43;
      for (let index = 0; particleLayer && index < profile.particles; index += 1) {
        const angle = index / profile.particles * Math.PI * 2;
        const particle = doc.createElement('span');
        const tile = index % 3 === 0;
        particle.className = `effect-particle${tile ? ' effect-particle--tile' : ''}`;
        particle.textContent = tile ? ['中', '发', '白'][Math.floor(index / 3) % 3] : '';
        particle.style.setProperty('--particle-x', `${Math.cos(angle) * radius}px`);
        particle.style.setProperty('--particle-y', `${Math.sin(angle) * radius * .75}px`);
        particle.style.setProperty('--particle-spin', `${index % 2 ? 120 : -120}deg`);
        particle.style.setProperty('--particle-delay', `${120 + (index % 5) * 35}ms`);
        particleLayer.append(particle);
      }
    }
    panel.hidden = false;
    // Restart when the same preview is tapped again before its animation ends.
    try { (panel.getAnimations?.({ subtree: true }) || []).forEach((animation) => { animation.currentTime = 0; animation.play(); }); }
    catch { /* CSS still supplies the first play on older engines */ }
    timers.push(later(dismiss, duration));
  }

  function preview(effect) {
    if (!['win', 'one', 'two', 'three'].includes(effect)) return;
    const tierRun = { one: 2, two: 3, three: 4 }[effect];
    const tier = tierRun ? getDealerTier(tierRun) : null;
    const titles = { win: '胡啦，这把漂亮！', one: '一老坐稳了！', two: '二老手气旺！', three: '三老出山！' };
    showEffect({ effect, stamp: tier?.label || '胡', title: titles[effect],
      kind: tier ? 'promotion' : 'win', note: tier ? `${tier.label} · 庄家 ×${tier.multiplier}` : '红印落牌，开胡喝彩',
    }, { detail: '看看这档效果', previewing: true });
  }

  function celebrate(entry, nextMatch) {
    dismiss();
    if (!enabled || !panel) return;
    const copy = getRoundCelebration(entry, nextMatch);
    const winner = nextMatch.players.find(({ id }) => id === entry.input.winnerId);
    showEffect(copy, {
      detail: winner ? `${winner.name} · ${entry.calculation.winType.label}` : `第 ${entry.roundNumber} 局已记录`,
      scoreText: winner ? `+${score.format(entry.deltas[winner.id])} 分` : '',
    });
    if (!media?.matches) {
      nextMatch.players.forEach((player) => {
        if (entry.deltas[player.id]) doc.querySelector(`[data-seat="${player.seat}"] .player-score`)?.classList.add('score-bump');
      });
      if (copy.kind === 'promotion') {
        const dealer = nextMatch.players.find(({ id }) => id === nextMatch.dealerId);
        doc.querySelector(`[data-seat="${dealer.seat}"]`)?.classList.add('dealer-promoted');
      }
    }
  }

  return {
    celebrate,
    preview,
    dismiss,
    refreshControls: synchronize,
    get enabled() { return enabled; },
    describeTable(match) {
      if (!match) return '四个人，一桌好牌';
      const tier = getDealerTier(match.dealerRun);
      return { '平庄': '牌桌已摆好，等你开胡', '一老': '庄家坐稳了，好戏继续', '二老': '二老手气旺，牌桌正热闹', '三老': '三老出山，看谁来接庄' }[tier.label];
    },
  };
}
