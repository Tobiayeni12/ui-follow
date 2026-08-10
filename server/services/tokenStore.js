// Persists TikTok OAuth tokens server-side only. Never expose the contents
// of this store to any client-facing route.
const storage = require('./storage');

const KEY = 'tiktok_tokens';

/**
 * @returns {Promise<null | {
 *   access_token: string,
 *   refresh_token: string,
 *   open_id: string,
 *   expires_at: number,        // ms epoch
 *   refresh_expires_at: number // ms epoch
 * }>}
 */
async function getTokens() {
  return storage.get(KEY, null);
}

async function saveTokens(tokens) {
  await storage.set(KEY, tokens);
}

async function clearTokens() {
  await storage.set(KEY, null);
}

module.exports = { getTokens, saveTokens, clearTokens };
