"""
ResQMesh Python Backend
-----------------------
Flask + Flask-SocketIO + Paho MQTT + NetworkX

Bridges ESP32 mesh hardware (via MQTT) to the React dashboard (via WebSocket).

MQTT topics consumed:
  resqmesh/+/sensor      – live sensor readings (temp, humidity, gas, battery, rssi)
  resqmesh/+/heartbeat   – keepalive pulses; absence > HEARTBEAT_TIMEOUT → node failure
  resqmesh/+/alert       – emergency / SOS alerts
  resqmesh/+/topology    – neighbour lists / edge weight updates from ESP-NOW mesh

WebSocket events emitted to frontend:
  topology_update   – full graph state (nodes + edges)
  node_update       – single node sensor delta
  heartbeat         – heartbeat ack for a node
  alert             – alert payload forwarded as-is
  node_failure      – fired when heartbeat timeout is detected
  stats_update      – aggregate network health metrics
"""

import os
import json
import time
import threading
import logging

import eventlet
eventlet.monkey_patch()

from flask import Flask, jsonify, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
import networkx as nx
from dotenv import load_dotenv

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────

load_dotenv()

# Import database module
from database import save_telemetry, get_telemetry_history, get_analytics_summary

MQTT_BROKER   = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT     = int(os.getenv("MQTT_PORT", 1883))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_KEEPALIVE = int(os.getenv("MQTT_KEEPALIVE", 60))

FLASK_HOST = os.getenv("FLASK_HOST", "0.0.0.0")
FLASK_PORT = int(os.getenv("FLASK_PORT", 5000))
FLASK_DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"

HEARTBEAT_TIMEOUT         = float(os.getenv("HEARTBEAT_TIMEOUT", 6))
NODE_FAILURE_CHECK_INTERVAL = float(os.getenv("NODE_FAILURE_CHECK_INTERVAL", 2))
PAUSE_UNTIL = 0.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("resqmesh")

# ──────────────────────────────────────────────
# Flask + SocketIO
# ──────────────────────────────────────────────

app = Flask(__name__)
app.config["SECRET_KEY"] = "resqmesh-secret-key"
CORS(app, resources={r"/api/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# ──────────────────────────────────────────────
# In-Memory Topology State
# ──────────────────────────────────────────────

class NodeState:
    """Mirrors a GraphNode object from the React frontend."""

    def __init__(self, node_id: str, label: str = None):
        self.id     = node_id
        self.label  = label or f"Node {node_id}"
        # Normalized canvas position (0..1) – sent to frontend
        # Add a small deterministic offset based on the node ID so they don't overlap
        offset_x = (ord(node_id[0]) % 5 - 2) * 0.08 if node_id else 0
        offset_y = (ord(node_id[-1]) % 5 - 2) * 0.08 if node_id else 0
        self.nx     = 0.5 + offset_x
        self.ny     = 0.5 + offset_y
        self.last_heartbeat = time.time()
        self.data   = {
            "temperature":   25.0,
            "humidity":      50.0,
            "gasLevel":      100.0,
            "battery":       100.0,
            "rssi":          -50.0,
            "latency":       10.0,
            "throughput":    100.0,
            "signalQuality": 80.0,
            "packetQueue":   [],
            "status":        "active",
        }

    def update_sensors(self, payload: dict):
        """Merge an MQTT sensor payload into node.data, honouring frontend field names."""
        mapping = {
            # MQTT key          → frontend key
            "temperature":      "temperature",
            "temp":             "temperature",
            "humidity":         "humidity",
            "hum":              "humidity",
            "gas":              "gasLevel",
            "gas_level":        "gasLevel",
            "gasLevel":         "gasLevel",
            "battery":          "battery",
            "bat":              "battery",
            "rssi":             "rssi",
            "latency":          "latency",
            "lat":              "latency",
            "throughput":       "throughput",
            "signal_quality":   "signalQuality",
            "signalQuality":    "signalQuality",
        }
        for mqtt_key, fe_key in mapping.items():
            if mqtt_key in payload:
                try:
                    self.data[fe_key] = float(payload[mqtt_key])
                except (TypeError, ValueError):
                    pass

        # Optional position update from hardware
        if "nx" in payload:
            try:
                self.nx = float(payload["nx"])
            except (TypeError, ValueError):
                pass
        if "ny" in payload:
            try:
                self.ny = float(payload["ny"])
            except (TypeError, ValueError):
                pass

        # Auto-correct DHT11 sensor read using DHT22 configuration
        temp_val = self.data.get("temperature", 25.0)
        hum_val = self.data.get("humidity", 50.0)

        # If temperature or humidity is in the DHT11-read-as-DHT22 error range (temp > 100 or hum > 100),
        # automatically correct it by recovering the original DHT11 bytes.
        if temp_val > 100.0 or hum_val > 100.0:
            def correct_dht11_fake_d22(val: float) -> float:
                raw = int(round(val * 10))
                high = raw // 256
                low = raw % 256
                return high + (low / 10.0)

            if temp_val > 100.0:
                temp_val = correct_dht11_fake_d22(temp_val)
                temp_val = max(10.0, min(100.0, temp_val))
                self.data["temperature"] = temp_val

            if hum_val > 100.0:
                hum_val = correct_dht11_fake_d22(hum_val)
                hum_val = max(10.0, min(99.0, hum_val))
                self.data["humidity"] = hum_val

        self._recalculate_status()

    def _recalculate_status(self):
        t   = self.data["temperature"]
        gas = self.data["gasLevel"]
        # Only fail if gas is high (smoke) or temp is realistic but high (60 - 200)
        # Ignore 0.0 battery and 691.9 disconnected temp
        if (60.0 < t < 200.0) or gas > 210:
            self.data["status"] = "failed"
        elif (45.0 < t < 200.0) or gas > 160:
            self.data["status"] = "warning"
        else:
            self.data["status"] = "active"

    def to_dict(self) -> dict:
        return {
            "id":    self.id,
            "label": self.label,
            "nx":    self.nx,
            "ny":    self.ny,
            "x":     self.nx,
            "y":     self.ny,
            "data":  dict(self.data),
        }


class TopologyManager:
    """Tracks nodes, edges, heartbeats, and failure detection."""

    def __init__(self):
        self._lock   = threading.Lock()
        self.nodes: dict[str, NodeState] = {}
        self.edges:  list[dict]           = []   # [{source, target, weight, data:{}}]
        self.G = nx.Graph()
        self._packet_stats = {
            "totalPacketsSent":      0,
            "totalPacketsDelivered": 0,
            "totalPacketsDropped":   0,
        }
        self.manual_weights = {} # tuple(sorted([node1, node2])) -> weight

    # ── Node CRUD ──────────────────────────────

    def get_or_create_node(self, node_id: str, label: str = None) -> NodeState:
        with self._lock:
            if node_id not in self.nodes:
                n = NodeState(node_id, label)
                self.nodes[node_id] = n
                self.G.add_node(node_id, label=n.label)
                log.info("New node discovered: %s (%s)", node_id, n.label)
            return self.nodes[node_id]

    def update_heartbeat(self, node_id: str):
        node = self.get_or_create_node(node_id)
        with self._lock:
            node.last_heartbeat = time.time()
            if node.data["status"] == "failed":
                # Only recover if the failure wasn't due to high sensor readings
                t   = node.data["temperature"]
                gas = node.data["gasLevel"]
                if (60.0 < t < 200.0) or gas > 210:
                    return "ok" # Keep it failed because sensors are still high
                
                node.data["status"] = "active"
                log.info("Node recovered via heartbeat: %s", node_id)
                return "recovered"
        return "ok"

    def mark_failed(self, node_id: str):
        with self._lock:
            if node_id in self.nodes:
                self.nodes[node_id].data["status"] = "failed"

    def set_manual_weight(self, source: str, target: str, weight: float):
        key = tuple(sorted([source, target]))
        with self._lock:
            self.manual_weights[key] = weight
            # Update in NetworkX graph
            if self.G.has_edge(source, target):
                self.G[source][target]["weight"] = weight
            # Update in self.edges list
            existing = next(
                (e for e in self.edges
                 if (e["source"] == source and e["target"] == target) or
                    (e["source"] == target and e["target"] == source)),
                None
            )
            if existing:
                existing["weight"] = weight
                existing["data"]["latency"] = weight

    # ── Edge management ────────────────────────

    def update_topology(self, node_id: str, payload: dict):
        """
        payload expected:
          {
            "neighbours": [
              {"id": "B", "rssi": -60, "latency": 15},
              ...
            ]
          }
        """
        neighbours = payload.get("neighbours", payload.get("neighbors", []))
        with self._lock:
            for nb in neighbours:
                nb_id  = str(nb.get("id", nb.get("node_id", "")))
                if not nb_id:
                    continue
                
                # Manual weight overrides defaults
                edge_key = tuple(sorted([node_id, nb_id]))
                if edge_key in self.manual_weights:
                    weight = self.manual_weights[edge_key]
                else:
                    weight = 2.0
                
                rssi   = float(nb.get("rssi", -50))

                # Ensure neighbour node exists
                if nb_id not in self.nodes:
                    self.nodes[nb_id] = NodeState(nb_id)
                    self.G.add_node(nb_id)

                # Upsert edge
                existing = next(
                    (e for e in self.edges
                     if (e["source"] == node_id and e["target"] == nb_id) or
                        (e["source"] == nb_id   and e["target"] == node_id)),
                    None
                )
                if existing:
                    existing["weight"] = weight
                    existing["data"]["latency"] = weight
                    existing["data"]["rssi"]    = rssi
                else:
                    self.edges.append({
                        "source": node_id,
                        "target": nb_id,
                        "weight": weight,
                        "data":   {
                            "latency":    weight,
                            "bandwidth":  200.0,
                            "packetLoss": 0.0,
                            "rssi":       rssi,
                            "status":     "active",
                        },
                    })
                self.G.add_edge(node_id, nb_id, weight=weight)

    # ── Snapshot for frontend ──────────────────

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "nodes": [n.to_dict() for n in self.nodes.values()],
                "edges": list(self.edges),
            }

    def get_health(self) -> dict:
        with self._lock:
            active    = [n for n in self.nodes.values() if n.data["status"] != "failed"]
            total     = len(self.nodes)
            active_cnt = len(active)

            avg_bat     = sum(n.data["battery"]  for n in active) / max(active_cnt, 1)
            avg_latency = sum(n.data["latency"]  for n in active) / max(active_cnt, 1)

            total_edges  = len(self.edges)
            active_edges = sum(
                1 for e in self.edges
                if self.nodes.get(e["source"], NodeState("_")).data["status"] != "failed"
                and self.nodes.get(e["target"], NodeState("_")).data["status"] != "failed"
            )
            n = total
            density = (2 * total_edges) / (n * (n - 1)) if n > 1 else 0

            return {
                "activeNodes":        active_cnt,
                "totalNodes":         total,
                "totalEdges":         total_edges,
                "activeEdges":        active_edges,
                "density":            density,
                "avgBattery":         avg_bat,
                "avgLatency":         avg_latency,
                "packetsSent":        self._packet_stats["totalPacketsSent"],
                "packetsDelivered":   self._packet_stats["totalPacketsDelivered"],
                "packetsDropped":     self._packet_stats["totalPacketsDropped"],
                "deliveryRate":       (
                    f"{(self._packet_stats['totalPacketsDelivered'] / self._packet_stats['totalPacketsSent'] * 100):.1f}"
                    if self._packet_stats["totalPacketsSent"] > 0 else "100.0"
                ),
            }

    # ── Failure watcher ────────────────────────

    def check_failures(self) -> list[str]:
        """Returns list of node IDs newly marked as failed."""
        failed_now = []
        now = time.time()
        with self._lock:
            for node_id, node in self.nodes.items():
                if node.data["status"] != "failed":
                    if now - node.last_heartbeat > HEARTBEAT_TIMEOUT:
                        node.data["status"] = "failed"
                        failed_now.append(node_id)
                        log.warning("Heartbeat timeout — node FAILED: %s", node_id)
        return failed_now


# Singleton
topology = TopologyManager()

# ──────────────────────────────────────────────
# Heartbeat Failure-Detection Thread
# ──────────────────────────────────────────────

def failure_watcher():
    while True:
        eventlet.sleep(NODE_FAILURE_CHECK_INTERVAL)
        global PAUSE_UNTIL
        if time.time() < PAUSE_UNTIL:
            continue
        failed = topology.check_failures()
        for node_id in failed:
            node = topology.nodes.get(node_id)
            socketio.emit("node_failure", {
                "nodeId":    node_id,
                "label":     node.label if node else node_id,
                "timestamp": time.time(),
                "message":   f"Node {node_id} heartbeat timeout — marked FAILED",
            })
            socketio.emit("topology_update", topology.snapshot())

# ──────────────────────────────────────────────
# MQTT Handlers
# ──────────────────────────────────────────────

def _parse_topic(topic: str):
    """resqmesh/<node_id>/<msg_type> → (node_id, msg_type)"""
    parts = topic.split("/")
    if len(parts) >= 3 and parts[0] == "resqmesh":
        return parts[1], parts[2]
    return None, None


def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        log.info("MQTT connected to %s:%d", MQTT_BROKER, MQTT_PORT)
        client.subscribe("resqmesh/+/sensor")
        client.subscribe("resqmesh/+/heartbeat")
        client.subscribe("resqmesh/+/alert")
        client.subscribe("resqmesh/+/topology")
        log.info("Subscribed to resqmesh/+/{sensor,heartbeat,alert,topology}")
    else:
        log.error("MQTT connection failed: %s", reason_code)


def on_disconnect(client, userdata, disconnect_flags, reason_code, properties):
    log.warning("MQTT disconnected (%s) — will auto-reconnect", reason_code)


def on_message(client, userdata, msg):
    global PAUSE_UNTIL
    if time.time() < PAUSE_UNTIL:
        return
    topic   = msg.topic
    node_id, msg_type = _parse_topic(topic)
    if not node_id:
        return

    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        log.error("Failed to parse JSON on topic %s: %s (payload: %r)", topic, e, msg.payload)
        payload = {}

    if msg_type == "sensor":
        _handle_sensor(node_id, payload)
    elif msg_type == "heartbeat":
        _handle_heartbeat(node_id, payload)
    elif msg_type == "alert":
        _handle_alert(node_id, payload)
    elif msg_type == "topology":
        _handle_topology(node_id, payload)


def _handle_sensor(node_id: str, payload: dict):
    node = topology.get_or_create_node(node_id, payload.get("label"))
    raw_temp = payload.get("temperature", payload.get("temp", "N/A"))
    raw_gas = payload.get("gasLevel", payload.get("gas", "N/A"))
    node.update_sensors(payload)
    log.info("[MQTT Sensor] Node %s -> Raw Temp: %s, Raw Gas: %s | Corrected Temp: %.1f, Corrected Gas: %.1f", 
             node_id, raw_temp, raw_gas, node.data["temperature"], node.data["gasLevel"])
             
    # Log telemetry entry to database (Supabase/SQLite)
    save_telemetry(
        node_id=node_id,
        temperature=node.data["temperature"],
        humidity=node.data["humidity"],
        gas_level=node.data["gasLevel"],
        battery=node.data["battery"]
    )
    
    socketio.emit("node_update", {
        "nodeId": node_id,
        "node":   node.to_dict(),
        "timestamp": time.time(),
    })
    socketio.emit("stats_update", topology.get_health())


def _handle_heartbeat(node_id: str, payload: dict):
    result = topology.update_heartbeat(node_id)
    node   = topology.nodes.get(node_id)
    socketio.emit("heartbeat", {
        "nodeId":    node_id,
        "label":     node.label if node else node_id,
        "timestamp": time.time(),
        "result":    result,
        "payload":   payload,
    })
    if result == "recovered":
        socketio.emit("topology_update", topology.snapshot())
        socketio.emit("stats_update",    topology.get_health())


def _handle_alert(node_id: str, payload: dict):
    node = topology.get_or_create_node(node_id)
    alert_type = payload.get("type", "SOS")
    socketio.emit("alert", {
        "nodeId":    node_id,
        "label":     node.label,
        "alertType": alert_type,
        "severity":  payload.get("severity", "critical"),
        "message":   payload.get("message", f"ALERT from {node_id}"),
        "timestamp": time.time(),
        "payload":   payload,
    })
    log.warning("ALERT from %s: %s", node_id, payload.get("message", alert_type))


def _handle_topology(node_id: str, payload: dict):
    topology.get_or_create_node(node_id, payload.get("label"))
    topology.update_topology(node_id, payload)
    socketio.emit("topology_update", topology.snapshot())
    socketio.emit("stats_update",    topology.get_health())

# ──────────────────────────────────────────────
# MQTT Client Setup
# ──────────────────────────────────────────────

mqtt_client = mqtt.Client(
    callback_api_version=CallbackAPIVersion.VERSION2,
    client_id="resqmesh-backend",
    protocol=mqtt.MQTTv5,
)
mqtt_client.on_connect    = on_connect
mqtt_client.on_disconnect = on_disconnect
mqtt_client.on_message    = on_message

if MQTT_USERNAME:
    mqtt_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)

# ──────────────────────────────────────────────
# REST API – consumed by existing React dashboard
# ──────────────────────────────────────────────

@app.route("/api/topology", methods=["GET"])
def api_topology():
    """Full graph snapshot: nodes + edges."""
    return jsonify(topology.snapshot())


@app.route("/api/edges/weight", methods=["POST"])
def api_update_edge_weight():
    data = request.json or {}
    source = data.get("source")
    target = data.get("target")
    weight = data.get("weight")
    if not source or not target or weight is None:
        return jsonify({"error": "Missing parameters"}), 400
    try:
        w_val = float(weight)
    except ValueError:
        return jsonify({"error": "Invalid weight"}), 400

    # Apply manual weight
    topology.set_manual_weight(source, target, w_val)

    # Trigger a 2-second global pause
    global PAUSE_UNTIL
    PAUSE_UNTIL = time.time() + 2.0

    # Notify clients
    socketio.emit("topology_update", topology.snapshot())
    socketio.emit("stats_update", topology.get_health())
    return jsonify({"status": "ok"})


@app.route("/api/nodes", methods=["GET"])
def api_nodes():
    return jsonify({"nodes": [n.to_dict() for n in topology.nodes.values()]})


@app.route("/api/nodes/<node_id>", methods=["GET"])
def api_node(node_id):
    node = topology.nodes.get(node_id)
    if not node:
        return jsonify({"error": "Node not found"}), 404
    return jsonify(node.to_dict())


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify(topology.get_health())


@app.route("/api/nodes/<node_id>/fail", methods=["POST"])
def api_fail_node(node_id):
    topology.mark_failed(node_id)
    socketio.emit("node_failure", {
        "nodeId":    node_id,
        "timestamp": time.time(),
        "message":   f"Node {node_id} manually failed via API",
    })
    socketio.emit("topology_update", topology.snapshot())
    return jsonify({"status": "ok", "nodeId": node_id})


@app.route("/api/nodes/<node_id>/recover", methods=["POST"])
def api_recover_node(node_id):
    node = topology.get_or_create_node(node_id)
    node.data["status"]        = "active"
    node.data["battery"]       = 90.0
    node.last_heartbeat        = time.time()
    socketio.emit("topology_update", topology.snapshot())
    socketio.emit("stats_update",    topology.get_health())
    return jsonify({"status": "ok", "nodeId": node_id})


@app.route("/api/mqtt/status", methods=["GET"])
def api_mqtt_status():
    return jsonify({
        "broker":    MQTT_BROKER,
        "port":      MQTT_PORT,
        "connected": mqtt_client.is_connected(),
    })


@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify({"status": "online", "mode": "hardware"})


@app.route("/api/reports/history", methods=["GET"])
def api_reports_history():
    node_id = request.args.get("node_id", None)
    if node_id == "all" or node_id == "":
        node_id = None
    try:
        limit = int(request.args.get("limit", 150))
    except ValueError:
        limit = 150
    records = get_telemetry_history(node_id=node_id, limit=limit)
    return jsonify(records)


@app.route("/api/reports/analytics", methods=["GET"])
def api_reports_analytics():
    summary = get_analytics_summary()
    return jsonify(summary)

# ──────────────────────────────────────────────
# WebSocket Events
# ──────────────────────────────────────────────

@socketio.on("connect")
def ws_connect():
    log.info("Frontend connected via WebSocket: %s", request.sid)
    # Send current state immediately on connect
    emit("topology_update", topology.snapshot())
    emit("stats_update",    topology.get_health())


@socketio.on("disconnect")
def ws_disconnect():
    log.info("Frontend disconnected: %s", request.sid)


@socketio.on("request_topology")
def ws_request_topology():
    emit("topology_update", topology.snapshot())


@socketio.on("request_stats")
def ws_request_stats():
    emit("stats_update", topology.get_health())

# ──────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Starting ResQMesh backend on %s:%d", FLASK_HOST, FLASK_PORT)

    # Connect to MQTT broker (non-blocking loop in background thread)
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, MQTT_KEEPALIVE)
        mqtt_client.loop_start()
        log.info("MQTT loop started")
    except Exception as exc:
        log.error("MQTT connect failed: %s — running without MQTT", exc)

    # Start heartbeat failure watcher in eventlet green thread
    eventlet.spawn(failure_watcher)

    socketio.run(
        app,
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=FLASK_DEBUG,
        use_reloader=False,
    )
