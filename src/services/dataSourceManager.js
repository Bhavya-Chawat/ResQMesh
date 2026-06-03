/**
 * dataSourceManager.js
 * --------------------
 * Controls whether the dashboard uses SIMULATION data or HARDWARE data.
 *
 * SIMULATION_MODE = true  → existing SimulationEngine drives everything (unchanged)
 * SIMULATION_MODE = false → WebSocket events from Python backend drive the graph
 *
 * Usage in App.jsx (or any component that holds graph/sim):
 *
 *   import dataSourceManager from './services/dataSourceManager';
 *
 *   // During init:
 *   dataSourceManager.init(graph, sim, notifyFn);
 *
 *   // Toggle from UI:
 *   dataSourceManager.setMode('hardware');   // or 'simulation'
 *
 *   // Read current mode:
 *   dataSourceManager.mode   // 'simulation' | 'hardware'
 *   dataSourceManager.isHardware  // boolean
 *   dataSourceManager.connectionStatus  // 'disconnected' | 'connecting' | 'connected'
 */

import websocketService from './websocketService.js';
import {
  applyTopologySnapshot,
  handleNodeUpdate,
  handleNodeFailure,
  handleAlert,
  applyStatsUpdate,
} from './hardwareDataAdapter.js';

// Read from Vite env at build time; fall back to 'true' so existing behaviour is untouched.
const ENV_SIMULATION_MODE = import.meta.env.VITE_SIMULATION_MODE;
const DEFAULT_MODE =
  ENV_SIMULATION_MODE === 'false' || ENV_SIMULATION_MODE === false
    ? 'hardware'
    : 'simulation';

class DataSourceManager {
  constructor() {
    this._mode   = DEFAULT_MODE;
    this._graph  = null;
    this._sim    = null;
    this._notify = null;          // () => void — triggers React re-render
    this._wsUnsubs = [];          // cleanup functions for WS listeners
    this._connectionStatus = 'disconnected';
    this.expectedNodes = 5;       // default expected hardware nodes count
    this._simGraphBackup = null;  // backup of simulation graph when switching to hardware mode
    this._pendingTopologySnapshot = null;
    this._pendingNodeStatuses = new Map(); // nodeId -> status
    this._pendingNodeFailures = new Set(); // nodeIds
    this._topologyInterval = null;
  }

  // ── Public getters ──────────────────────────────────────────────────

  get mode() { return this._mode; }
  get isHardware() { return this._mode === 'hardware'; }
  get isSimulation() { return this._mode === 'simulation'; }
  get connectionStatus() { return this._connectionStatus; }

  // ── Init ────────────────────────────────────────────────────────────

  /**
   * Must be called once after graph and sim are created.
   * @param {MeshGraph}        graph
   * @param {SimulationEngine} sim
   * @param {function}         notifyFn  – call to trigger React re-render
   */
  init(graph, sim, notifyFn) {
    this._graph  = graph;
    this._sim    = sim;
    this._notify = notifyFn;

    if (this._mode === 'hardware') {
      this._startHardwareMode();
    } else {
      this._startSimulationMode();
    }
  }

  // ── Mode switching ───────────────────────────────────────────────────

  /**
   * @param {'simulation'|'hardware'} newMode
   */
  setMode(newMode) {
    if (newMode === this._mode) return;

    if (this._mode === 'hardware') {
      this._stopHardwareMode();
    } else {
      this._stopSimulationMode();
    }

    this._mode = newMode;

    if (newMode === 'hardware') {
      this._startHardwareMode();
    } else {
      this._startSimulationMode();
    }

    this._notify?.();
  }

  toggle() {
    this.setMode(this._mode === 'simulation' ? 'hardware' : 'simulation');
  }

  // ── Simulation mode ──────────────────────────────────────────────────

  _startSimulationMode() {
    // Restore simulation graph from backup if it exists, otherwise ensure we have nodes
    if (this._graph) {
      this._graph.isHardware = false;
      if (this._simGraphBackup) {
        this._graph.nodes = new Map(this._simGraphBackup.nodes);
        this._graph.edges = [...this._simGraphBackup.edges];
        this._graph.adjacencyList = new Map(this._simGraphBackup.adjacencyList);
        if (this._sim && this._simGraphBackup.stats) {
          this._sim.stats = { ...this._simGraphBackup.stats };
        }
        this._simGraphBackup = null;
      } else if (this._graph.nodes.size === 0) {
        // Fallback: reset to default ring with 5 nodes if empty
        this._graph.resetToPreset('ring', 5);
      }
    }

    if (!this._sim?.isRunning) {
      this._sim?.start();
    }
    console.info('[DataSourceManager] Mode: SIMULATION');
  }

  _stopSimulationMode() {
    this._sim?.stop();
  }

  // ── Hardware mode ────────────────────────────────────────────────────

  _flushTopologyUpdates() {
    if (!this._graph) return;

    let changed = false;

    // 1. Apply topology snapshot if any is pending
    if (this._pendingTopologySnapshot) {
      applyTopologySnapshot(this._graph, this._pendingTopologySnapshot, this._sim);
      this._pendingTopologySnapshot = null;
      changed = true;
    }

    // 2. Apply pending node failures
    for (const nodeId of this._pendingNodeFailures) {
      const node = this._graph.nodes.get(nodeId);
      if (node) {
        node.data.status = 'failed';
        changed = true;
      }
    }
    this._pendingNodeFailures.clear();

    // 3. Apply pending node statuses
    for (const [nodeId, status] of this._pendingNodeStatuses.entries()) {
      const node = this._graph.nodes.get(nodeId);
      if (node && node.data.status !== status) {
        node.data.status = status;
        changed = true;
      }
    }
    this._pendingNodeStatuses.clear();

    if (changed) {
      this._notify?.();
    }
  }

  _startHardwareMode() {
    // Backup simulation graph if not already backed up
    if (this._graph && this._graph.nodes.size > 0 && !this._simGraphBackup) {
      this._simGraphBackup = {
        nodes: new Map(this._graph.nodes),
        edges: [...this._graph.edges],
        adjacencyList: new Map(this._graph.adjacencyList),
        stats: this._sim ? { ...this._sim.stats } : null
      };
    }

    // Stop simulation so it doesn't clobber hardware data
    if (this._sim?.isRunning) {
      this._sim.stop();
    }

    // Clear simulation stats when entering hardware mode
    if (this._sim) {
      this._sim.stats = {
        totalPacketsSent: 0,
        totalPacketsDelivered: 0,
        totalPacketsDropped: 0,
        avgLatency: 0,
        throughput: 0
      };
    }

    // Clear current graph nodes and edges so hardware mode starts with 0 nodes until detected in real-time
    if (this._graph) {
      this._graph.isHardware = true;
      this._graph.nodes.clear();
      this._graph.edges = [];
      this._graph.adjacencyList.clear();
    }

    // Reset pending buffers
    this._pendingTopologySnapshot = null;
    this._pendingNodeStatuses.clear();
    this._pendingNodeFailures.clear();

    // Start 5-second graph visual refresh timer
    this._topologyInterval = setInterval(() => {
      this._flushTopologyUpdates();
    }, 5000);

    this._connectionStatus = 'connecting';
    websocketService.connect();

    const graph  = this._graph;
    const sim    = this._sim;
    const notify = this._notify;

    const unsubs = [

      websocketService.on('_connected', () => {
        this._connectionStatus = 'connected';
        sim?.eventLog?.add('success', '🔌 Hardware WebSocket connected');
        notify?.();
      }),

      websocketService.on('_disconnected', () => {
        this._connectionStatus = 'disconnected';
        sim?.eventLog?.add('warning', '⚠️ Hardware WebSocket disconnected');
        notify?.();
      }),

      websocketService.on('_error', ({ message }) => {
        this._connectionStatus = 'disconnected';
        sim?.eventLog?.add('critical', `WebSocket error: ${message}`);
        notify?.();
      }),

      websocketService.on('topology_update', (data) => {
        if (sim && !sim.isRunning) return;
        // Buffer visual topology structure
        this._pendingTopologySnapshot = data;

        // But immediately update sensor readings for existing nodes in real-time
        if (data && data.nodes) {
          for (const backendNode of data.nodes) {
            const nodeId = String(backendNode.id);
            const existing = graph.nodes.get(nodeId);
            if (existing && backendNode.data) {
              const src = backendNode.data;
              if (src.temperature !== undefined) existing.data.temperature = Number(src.temperature);
              if (src.humidity !== undefined) existing.data.humidity = Number(src.humidity);
              if (src.gasLevel !== undefined) existing.data.gasLevel = Number(src.gasLevel);
              if (src.battery !== undefined) existing.data.battery = Number(src.battery);
            }
          }
        }
        notify?.(); // Real-time notify for UI table/inspector
      }),

      websocketService.on('node_update', (event) => {
        if (sim && !sim.isRunning) return;
        
        const nodeId = String(event.nodeId);
        let existing = graph.nodes.get(nodeId);

        // If the node exists, update its sensor data in real-time
        if (existing && event.node?.data) {
          const src = event.node.data;
          if (src.temperature !== undefined) existing.data.temperature = Number(src.temperature);
          if (src.humidity !== undefined) existing.data.humidity = Number(src.humidity);
          if (src.gasLevel !== undefined) existing.data.gasLevel = Number(src.gasLevel);
          if (src.battery !== undefined) existing.data.battery = Number(src.battery);
          
          // Buffer the visual status update
          if (src.status) {
            this._pendingNodeStatuses.set(nodeId, src.status);
          }
        } else {
          // New node: initialize it immediately so it receives numeric updates,
          // but its structural representation on the graph will update
          handleNodeUpdate(graph, event, sim);
        }
        
        notify?.(); // Real-time notify for UI table/inspector
      }),

      websocketService.on('heartbeat', (event) => {
        if (sim && !sim.isRunning) return;
        notify?.();
      }),

      websocketService.on('node_failure', (event) => {
        if (sim && !sim.isRunning) return;
        if (event?.nodeId) {
          this._pendingNodeFailures.add(String(event.nodeId));
          sim?.eventLog?.add('critical', event.message || `NODE FAILURE: ${event.nodeId}`);
        }
        notify?.();
      }),

      websocketService.on('alert', (event) => {
        if (sim && !sim.isRunning) return;
        handleAlert(graph, event, sim);
        notify?.();
      }),

      websocketService.on('stats_update', (statsPayload) => {
        if (sim && !sim.isRunning) return;
        applyStatsUpdate(sim, statsPayload);
        notify?.();
      }),

    ];

    this._wsUnsubs = unsubs;
    console.info('[DataSourceManager] Mode: HARDWARE — connecting to backend');
  }

  _stopHardwareMode() {
    // Clear visual refresh timer
    if (this._topologyInterval) {
      clearInterval(this._topologyInterval);
      this._topologyInterval = null;
    }

    // Unregister all WebSocket listeners
    for (const unsub of this._wsUnsubs) unsub();
    this._wsUnsubs = [];
    websocketService.disconnect();
    this._connectionStatus = 'disconnected';
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  destroy() {
    this._stopHardwareMode();
    this._stopSimulationMode();
  }
}

// Singleton
const dataSourceManager = new DataSourceManager();
export default dataSourceManager;
