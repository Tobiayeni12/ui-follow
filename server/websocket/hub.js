// Lightweight pub/sub WebSocket hub. Two logical channels:
//   "live"    — what the public /overlay browser-source is watching.
//   "preview" — what the dashboard's embedded preview iframe is watching.
// Real TikTok updates always go to both. Dashboard "test" buttons always go
// to "preview", and only reach "live" when explicitly allowed (see
// settingsStore.allowTestOnLiveOverlay / DEMO_MODE).
const { WebSocketServer } = require('ws');

const HEARTBEAT_MS = 30000;

class Hub {
  constructor() {
    /** @type {Set<import('ws').WebSocket>} */
    this.clients = new Set();
    this.wss = null;
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      ws.channel = url.searchParams.get('channel') === 'preview' ? 'preview' : 'live';
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      this.clients.add(ws);

      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });

    this._heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {
          this.clients.delete(ws);
        }
      }
    }, HEARTBEAT_MS);
  }

  send(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /** Broadcast to a specific channel ("live" | "preview" | "all"). */
  broadcast(channel, message) {
    const payload = JSON.stringify(message);
    for (const ws of this.clients) {
      if (channel === 'all' || ws.channel === channel) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    }
  }

  clientCount(channel = 'all') {
    if (channel === 'all') return this.clients.size;
    let n = 0;
    for (const ws of this.clients) if (ws.channel === channel) n += 1;
    return n;
  }

  shutdown() {
    clearInterval(this._heartbeat);
    for (const ws of this.clients) ws.terminate();
  }
}

module.exports = new Hub();
