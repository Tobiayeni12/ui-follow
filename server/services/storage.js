// Minimal key/value persistence layer with two backends:
//  - Postgres (used automatically when DATABASE_URL is set) — recommended for
//    production deployments on platforms with ephemeral filesystems.
//  - Local JSON file (default) — perfectly fine for local development and for
//    hosts that provide a persistent disk.
const fs = require('fs');
const path = require('path');
const config = require('../config');

let pool = null;
let ready = Promise.resolve();

if (config.databaseUrl) {
  // Lazily required so the "pg" module is only touched when actually needed.
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
  });
  ready = pool
    .query('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value JSONB NOT NULL)')
    .then(() => console.log('[storage] Postgres backend ready'))
    .catch((err) => {
      console.error('[storage] Failed to initialize Postgres, falling back to file storage:', err.message);
      pool = null;
    });
}

const FILE_PATH = path.join(config.dataDir, 'store.json');

function readFileStore() {
  try {
    if (!fs.existsSync(FILE_PATH)) return {};
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  } catch (err) {
    console.error('[storage] Failed to read store.json:', err.message);
    return {};
  }
}

function writeFileStore(obj) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(obj, null, 2));
}

// Serialize writes so concurrent set() calls never clobber each other.
let writeQueue = Promise.resolve();
function queuedFileWrite(mutator) {
  writeQueue = writeQueue.then(() => {
    const store = readFileStore();
    mutator(store);
    writeFileStore(store);
  }).catch((err) => console.error('[storage] write error:', err));
  return writeQueue;
}

async function get(key, defaultValue = null) {
  await ready;
  if (pool) {
    const res = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
    return res.rows[0] ? res.rows[0].value : defaultValue;
  }
  const store = readFileStore();
  return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : defaultValue;
}

async function set(key, value) {
  await ready;
  if (pool) {
    await pool.query(
      `INSERT INTO kv_store (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
      [key, JSON.stringify(value)]
    );
    return;
  }
  await queuedFileWrite((store) => {
    store[key] = value;
  });
}

module.exports = { get, set, usingPostgres: () => !!pool };
