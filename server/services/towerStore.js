// Persists the "TOBZ TOWER" state — the permanent stack of blocks built by
// followers, plus the running follower count driving it. Kept separate from
// followerStore.js (the main counter's state) since the tower can, in
// principle, run against a different provider/count later.
const storage = require('./storage');

const KEY = 'tower_state';

const DEFAULTS = {
  // Each block: { id, index, kind: 'normal'|'special'|'rare'|'legendary', username: string|null, createdAt }
  blocks: [],
  followerCount: 0,
  // Once a block's index falls below this, it's rendered as part of a
  // compacted "floor" slab instead of an individual mesh (see Phase 8).
  compactedThroughIndex: 0,
};

async function getState() {
  const stored = await storage.get(KEY, null);
  return { ...DEFAULTS, ...(stored || {}) };
}

async function setState(partial) {
  const current = await getState();
  const next = { ...current, ...partial };
  await storage.set(KEY, next);
  return next;
}

async function addBlock({ kind = 'normal', username = null } = {}) {
  const state = await getState();
  const block = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    index: state.blocks.length,
    kind,
    username,
    createdAt: Date.now(),
  };
  const blocks = [...state.blocks, block];
  return setState({ blocks, followerCount: state.followerCount + 1 });
}

async function reset() {
  comboCount = 0;
  comboLastAt = 0;
  return setState({ blocks: [], followerCount: 0, compactedThroughIndex: 0 });
}

// Automatic block rarity: every 10th follower is "special", every 100th is
// "rare", every 1000th is "legendary" — 1000 wins out over 100 wins out
// over 10 since a legendary block is also, technically, a 10th and 100th.
function tierForCount(n) {
  if (n > 0 && n % 1000 === 0) return 'legendary';
  if (n > 0 && n % 100 === 0) return 'rare';
  if (n > 0 && n % 10 === 0) return 'special';
  return 'normal';
}

// Follow-combo tracking: consecutive follows landing within COMBO_WINDOW_MS
// of each other build a combo streak; a gap longer than that resets it back
// to 1. In-memory only (not persisted) — a combo streak is a live-moment
// celebration, not tower state that needs to survive a restart.
const COMBO_WINDOW_MS = 4000;
const COMBO_THRESHOLDS = [2, 5, 10, 25, 50];
let comboCount = 0;
let comboLastAt = 0;

function registerFollowForCombo(now = Date.now()) {
  comboCount = now - comboLastAt <= COMBO_WINDOW_MS ? comboCount + 1 : 1;
  comboLastAt = now;
  return COMBO_THRESHOLDS.includes(comboCount) ? comboCount : null;
}

module.exports = {
  getState,
  setState,
  addBlock,
  reset,
  tierForCount,
  registerFollowForCombo,
  DEFAULTS,
};
