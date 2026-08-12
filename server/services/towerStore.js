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
  return setState({ blocks: [], followerCount: 0, compactedThroughIndex: 0 });
}

module.exports = { getState, setState, addBlock, reset, DEFAULTS };
