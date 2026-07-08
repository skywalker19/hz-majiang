# Hangzhou Mahjong Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first, browser-persisted Hangzhou Mahjong table assistant that guides seating and dealing, calculates each round, and atomically settles scores with dealer transitions.

**Architecture:** Use a dependency-free ES-module single-page application. Keep scoring/dealer rules, dealing geometry, persistent match state, and DOM rendering in separate modules; store one validated match snapshot in `localStorage` and keep reversible round snapshots in history.

**Tech Stack:** HTML5, modern CSS, vanilla JavaScript ES modules, Node.js built-in test runner, local static HTTP server, browser interaction QA.

## Global Constraints

- Four fixed physical seats: top, right, bottom, left; players never move when the dealer changes.
- White Dragon is the fixed wildcard; the app does not track individual tiles or analyze hands.
- Dealer scale is `平庄 ×2`, `一老 ×4`, `二老及以上 ×8`.
- A dealer win increments consecutive dealer rounds; a non-dealer winner becomes the next dealer at `平庄`; a draw changes neither score, dealer, nor consecutive dealer rounds.
- Kong actions do not score separately; only the final win type scores.
- Three-meld liability is configured before the match and defaults on.
- The application is local-only, mobile-first, accessible, and restores the active match after refresh.

---

## File Map

- `index.html` — semantic shell for setup, table dashboard, drawers, dialogs, and toast region.
- `styles.css` — visual tokens, physical table layout, responsive states, focus states, and reduced motion.
- `js/rules.js` — win-type catalog, dealer labels/multipliers, scoring preview, and next-dealer transition.
- `js/dealing.js` — physical seat ordering, dice wall selection, and human-readable dealing instructions.
- `js/state.js` — match creation/validation, local persistence, atomic settlement, undo, and reset.
- `js/app.js` — DOM binding, screen rendering, drawer/dialog behavior, and user input validation.
- `tests/rules.test.js` — scoring and dealer-transition coverage.
- `tests/dealing.test.js` — all dealer positions and dice totals 2–12.
- `tests/state.test.js` — settlement, persistence adapter, draw, liability, and undo coverage.
- `package.json` — ES-module mode and `node --test` command.

---

### Task 1: Rules and Scoring Engine

**Files:**
- Create: `package.json`
- Create: `js/rules.js`
- Create: `tests/rules.test.js`

**Interfaces:**
- Produces: `WIN_TYPES`, `getDealerTier(dealerRun)`, `calculateSettlement(input)`, and `getNextRoundState(input)`.
- `calculateSettlement` consumes `{ players, dealerId, dealerRun, baseScore, winnerId, winTypeId, liablePlayerId }` and returns `{ deltas, details, totalWon, winType, dealerTier }`.
- `getNextRoundState` consumes `{ dealerId, dealerRun, outcome, winnerId }` and returns `{ dealerId, dealerRun }`.

- [ ] **Step 1: Add Node module/test configuration**

```json
{
  "name": "hangzhou-mahjong-assistant",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write scoring and transition tests**

Create `tests/rules.test.js` with cases asserting:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSettlement, getDealerTier, getNextRoundState } from '../js/rules.js';

const players = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('dealer tiers are 平庄 ×2, 一老 ×4, 二老 ×8 capped', () => {
  assert.deepEqual(getDealerTier(1), { label: '平庄', multiplier: 2 });
  assert.deepEqual(getDealerTier(2), { label: '一老', multiplier: 4 });
  assert.deepEqual(getDealerTier(3), { label: '二老', multiplier: 8 });
  assert.deepEqual(getDealerTier(9), { label: '二老', multiplier: 8 });
});

test('non-dealer plain win charges dealer by tier and other players ×1', () => {
  const result = calculateSettlement({ players, dealerId: 'a', dealerRun: 2, baseScore: 1, winnerId: 'b', winTypeId: 'plain', liablePlayerId: null });
  assert.deepEqual(result.deltas, { a: -4, b: 6, c: -1, d: -1 });
});

test('dealer explosive-pair win multiplies type ×2 by tier ×4', () => {
  const result = calculateSettlement({ players, dealerId: 'a', dealerRun: 2, baseScore: 1, winnerId: 'a', winTypeId: 'baotou', liablePlayerId: null });
  assert.deepEqual(result.deltas, { a: 24, b: -8, c: -8, d: -8 });
});

test('liability moves the normal total to one payer', () => {
  const result = calculateSettlement({ players, dealerId: 'a', dealerRun: 2, baseScore: 1, winnerId: 'b', winTypeId: 'plain', liablePlayerId: 'c' });
  assert.deepEqual(result.deltas, { a: 0, b: 6, c: -6, d: 0 });
});

test('dealer win increments run, non-dealer win resets it, draw preserves it', () => {
  assert.deepEqual(getNextRoundState({ dealerId: 'a', dealerRun: 1, outcome: 'win', winnerId: 'a' }), { dealerId: 'a', dealerRun: 2 });
  assert.deepEqual(getNextRoundState({ dealerId: 'a', dealerRun: 2, outcome: 'win', winnerId: 'c' }), { dealerId: 'c', dealerRun: 1 });
  assert.deepEqual(getNextRoundState({ dealerId: 'a', dealerRun: 2, outcome: 'draw', winnerId: null }), { dealerId: 'a', dealerRun: 2 });
});
```

- [ ] **Step 3: Run the tests and confirm the missing-module failure**

Run: `npm test`

Expected: FAIL because `js/rules.js` does not exist.

- [ ] **Step 4: Implement rule constants and pure functions**

Create `js/rules.js` with:

```js
export const WIN_TYPES = [
  ['plain', '平胡', 1], ['sevenPairs', '七对', 2], ['baotou', '爆头', 2], ['kongDraw', '杠开', 2],
  ['luxuryPairs', '豪华七对', 4], ['caipiao', '财飘', 4], ['kongBaotou', '杠爆', 4],
  ['doubleLuxuryPairs', '双豪华七对', 8], ['kongPiao', '杠飘', 8], ['piaoKong', '飘杠', 8],
  ['tripleLuxuryPairs', '三豪华七对', 16], ['doubleCaipiao', '双财飘', 16]
].map(([id, label, multiplier]) => ({ id, label, multiplier }));

export function getDealerTier(dealerRun) {
  if (!Number.isInteger(dealerRun) || dealerRun < 1) throw new Error('连庄局数必须至少为 1');
  if (dealerRun === 1) return { label: '平庄', multiplier: 2 };
  if (dealerRun === 2) return { label: '一老', multiplier: 4 };
  return { label: '二老', multiplier: 8 };
}

export function calculateSettlement(input) {
  const { players, dealerId, dealerRun, baseScore, winnerId, winTypeId, liablePlayerId = null } = input;
  const ids = players.map(({ id }) => id);
  if (ids.length !== 4 || new Set(ids).size !== 4) throw new Error('必须有四名不同的玩家');
  if (!ids.includes(dealerId) || !ids.includes(winnerId)) throw new Error('庄家或胡家无效');
  if (!(Number(baseScore) > 0)) throw new Error('底分必须大于 0');
  if (liablePlayerId === winnerId || (liablePlayerId && !ids.includes(liablePlayerId))) throw new Error('承包者无效');
  const winType = WIN_TYPES.find(({ id }) => id === winTypeId);
  if (!winType) throw new Error('胡牌方式无效');
  const dealerTier = getDealerTier(dealerRun);
  const deltas = Object.fromEntries(ids.map((id) => [id, 0]));
  const details = [];
  let totalWon = 0;
  for (const loserId of ids.filter((id) => id !== winnerId)) {
    const relationMultiplier = loserId === dealerId || winnerId === dealerId ? dealerTier.multiplier : 1;
    const amount = Number(baseScore) * winType.multiplier * relationMultiplier;
    totalWon += amount;
    details.push({ loserId, amount, relationMultiplier });
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
  if (outcome === 'draw') return { dealerId, dealerRun };
  if (outcome !== 'win' || !winnerId) throw new Error('本局结果无效');
  return winnerId === dealerId ? { dealerId, dealerRun: dealerRun + 1 } : { dealerId: winnerId, dealerRun: 1 };
}
```

- [ ] **Step 5: Run and commit the scoring engine**

Run: `npm test`

Expected: all tests pass.

Commit: `git add package.json js/rules.js tests/rules.test.js && git commit -m "feat: add Hangzhou scoring rules"`

---

### Task 2: Match State, Persistence, Settlement, and Undo

**Files:**
- Create: `js/state.js`
- Create: `tests/state.test.js`

**Interfaces:**
- Consumes: `calculateSettlement` and `getNextRoundState` from `js/rules.js`.
- Produces: `createMatch(config)`, `settleRound(match, roundInput)`, `undoLastRound(match)`, `createStorage(storage)`, and `validateMatch(match)`.

- [ ] **Step 1: Write state tests**

Cover these exact assertions in `tests/state.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, settleRound, undoLastRound, createStorage } from '../js/state.js';

const config = { names: ['阿青', '阿福', '小杭', '老周'], dealerSeat: 'top', baseScore: 1, liabilityEnabled: true };

test('creates a zero-sum match with four fixed seats', () => {
  const match = createMatch(config);
  assert.deepEqual(match.players.map((p) => p.seat), ['top', 'right', 'bottom', 'left']);
  assert.equal(match.players.reduce((sum, p) => sum + p.score, 0), 0);
  assert.equal(match.dealerRun, 1);
});

test('settles a win atomically and undo restores the exact snapshot', () => {
  const initial = createMatch(config);
  const winnerId = initial.players[1].id;
  const settled = settleRound(initial, { outcome: 'win', winnerId, winTypeId: 'plain', liablePlayerId: null });
  assert.equal(settled.dealerId, winnerId);
  assert.equal(settled.dealerRun, 1);
  assert.equal(settled.roundNumber, 2);
  assert.deepEqual(undoLastRound(settled), initial);
});

test('draw records history but preserves scores, dealer, and run', () => {
  const initial = createMatch(config);
  const settled = settleRound(initial, { outcome: 'draw', winnerId: null, winTypeId: null, liablePlayerId: null });
  assert.deepEqual(settled.players, initial.players);
  assert.equal(settled.dealerId, initial.dealerId);
  assert.equal(settled.dealerRun, initial.dealerRun);
  assert.equal(settled.history.length, 1);
});

test('storage adapter saves, loads, and clears JSON', () => {
  const memory = new Map();
  const storage = createStorage({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) });
  const match = createMatch(config);
  storage.save(match);
  assert.deepEqual(storage.load(), match);
  storage.clear();
  assert.equal(storage.load(), null);
});
```

- [ ] **Step 2: Verify the missing-module failure**

Run: `npm test`

Expected: FAIL because `js/state.js` does not exist.

- [ ] **Step 3: Implement immutable state operations**

Create `js/state.js` with fixed `SEATS = ['top', 'right', 'bottom', 'left']`, deterministic IDs `player-top` through `player-left`, schema version `1`, a local storage key `hangzhou-mahjong-match-v1`, JSON-cloned snapshots, and these rules:

```js
import { calculateSettlement, getNextRoundState } from './rules.js';

export const SEATS = ['top', 'right', 'bottom', 'left'];
export const STORAGE_KEY = 'hangzhou-mahjong-match-v1';
const clone = (value) => structuredClone(value);

export function createMatch({ names, dealerSeat, baseScore, liabilityEnabled }) {
  const cleanNames = names.map((name) => String(name).trim());
  if (cleanNames.length !== 4 || cleanNames.some((name) => !name) || new Set(cleanNames).size !== 4) throw new Error('请输入四个不同的玩家姓名');
  if (!SEATS.includes(dealerSeat)) throw new Error('请选择首局庄家');
  if (!(Number(baseScore) > 0)) throw new Error('底分必须大于 0');
  const players = SEATS.map((seat, index) => ({ id: `player-${seat}`, seat, name: cleanNames[index], score: 0 }));
  return { version: 1, players, dealerId: `player-${dealerSeat}`, dealerRun: 1, baseScore: Number(baseScore), liabilityEnabled: Boolean(liabilityEnabled), roundNumber: 1, history: [], startedAt: new Date().toISOString() };
}

export function settleRound(match, roundInput) {
  validateMatch(match);
  const before = clone(match);
  let deltas = Object.fromEntries(match.players.map(({ id }) => [id, 0]));
  let calculation = null;
  if (roundInput.outcome === 'win') {
    calculation = calculateSettlement({ ...match, ...roundInput });
    deltas = calculation.deltas;
  } else if (roundInput.outcome !== 'draw') {
    throw new Error('本局结果无效');
  }
  const next = getNextRoundState({ dealerId: match.dealerId, dealerRun: match.dealerRun, ...roundInput });
  const players = match.players.map((player) => ({ ...player, score: player.score + deltas[player.id] }));
  const historyEntry = { roundNumber: match.roundNumber, settledAt: new Date().toISOString(), input: clone(roundInput), before, deltas, calculation };
  return { ...match, players, ...next, roundNumber: match.roundNumber + 1, history: [...match.history, historyEntry] };
}

export function undoLastRound(match) {
  validateMatch(match);
  if (!match.history.length) throw new Error('还没有可撤销的牌局');
  return clone(match.history.at(-1).before);
}

export function validateMatch(match) {
  if (!match || match.version !== 1 || match.players?.length !== 4 || !match.players.some((p) => p.id === match.dealerId)) throw new Error('牌局数据已损坏');
  return true;
}

export function createStorage(storage = localStorage) {
  return {
    save(match) { validateMatch(match); storage.setItem(STORAGE_KEY, JSON.stringify(match)); },
    load() { const raw = storage.getItem(STORAGE_KEY); if (!raw) return null; const parsed = JSON.parse(raw); validateMatch(parsed); return parsed; },
    clear() { storage.removeItem(STORAGE_KEY); }
  };
}
```

- [ ] **Step 4: Run and commit state tests**

Run: `npm test`

Expected: all rule and state tests pass.

Commit: `git add js/state.js tests/state.test.js && git commit -m "feat: add persistent match state"`

---

### Task 3: Dice and Dealing Geometry

**Files:**
- Create: `js/dealing.js`
- Create: `tests/dealing.test.js`

**Interfaces:**
- Consumes: physical seat names only.
- Produces: `TURN_ORDER`, `getRelativeSeats(dealerSeat)`, and `getDealGuide({ dealerSeat, dieOne, dieTwo })`.

- [ ] **Step 1: Write complete dealing expectations**

Create tests that loop every dealer seat and total 2–12, asserting the opening seat index is `(dealerIndex + total - 1) % 4`, the count direction is right-to-left, the skipped stack count equals the total, and deal order begins with the dealer. Also assert invalid dice values 0, 7, and fractional values throw.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TURN_ORDER, getDealGuide } from '../js/dealing.js';

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
    });
  }
}

test('rejects invalid dice', () => {
  assert.throws(() => getDealGuide({ dealerSeat: 'top', dieOne: 0, dieTwo: 2 }));
  assert.throws(() => getDealGuide({ dealerSeat: 'top', dieOne: 7, dieTwo: 2 }));
  assert.throws(() => getDealGuide({ dealerSeat: 'top', dieOne: 1.5, dieTwo: 2 }));
});
```

- [ ] **Step 2: Run the failing dealing tests**

Run: `npm test`

Expected: FAIL because `js/dealing.js` does not exist.

- [ ] **Step 3: Implement dealing calculation**

```js
export const TURN_ORDER = ['top', 'right', 'bottom', 'left'];

export function getRelativeSeats(dealerSeat) {
  const index = TURN_ORDER.indexOf(dealerSeat);
  if (index < 0) throw new Error('庄家座位无效');
  return { dealer: dealerSeat, next: TURN_ORDER[(index + 1) % 4], opposite: TURN_ORDER[(index + 2) % 4], previous: TURN_ORDER[(index + 3) % 4] };
}

export function getDealGuide({ dealerSeat, dieOne, dieTwo }) {
  for (const die of [dieOne, dieTwo]) if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error('骰子点数必须是 1 到 6 的整数');
  const total = dieOne + dieTwo;
  const dealerIndex = TURN_ORDER.indexOf(dealerSeat);
  if (dealerIndex < 0) throw new Error('庄家座位无效');
  const openingSeat = TURN_ORDER[(dealerIndex + total - 1) % 4];
  return { dealerSeat, dieOne, dieTwo, total, openingSeat, skippedStacks: total, wallCountDirection: 'right-to-left', dealOrder: Array.from({ length: 4 }, (_, i) => TURN_ORDER[(dealerIndex + i) % 4]), finalCounts: { dealer: 14, others: 13 } };
}
```

- [ ] **Step 4: Run and commit dealing tests**

Run: `npm test`

Expected: all tests pass.

Commit: `git add js/dealing.js tests/dealing.test.js && git commit -m "feat: add dice dealing guide"`

---

### Task 4: Semantic Application Shell

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes IDs and data attributes used by `js/app.js`.
- Produces setup screen, dashboard, table seats, action bar, deal drawer, settlement drawer, history drawer, reset dialog, and live region.

- [ ] **Step 1: Build the full HTML structure**

Create a Chinese-language document with `viewport-fit=cover`, link `styles.css`, and load `js/app.js` as a module. Include:

- `#setup-view` with four inputs named `player-top`, `player-right`, `player-bottom`, `player-left`, four dealer radio buttons, numeric `#base-score`, checked `#liability-enabled`, inline `#setup-error`, and `#start-match`.
- `#dashboard-view[hidden]` with `#round-label`, `#dealer-tier`, four `[data-seat]` player cards, central dealer marker, `#open-deal-guide`, `#open-settlement`, `#open-history`, and `#open-reset`.
- `#deal-drawer` containing six face buttons for each die, `#dice-total`, `#opening-wall-result`, `#deal-steps`, and close button.
- `#settlement-drawer` containing win/draw controls, winner buttons, win-type grid, liability controls, four-row preview, error text, and `#confirm-settlement`.
- `#history-drawer` containing `#history-list`, `#undo-round`, and close button.
- Native `<dialog id="reset-dialog">` with cancel and confirm controls.
- `<div id="toast" role="status" aria-live="polite">`.

Use real Chinese copy: “摆好四个人的位置”, “发牌向导”, “结束本局”, “确认结算并开下一局”, “撤销上一局”, and “重新开一场”.

- [ ] **Step 2: Verify document semantics**

Run: `python3 -m http.server 8000`

Open: `http://127.0.0.1:8000/`

Expected: the setup form renders as unstyled semantic content, all labels are associated with inputs, drawers and dashboard are hidden, and there are no missing-element errors before `app.js` exists.

- [ ] **Step 3: Commit the shell**

Commit: `git add index.html && git commit -m "feat: add semantic application shell"`

---

### Task 5: Application Controller and Complete Interaction Flow

**Files:**
- Create: `js/app.js`

**Interfaces:**
- Consumes all public functions from `rules.js`, `dealing.js`, and `state.js` plus DOM IDs from `index.html`.
- Produces a working setup, dashboard, dealing guide, settlement preview/confirmation, history, undo, reset, and refresh recovery flow.

- [ ] **Step 1: Implement bootstrap and rendering helpers**

At module load, create the storage adapter, attempt `load()` inside `try/catch`, render setup when no match exists, and render dashboard when one exists. A corrupt load must show “本机保存的牌局无法读取，请重新开一场” without overwriting storage.

Implement focused helpers:

```js
const seatName = { top: '上方', right: '右方', bottom: '下方', left: '左方' };
function playerById(id) { return match.players.find((player) => player.id === id); }
function renderDashboard() {
  const tier = getDealerTier(match.dealerRun);
  document.getElementById('round-label').textContent = `第 ${match.roundNumber} 局`;
  document.getElementById('dealer-tier').textContent = `${playerById(match.dealerId).name} · ${tier.label} ×${tier.multiplier}`;
  for (const player of match.players) {
    const card = document.querySelector(`[data-seat="${player.seat}"]`);
    card.querySelector('[data-player-name]').textContent = player.name;
    card.querySelector('[data-player-score]').textContent = `${player.score >= 0 ? '+' : ''}${player.score}`;
    card.classList.toggle('is-dealer', player.id === match.dealerId);
  }
  document.querySelector('[data-history-count]').textContent = String(match.history.length);
}
let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}
function openDrawer(id) { document.getElementById(id).hidden = false; }
function closeDrawer(id) { document.getElementById(id).hidden = true; }
```

- [ ] **Step 2: Implement setup submission**

Collect names in physical seat order, checked dealer seat, base score, and liability toggle. Call `createMatch`, save, switch views, and render. Catch validation errors and place their Chinese messages in `#setup-error`.

- [ ] **Step 3: Implement dice guide interaction**

Keep local `dieOne` and `dieTwo`, default both to 1, render selected faces, call `getDealGuide`, add `.is-opening-wall` to the opening player card and `.is-dealer` to the dealer card inside the drawer, and produce instructions such as “从阿福面前的牌墙开门，从右往左数过 8 墩，从下一墩开始拿牌。”

- [ ] **Step 4: Implement settlement state and preview**

Keep a draft `{ outcome: 'win', winnerId: null, winTypeId: 'plain', liable: false, liablePlayerId: null }`. Render winner and liability buttons from current players and win types from `WIN_TYPES`. For a valid win, call `calculateSettlement`; for a draw, preview four zero deltas. Show each player's signed delta and a readable formula. Disable confirmation while the draft is invalid.

- [ ] **Step 5: Implement atomic confirmation, history, undo, and reset**

On confirmation, call `settleRound`, save, close drawer, render the new round, and announce either “已结算，阿福接庄” or “已结算，阿青进入一老”. Render history newest-first with result, type, before/after dealer tier, and four deltas. Undo after a `confirm()` call, save restored state, and rerender. Reset only after native dialog confirmation; clear storage, reset in-memory state, and return to setup.

- [ ] **Step 6: Run tests and manually exercise behavior**

Run: `npm test`

Expected: all tests pass.

Manual sequence: create four players, settle a non-dealer plain win, settle a dealer baotou win, settle a draw, refresh, inspect history, undo the draw, and verify exact scores/dealer/tier after each step.

- [ ] **Step 7: Commit interactions**

Commit: `git add js/app.js && git commit -m "feat: add match interaction flow"`

---

### Task 6: Mahjong Table Visual System and Responsive Layout

**Files:**
- Create: `styles.css`

**Interfaces:**
- Consumes semantic classes/attributes from `index.html` and state classes from `app.js`.
- Produces the final mobile/tablet/desktop visual presentation.

- [ ] **Step 1: Define intentional design tokens**

Use these palette roles: table felt `#0B5A4A`, deep rail `#073D35`, ivory tile `#FFF9E8`, warm tile edge `#D7C99E`, cinnabar dealer `#D94836`, ink `#18332E`, muted jade `#9BC7B8`. Use a Chinese system sans stack for body and `STKaiti, KaiTi, serif` only for large single-character tile marks.

- [ ] **Step 2: Build setup and dashboard layouts**

Use a centered application frame, safe-area padding, and a square `.mahjong-table` whose four player cards occupy physical edges. The table surface must remain square on phones, player names must ellipsize safely, scores must use tabular numerals, and the dealer marker must visibly attach to the correct player without changing layout.

- [ ] **Step 3: Style controls and drawers**

Provide 44px minimum touch targets, strong `:focus-visible` rings, segmented outcome controls, tile-like win type buttons, a sticky settlement confirmation footer, and bottom drawers that become side panels above 900px. Reserve red for dealer/danger/final confirmation and use green/ink for ordinary actions.

- [ ] **Step 4: Add restrained motion and accessibility fallbacks**

Animate only drawer entry, score update, and dealer marker transfer. Under `@media (prefers-reduced-motion: reduce)`, remove nonessential transitions and animations. Ensure hidden content uses the `hidden` attribute and add high-contrast states that do not rely on color alone.

- [ ] **Step 5: Inspect at target sizes and commit**

Inspect at 390×844, 430×932, 768×1024, and 1280×900. Confirm no horizontal scrolling, no overlap between table/player cards, readable formulas, and reachable drawer confirmation buttons.

Commit: `git add styles.css && git commit -m "feat: style the mahjong table assistant"`

---

### Task 7: Browser QA and Quality Fixes

**Files:**
- Verify: `index.html`, `styles.css`, `js/app.js`, `js/rules.js`, `js/dealing.js`, `js/state.js`, `tests/rules.test.js`, `tests/dealing.test.js`, `tests/state.test.js`

**Interfaces:**
- Consumes the complete application.
- Produces a verified release candidate with no known critical flow or layout defects.

- [ ] **Step 1: Run all deterministic tests**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Start the local app and complete the primary browser flow**

Run: `python3 -m http.server 8000`

At 390×844, complete: setup four named seats → open dice guide with 3+5 → verify highlighted wall and 8 skipped stacks → settle a non-dealer plain win → confirm new dealer is the winner at 平庄 → settle dealer baotou → confirm 一老 → record draw → confirm tier unchanged → refresh → verify restored state → undo draw.

- [ ] **Step 3: Exercise liability and boundary values**

Start a new match with liability enabled. Settle an 一老 non-dealer win with liability and verify only one payer loses the sum. Repeat with liability disabled and verify controls are absent. Exercise bottom score 0 rejection, duplicate names, long names, negative cumulative scores, two-old cap, and empty history undo.

- [ ] **Step 4: Visual and accessibility inspection**

Capture setup, active dashboard, deal drawer, settlement preview, and history at mobile size plus active dashboard at desktop size. Check focus order with keyboard only, Escape/close behavior, visible focus, contrast, reduced motion, no clipped text, and no horizontal overflow.

- [ ] **Step 5: Fix findings and rerun the affected checks**

For each defect, make the smallest scoped source change, rerun `npm test`, and repeat the browser step that exposed it. Stop only when the primary flow, liability flow, refresh/undo, and target screenshots have no known blocking or high-severity issue.

- [ ] **Step 6: Final commit**

Commit: `git add index.html styles.css js tests package.json && git commit -m "fix: polish verified mahjong assistant flows"`
