/**
 * hardwareDataAdapter.js
 * -----------------------
 * Maps MQTT payloads (received via WebSocket from the Python backend)
 * directly into existing GraphNode / MeshGraph objects.
 *
 * NEVER modifies graph.js — only reads from it and calls its public API.
 */

import { GraphNode } from '../engine/graph.js';

// ── Normalized position registry ──────────────────────────────────────────────
// Assign deterministic canvas positions to hardware nodes that don't report them.
// Positions are stored as normalized 0..1 fractions, matching GraphNode.nx/ny.

const AUTO_POSITIONS = [
  { nx: 0.50, ny: 0.15 },
  { nx: 0.82, ny: 0.35 },
  { nx: 0.72, ny: 0.72 },
  { nx: 0.28, ny: 0.72 },
  { nx: 0.18, ny: 0.35 },
  { nx: 0.50, ny: 0.50 },
  { nx: 0.15, ny: 0.60 },
  { nx: 0.85, ny: 0.60 },
];

let _posIndex = 0;
const _nodePositionCache = new Map(); // nodeId → {nx, ny}

function _getPosition(nodeId, payloadNx, payloadNy) {
  if (payloadNx !== undefined && payloadNy !== undefined) {
    return { nx: Number(payloadNx), ny: Number(payloadNy) };
  }
  if (_nodePositionCache.has(nodeId)) {
    return _nodePositionCache.get(nodeId);
  }
  const pos = AUTO_POSITIONS[_posIndex % AUTO_POSITIONS.length];
  _posIndex++;
  _nodePositionCache.set(nodeId, pos);
  return pos;
}

// ── Payload → GraphNode.data mapping ─────────────────────────────────────────

/**
 * Merge backend node dict (as returned by Python topology.snapshot())
 * into an existing GraphNode's data fields.
 *
 * @param {GraphNode} graphNode  – existing node from MeshGraph
 * @param {object}    backendNode – node dict from backend WebSocket event
 */
export function applyNodeUpdate(graphNode, backendNode) {
  if (!graphNode || !backendNode) return;

  const src = backendNode.data || {};

  // Sensor data fields — direct 1-to-1 with GraphNode.data
  const fields = [
    'temperature', 'humidity', 'gasLevel', 'battery',
    'rssi', 'latency', 'throughput', 'signalQuality',
  ];
  for (const f of fields) {
    if (src[f] !== undefined) {
      graphNode.data[f] = Number(src[f]);
    }
  }

  // Status
  if (src.status) {
    graphNode.data.status = src.status;
  }

  // Position
  if (backendNode.nx !== undefined) graphNode.nx = Number(backendNode.nx);
  if (backendNode.ny !== undefined) graphNode.ny = Number(backendNode.ny);

  // Label
  if (backendNode.label) graphNode.label = backendNode.label;
}

// ── Topology snapshot → MeshGraph ────────────────────────────────────────────

/**
 * Apply a full topology snapshot from the backend to an existing MeshGraph.
 * Creates/updates nodes and edges. Does NOT remove simulation-added nodes.
 *
 * @param {MeshGraph}  graph
 * @param {object}     snapshot  – {nodes: [...], edges: [...]}
 * @param {SimulationEngine} sim – used to log events
 */
export function applyTopologySnapshot(graph, snapshot, sim) {
  if (!snapshot) return;
  const { nodes = [], edges = [] } = snapshot;

  // ── Upsert nodes ──────────────────────────────
  for (const backendNode of nodes) {
    const nodeId = String(backendNode.id);
    let existing = graph.nodes.get(nodeId);

    if (!existing) {
      const pos = _getPosition(nodeId, backendNode.nx, backendNode.ny);
      existing = new GraphNode(
        nodeId,
        backendNode.label || `Node ${nodeId}`,
        pos.nx,
        pos.ny,
      );
      existing.nx = pos.nx;
      existing.ny = pos.ny;
      graph.addNode(existing);
      sim?.eventLog?.add('success', `Hardware node joined: ${existing.label} [${nodeId}]`);
    }

    applyNodeUpdate(existing, backendNode);
  }

  // ── Upsert edges ──────────────────────────────
  for (const be of edges) {
    const src = String(be.source);
    const tgt = String(be.target);

    if (!graph.nodes.has(src) || !graph.nodes.has(tgt)) continue;

    const existing = graph.getEdge(src, tgt);
    if (existing) {
      existing.weight = Number(be.weight) || existing.weight;
      Object.assign(existing.data, be.data || {});
    } else {
      graph.addEdge(src, tgt, Number(be.weight) || 10);
    }
  }
}

// ── Single node_update event handler ─────────────────────────────────────────

/**
 * Handle a node_update WebSocket event.
 * Finds or creates the node in the graph and applies sensor data.
 *
 * @param {MeshGraph}        graph
 * @param {object}           event   – {nodeId, node, timestamp}
 * @param {SimulationEngine} sim
 */
export function handleNodeUpdate(graph, event, sim) {
  if (!event?.nodeId) return;
  const nodeId = String(event.nodeId);
  let existing = graph.nodes.get(nodeId);

  if (!existing) {
    const pos = _getPosition(nodeId, event.node?.nx, event.node?.ny);
    existing = new GraphNode(
      nodeId,
      event.node?.label || `Node ${nodeId}`,
      pos.nx,
      pos.ny,
    );
    graph.addNode(existing);
    sim?.eventLog?.add('success', `Hardware node joined: ${existing.label}`);
  }

  applyNodeUpdate(existing, event.node || {});
}

// ── Failure handler ───────────────────────────────────────────────────────────

/**
 * Handle a node_failure WebSocket event.
 *
 * @param {MeshGraph}        graph
 * @param {object}           event   – {nodeId, label, message}
 * @param {SimulationEngine} sim
 */
export function handleNodeFailure(graph, event, sim) {
  if (!event?.nodeId) return;
  const nodeId = String(event.nodeId);
  const node   = graph.nodes.get(nodeId);

  if (node) {
    node.data.status = 'failed';
    sim?.eventLog?.add('critical', event.message || `NODE FAILURE: ${node.label}`);
  }
}

// ── Alert handler ─────────────────────────────────────────────────────────────

/**
 * Handle an alert WebSocket event.
 *
 * @param {object}           event – {nodeId, label, alertType, severity, message}
 * @param {SimulationEngine} sim
 */
export function handleAlert(graph, event, sim) {
  if (!event) return;
  const label   = event.label || event.nodeId;
  const message = event.message || `ALERT from ${label}`;
  const type    = event.severity === 'critical' ? 'critical' : 'warning';
  sim?.eventLog?.add(type, `🚨 ${event.alertType || 'SOS'}: ${message}`);
}

// ── Stats update ──────────────────────────────────────────────────────────────

/**
 * Map backend health stats to SimulationEngine.stats shape.
 * Mutates sim.stats in-place without touching any method on SimulationEngine.
 *
 * @param {SimulationEngine} sim
 * @param {object}           statsPayload
 */
export function applyStatsUpdate(sim, statsPayload) {
  if (!sim || !statsPayload) return;
  if (statsPayload.packetsSent      !== undefined) sim.stats.totalPacketsSent      = statsPayload.packetsSent;
  if (statsPayload.packetsDelivered !== undefined) sim.stats.totalPacketsDelivered = statsPayload.packetsDelivered;
  if (statsPayload.packetsDropped   !== undefined) sim.stats.totalPacketsDropped   = statsPayload.packetsDropped;
}
