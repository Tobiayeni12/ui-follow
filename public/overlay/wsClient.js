// Small reconnecting WebSocket wrapper. Used by the overlay (channel=live or
// preview) and reused by the dashboard for live status/preview updates.
// Automatically reconnects with exponential backoff + jitter so the overlay
// keeps working through brief backend restarts/deploys without a page reload.
export class ReconnectingSocket {
  constructor({ channel = 'live', onMessage, onOpen, onClose } = {}) {
    this.channel = channel;
    this.onMessage = onMessage || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    this.attempt = 0;
    this.closedByUser = false;
    this.socket = null;
    this._connect();
  }

  _url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws?channel=${this.channel}`;
  }

  _connect() {
    if (this.closedByUser) return;
    const socket = new WebSocket(this._url());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.onOpen();
    });

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.onMessage(msg);
      } catch {
        // ignore malformed frames
      }
    });

    const scheduleReconnect = () => {
      if (this.closedByUser) return;
      this.onClose();
      this.attempt += 1;
      const base = Math.min(30000, 1000 * 2 ** this.attempt);
      const jitter = Math.random() * 500;
      setTimeout(() => this._connect(), base + jitter);
    };

    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => socket.close());
  }

  close() {
    this.closedByUser = true;
    if (this.socket) this.socket.close();
  }
}
