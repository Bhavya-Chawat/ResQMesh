/**
 * ResQMesh Simulation Engine
 * Manages real-time sensor updates, packet simulation,
 * event logging, and alert generation.
 */

export class Packet {
  static nextId = 1;

  constructor(source, destination, type = 'DATA', qos = 0, payload = '') {
    this.id = Packet.nextId++;
    this.source = source;
    this.destination = destination;
    this.type = type; // DATA, SOS, HEARTBEAT, ROUTING_UPDATE, SENSOR_ALERT
    this.qos = qos; // 0, 1, 2
    this.ttl = 10;
    this.hopCount = 0;
    this.payload = payload;
    this.timestamp = Date.now();
    this.path = [source];
    this.status = 'transit'; // transit, delivered, dropped
    this.currentPosition = 0; // 0-1 animation progress
    this.currentEdge = null;
  }

  getPriorityColor() {
    switch (this.qos) {
      case 2: return '#FF653F'; // High - Neon Orange
      case 1: return '#FFC85C'; // Medium - Warm Yellow
      default: return '#00E5FF'; // Low - Cyan
    }
  }

  getTypeIcon() {
    switch (this.type) {
      case 'SOS': return 'SOS';
      case 'HEARTBEAT': return 'HB';
      case 'ROUTING_UPDATE': return 'RU';
      case 'SENSOR_ALERT': return 'SA';
      default: return 'DATA';
    }
  }
}

export class EventLog {
  constructor(maxSize = 200) {
    this.events = [];
    this.maxSize = maxSize;
    this.listeners = [];
  }

  add(type, message, data = {}) {
    const event = {
      id: Date.now() + Math.random(),
      timestamp: new Date(),
      type, // info, warning, critical, success, network, algorithm
      message,
      data,
    };
    this.events.unshift(event);
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(0, this.maxSize);
    }
    this.listeners.forEach(fn => fn(event));
    return event;
  }

  onEvent(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  getRecent(count = 50) {
    return this.events.slice(0, count);
  }

  clear() {
    this.events = [];
  }
}

export class SimulationEngine {
  constructor(graph) {
    this.graph = graph;
    this.eventLog = new EventLog();
    this.packets = [];
    this.activePackets = [];
    this.isRunning = false;
    this.tickRate = 1000; // ms between sensor updates
    this.packetRate = 2000; // ms between auto packet sends
    this.listeners = new Set();
    this._sensorInterval = null;
    this._packetInterval = null;
    this.stats = {
      totalPacketsSent: 0,
      totalPacketsDelivered: 0,
      totalPacketsDropped: 0,
      avgLatency: 0,
      throughput: 0,
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach(fn => fn());
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.eventLog.add('success', 'Simulation started — mesh network online');

    this._sensorInterval = setInterval(() => {
      this.graph.updateSensors();
      this.checkAlerts();
      this.notify();
    }, this.tickRate);

    this._packetInterval = setInterval(() => {
      this.generateRandomPacket();
      this.notify();
    }, this.packetRate);
  }

  stop() {
    this.isRunning = false;
    clearInterval(this._sensorInterval);
    clearInterval(this._packetInterval);
    this.eventLog.add('warning', 'Simulation paused');
    this.notify();
  }

  generateRandomPacket() {
    const activeNodes = Array.from(this.graph.nodes.values()).filter(n => n.data.status !== 'failed');
    if (activeNodes.length < 2) return;

    const src = activeNodes[Math.floor(Math.random() * activeNodes.length)];
    let dst;
    do {
      dst = activeNodes[Math.floor(Math.random() * activeNodes.length)];
    } while (dst.id === src.id);

    const types = ['DATA', 'DATA', 'DATA', 'HEARTBEAT', 'SENSOR_ALERT', 'ROUTING_UPDATE'];
    const type = types[Math.floor(Math.random() * types.length)];
    const qos = type === 'SOS' ? 2 : type === 'SENSOR_ALERT' ? 1 : Math.floor(Math.random() * 3);

    this.sendPacket(src.id, dst.id, type, qos);
  }

  sendPacket(sourceId, destId, type = 'DATA', qos = 0) {
    const packet = new Packet(sourceId, destId, type, qos);

    // Use Dijkstra to find route
    const { previous } = this.graph.dijkstra(sourceId);
    const path = this.graph.reconstructPath(previous, destId);

    if (path.length <= 1 || path[0] !== sourceId) {
      packet.status = 'dropped';
      this.stats.totalPacketsDropped++;
      this.eventLog.add('critical', `Packet #${packet.id} dropped — no route from ${this.graph.nodes.get(sourceId)?.label} to ${this.graph.nodes.get(destId)?.label}`);
      return packet;
    }

    packet.path = path;
    this.packets.push(packet);
    this.activePackets.push(packet);
    this.stats.totalPacketsSent++;

    const srcLabel = this.graph.nodes.get(sourceId)?.label;
    const dstLabel = this.graph.nodes.get(destId)?.label;
    this.eventLog.add('network', `${packet.getTypeIcon()} Packet #${packet.id} [${type}] QoS:${qos} ${srcLabel} → ${dstLabel} (${path.length - 1} hops)`);

    // Simulate delivery after delay
    setTimeout(() => {
      packet.status = 'delivered';
      packet.hopCount = path.length - 1;
      this.stats.totalPacketsDelivered++;
      this.activePackets = this.activePackets.filter(p => p.id !== packet.id);
      this.eventLog.add('success', `Packet #${packet.id} delivered to ${dstLabel} (${packet.hopCount} hops)`);
      this.notify();
    }, 1500 + Math.random() * 2000);

    return packet;
  }

  checkAlerts() {
    for (const [, node] of this.graph.nodes) {
      if (node.data.status === 'failed') continue;

      if (node.data.temperature > 60) {
        this.eventLog.add('critical', `HIGH TEMP: ${node.label} — ${node.data.temperature.toFixed(1)}°C`);
      }
      if (node.data.gasLevel > 600) {
        this.eventLog.add('critical', `GAS ALERT: ${node.label} — Level ${node.data.gasLevel.toFixed(0)}`);
      }
      if (node.data.battery < 15) {
        this.eventLog.add('warning', `LOW BATTERY: ${node.label} — ${node.data.battery.toFixed(1)}%`);
      }
    }
  }

  failNode(nodeId) {
    const node = this.graph.nodes.get(nodeId);
    if (!node) return;
    node.data.status = 'failed';

    this.eventLog.add('critical', `NODE FAILURE: ${node.label} — all routes through this node will be recalculated`);

    // Trigger self-healing
    setTimeout(() => {
      this.eventLog.add('info', `Self-healing: Recalculating routes around ${node.label}...`);
      // BFS to check connectivity
      const activeNodes = Array.from(this.graph.nodes.values()).filter(n => n.data.status !== 'failed');
      if (activeNodes.length > 0) {
        const { visited } = this.graph.bfs(activeNodes[0].id);
        const reachable = Array.from(visited).filter(id => this.graph.nodes.get(id)?.data.status !== 'failed').length;
        this.eventLog.add('success', `Self-healing complete: ${reachable}/${activeNodes.length} nodes reachable`);
      }
      this.notify();
    }, 1000);

    this.notify();
  }

  recoverNode(nodeId) {
    const node = this.graph.nodes.get(nodeId);
    if (!node) return;
    node.data.status = 'active';
    node.data.battery = 80 + Math.random() * 20;
    this.eventLog.add('success', `NODE RECOVERED: ${node.label} — rejoining mesh network`);
    this.notify();
  }

  getNetworkHealth() {
    const stats = this.graph.getStats();
    const avgBattery = Array.from(this.graph.nodes.values())
      .filter(n => n.data.status !== 'failed')
      .reduce((sum, n) => sum + n.data.battery, 0) / (stats.activeNodes || 1);
    const avgLatency = Array.from(this.graph.nodes.values())
      .filter(n => n.data.status !== 'failed')
      .reduce((sum, n) => sum + n.data.latency, 0) / (stats.activeNodes || 1);

    return {
      ...stats,
      avgBattery,
      avgLatency,
      packetsSent: this.stats.totalPacketsSent,
      packetsDelivered: this.stats.totalPacketsDelivered,
      packetsDropped: this.stats.totalPacketsDropped,
      deliveryRate: this.stats.totalPacketsSent > 0
        ? ((this.stats.totalPacketsDelivered / this.stats.totalPacketsSent) * 100).toFixed(1)
        : '100.0',
    };
  }

  destroy() {
    this.stop();
    this.listeners.clear();
  }
}
