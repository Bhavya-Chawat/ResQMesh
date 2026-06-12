/**
 * websocketService.js
 * -------------------
 * Singleton WebSocket (Socket.IO) client for ResQMesh.
 *
 * Connects to the Python Flask-SocketIO backend and forwards
 * received events to registered listeners.
 *
 * Events received from backend:
 *   topology_update   – full {nodes, edges} snapshot
 *   node_update       – {nodeId, node, timestamp}
 *   heartbeat         – {nodeId, label, timestamp, result, payload}
 *   alert             – {nodeId, label, alertType, severity, message, timestamp}
 *   node_failure      – {nodeId, label, timestamp, message}
 *   stats_update      – network health metrics object
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

class WebSocketService {
  constructor() {
    this._socket      = null;
    this._connected   = false;
    this._listeners   = new Map(); // eventName → Set<fn>
    this._reconnectMs = 3000;
    this._reconnectTimer = null;
    this._manualClose = false;
  }

  // ── Connection lifecycle ────────────────────────────────────────────

  connect() {
    if (this._socket) return;
    this._manualClose = false;

    // Dynamically import socket.io-client only when hardware mode is active
    import('socket.io-client').then(({ io }) => {
      if (this._manualClose) return;

      const socketInstance = io(BACKEND_URL, {
        transports:      ['websocket', 'polling'],
        reconnection:    true,
        reconnectionDelay: this._reconnectMs,
        timeout:         10000,
      });
      this._socket = socketInstance;

      socketInstance.on('connect', () => {
        this._connected = true;
        this._manualClose = false;
        console.info('[ResQMesh WS] Connected to backend:', BACKEND_URL);
        this._emit('_connected', { url: BACKEND_URL });

        // Request fresh state on (re)connect
        socketInstance.emit('request_topology');
        socketInstance.emit('request_stats');
      });

      socketInstance.on('disconnect', (reason) => {
        this._connected = false;
        console.warn('[ResQMesh WS] Disconnected:', reason);
        this._emit('_disconnected', { reason });
      });

      socketInstance.on('connect_error', (err) => {
        console.error('[ResQMesh WS] Connection error:', err.message);
        this._emit('_error', { message: err.message });
      });

      // Forward all backend events to registered listeners
      const backendEvents = [
        'topology_update',
        'node_update',
        'heartbeat',
        'alert',
        'node_failure',
        'stats_update',
      ];

      for (const evtName of backendEvents) {
        socketInstance.on(evtName, (data) => {
          this._emit(evtName, data);
        });
      }
    }).catch((err) => {
      console.error('[ResQMesh WS] Failed to load socket.io-client:', err);
    });
  }

  disconnect() {
    this._manualClose = true;
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }
    this._connected = false;
  }

  get isConnected() {
    return this._connected;
  }

  // ── Pub/sub API ─────────────────────────────────────────────────────

  /**
   * Register a listener for a named event.
   * @param {string} event
   * @param {function} fn
   * @returns {function} unsubscribe function
   */
  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
  }

  // ── Internal emit ───────────────────────────────────────────────────

  _emit(event, data) {
    const fns = this._listeners.get(event);
    if (fns) {
      for (const fn of fns) {
        try { fn(data); } catch (e) { console.error('[ResQMesh WS] Listener error:', e); }
      }
    }
  }

  // ── Request helpers ─────────────────────────────────────────────────

  requestTopology() {
    this._socket?.emit('request_topology');
  }

  requestStats() {
    this._socket?.emit('request_stats');
  }
}

// Singleton export
const websocketService = new WebSocketService();
export default websocketService;
