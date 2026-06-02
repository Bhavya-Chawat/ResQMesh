# ResQMesh — Disaster Intelligence Platform

> **Intelligent Self-Healing Disaster Communication & Rescue Routing System**
>
> An interactive Graph-Theory, Networking, and IoT Disaster Intelligence Platform.  
> Explore algorithms, visualize mesh networks, simulate disaster rescue operations — and connect real ESP32 hardware nodes.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Live Modules](#live-modules)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Hardware Integration](#hardware-integration)
- [Algorithms Implemented](#algorithms-implemented)
- [Simulation Engine](#simulation-engine)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Hardware Setup](#hardware-setup)
- [Usage Guide](#usage-guide)
- [Key Concepts](#key-concepts)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

**ResQMesh** is an academic-grade, browser-based platform that models how a self-healing mesh network of IoT sensor nodes behaves during a disaster scenario (fires, floods, building collapses, etc.).

It combines:
- **Graph theory** — shortest paths, spanning trees, traversal algorithms
- **Network simulation** — real-time packet routing, node failure & recovery, QoS
- **IoT sensor modeling** — temperature, gas, battery, RSSI, latency streams
- **Rescue routing** — TSP-based optimal patrol planning for first responders
- **Real hardware support** — live ESP32 mesh nodes via ESP-NOW → MQTT → WebSocket bridge

The platform supports two modes:

| Mode | Description |
|---|---|
| **Simulation** (default) | Built-in engine generates synthetic sensor data — no hardware required |
| **Hardware** | Live ESP32 nodes publish over MQTT; Python backend bridges to the React dashboard in real time |

---

## Features

| Feature | Description |
|---|---|
| 🗺 **Live Topology Canvas** | Drag-and-drop interactive graph rendered on HTML5 Canvas with animated packet flow |
| ⚡ **Real-Time Sensor Data** | Nodes emit live temperature, humidity, gas, battery, RSSI, latency, throughput data |
| 🔄 **Self-Healing Mesh** | Node failure triggers automatic BFS connectivity re-check and route recalculation |
| 🧮 **Step-by-Step Algorithm Visualizer** | Watch Dijkstra, Bellman-Ford, BFS, DFS, Prim's, TSP execute node-by-node |
| 📦 **Packet Simulator** | DATA / SOS / HEARTBEAT / ROUTING_UPDATE / SENSOR_ALERT packets routed via Dijkstra |
| 🆘 **Rescue Mode** | TSP Branch-and-Bound computes optimal multi-stop rescue patrol routes |
| 📊 **Network Analytics** | Delivery rate, packet loss, avg latency, battery health, graph density |
| 🗺 **Routing Tables** | Per-node Dijkstra-computed forwarding tables with next-hop, cost, hop count |
| 🔔 **Event Stream** | Live timestamped log of all network events, alerts, and algorithm steps |
| 🔌 **Hardware Mode** | Connect real ESP32 mesh nodes — live sensor data drives the same dashboard |
| 💓 **Heartbeat Monitoring** | Backend detects node silence > 6 s and marks the node as failed automatically |

---

## Live Modules

### 1. `Command Center` (`/command`)
The operational dashboard:
- **Live Topology Canvas** — renders the mesh graph; drag nodes; edges show weight labels and animated data-flow
- **Node Inspector** — click any node to see all sensor readings and its Dijkstra routing table
- **Node Controls** — add, fail, recover, remove nodes on the fly
- **Event Stream** — scrolling log of all simulation/hardware events with color-coded severity
- **SIM / HW badge** — click in the sidebar footer to toggle between simulation and hardware data live

### 2. `Algorithm Lab` (`/algorithms`)
Step-through algorithm visualizer:
- Select source node and algorithm
- Step forward/backward through each decision
- Canvas highlights visited nodes and relaxed edges in real time
- Human-readable description of each step

### 3. `Network Center` (`/network`)
Deep network diagnostics:
- Adjacency matrix view
- Per-node routing table aggregation
- Real-time sensor sparklines (Chart.js)
- Packet log with QoS filtering

### 4. `Rescue Mode` (`/rescue`)
Disaster response planning:
- Mark nodes as alert/rescue targets
- Run TSP Branch-and-Bound for optimal patrol order
- Visualize optimal route on the mesh
- States explored vs. pruned (algorithm efficiency view)

---

## Tech Stack

### Frontend

| Layer | Technology |
|---|---|
| **Framework** | React 18 (JSX, Hooks, Context API) |
| **Routing** | React Router DOM v7 (HashRouter) |
| **Build Tool** | Vite 8 + TypeScript |
| **Charts** | Chart.js 4 + react-chartjs-2 |
| **Rendering** | HTML5 Canvas (2D API) — no WebGL |
| **Styling** | Vanilla CSS — custom design system, glassmorphism, neon palette |
| **Fonts** | Google Fonts: Orbitron (display), Share Tech Mono (mono) |
| **State** | React Context (`AppContext`) — global graph + simulation engine |
| **WebSocket** | socket.io-client (hardware mode only, dynamically imported) |

### Backend (hardware mode)

| Layer | Technology |
|---|---|
| **Server** | Python 3.10+ · Flask 3 · Flask-SocketIO 5 |
| **WebSocket** | Socket.IO over eventlet |
| **MQTT Client** | Paho MQTT 2.1 |
| **Graph Analysis** | NetworkX 3.3 |
| **Broker** | Mosquitto (any MQTT v5 broker) |

### Firmware

| Layer | Technology |
|---|---|
| **Hardware** | ESP32 (Espressif) |
| **Wireless** | ESP-NOW (mesh) → WiFi (gateway only) |
| **Protocol** | MQTT v5 |
| **Sensors** | DHT22 (temp/humidity), MQ-2 (gas), voltage divider (battery) |

---

## Architecture

### Simulation Mode

```
AppContext (React Context)
├── MeshGraph           ← graph data structure + all algorithm methods
│   ├── GraphNode       ← node with sensor data, position, status
│   └── GraphEdge       ← weighted edge with bandwidth/latency/packet-loss
└── SimulationEngine    ← real-time tick loop, packet router, alert checker
    ├── EventLog        ← event bus + listener system
    └── Packet          ← routed message with QoS / type / TTL / path
```

Data flow:
```
SimulationEngine.start()
  ↓  every 1 000 ms
graph.updateSensors()  →  checkAlerts()  →  notify() → React re-render
  ↓  every 2 000 ms
generateRandomPacket() → graph.dijkstra() → route packet → EventLog
```

### Hardware Mode

```
ESP32 Mesh Node  ──ESP-NOW──▶  Gateway ESP32  ──WiFi MQTT──▶  Mosquitto
                                                                    │
                                                        Python Backend (Flask-SocketIO)
                                                        ┌──────────────────────────┐
                                                        │  Subscribe               │
                                                        │  resqmesh/+/sensor       │
                                                        │  resqmesh/+/heartbeat    │
                                                        │  resqmesh/+/alert        │
                                                        │  resqmesh/+/topology     │
                                                        └────────────┬─────────────┘
                                                                     │ WebSocket (Socket.IO)
                                                          ┌──────────▼──────────┐
                                                          │  dataSourceManager  │
                                                          │  hardwareDataAdapter│
                                                          │  → MeshGraph nodes  │
                                                          └──────────┬──────────┘
                                                                     │
                                                          React Dashboard (unchanged)
```

---

## Hardware Integration

### New Files Added

```
ResQMesh/
├── .env                              ← Vite env (SIMULATION_MODE, BACKEND_URL)
├── .env.hardware                     ← Copy to .env to activate hardware mode
├── backend/
│   ├── .env                          ← Backend config (broker, port, timeouts)
│   ├── requirements.txt              ← Python dependencies
│   ├── app.py                        ← Flask-SocketIO + Paho MQTT server
│   └── mqtt_consumer.py              ← Standalone MQTT consumer / test helper
├── src/
│   └── services/
│       ├── websocketService.js       ← Socket.IO client singleton
│       ├── hardwareDataAdapter.js    ← Maps MQTT payloads → GraphNode objects
│       └── dataSourceManager.js     ← SIM ↔ HW mode switcher
└── firmware/
    └── resqmesh_node/
        └── resqmesh_node.ino         ← ESP32 Arduino firmware
```

### MQTT Topics

| Topic | Direction | Description |
|---|---|---|
| `resqmesh/+/sensor` | ESP32 → Backend | Temperature, humidity, gas, battery, RSSI |
| `resqmesh/+/heartbeat` | ESP32 → Backend | Keepalive pulse every 3 s |
| `resqmesh/+/alert` | ESP32 → Backend | SOS / emergency events |
| `resqmesh/+/topology` | ESP32 → Backend | Neighbour list + edge weights |

### WebSocket Events (Backend → Frontend)

| Event | Payload |
|---|---|
| `topology_update` | Full `{nodes, edges}` snapshot |
| `node_update` | Single node sensor delta |
| `heartbeat` | Heartbeat ack for a node |
| `node_failure` | Fired when heartbeat timeout (> 6 s) is detected |
| `alert` | Alert payload forwarded as-is |
| `stats_update` | Aggregate network health metrics |

### REST API (Backend)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/topology` | Full graph snapshot |
| GET | `/api/nodes` | All node states |
| GET | `/api/nodes/<id>` | Single node |
| GET | `/api/health` | Network health metrics |
| POST | `/api/nodes/<id>/fail` | Manually fail a node |
| POST | `/api/nodes/<id>/recover` | Recover a node |
| GET | `/api/mqtt/status` | Broker connection status |

### MQTT Payload Schemas

**Sensor:**
```json
{
  "nodeId": "A", "label": "Node A",
  "temperature": 34.2, "humidity": 55.1,
  "gasLevel": 210.0, "battery": 78.4,
  "rssi": -62, "latency": 12, "throughput": 145
}
```

**Heartbeat:**
```json
{ "nodeId": "A", "ts": 1717341234 }
```

**Alert:**
```json
{
  "nodeId": "A", "type": "SOS",
  "severity": "critical",
  "message": "Survivor located at Node A"
}
```

**Topology:**
```json
{
  "nodeId": "A",
  "neighbours": [
    { "id": "B", "rssi": -65, "latency": 14 },
    { "id": "C", "rssi": -72, "latency": 20 }
  ]
}
```

---

## Algorithms Implemented

All algorithms live in `src/engine/graph.js` and return **step arrays** for visualization.

### Dijkstra's Shortest Path
```js
graph.dijkstra(sourceId)
→ { steps[], distances: Map<id,dist>, previous: Map<id,prev> }
```
- Priority-queue relaxation; skips `failed` nodes
- Powers all real-time packet routing and routing tables

### Bellman-Ford
```js
graph.bellmanFord(sourceId)
→ { steps[], distances, previous }
```
- V−1 iterations over all edges; early-exit on convergence

### BFS — Breadth-First Search
```js
graph.bfs(sourceId)
→ { steps[], order[], visited: Set }
```
- Used internally by self-healing to check connectivity after node failure

### DFS — Depth-First Search
```js
graph.dfs(sourceId)
→ { steps[], order[], visited: Set }
```

### Prim's Minimum Spanning Tree
```js
graph.primMST()
→ { steps[], mstEdges[], totalWeight }
```
- Minimum-cost backbone for sensor data aggregation

### TSP — Branch and Bound
```js
graph.tspBranchAndBound(alertNodeIds)
→ { steps[], bestPath[], bestCost, statesExplored, statesPruned, distMatrix }
```
- All-pairs shortest paths via repeated Dijkstra + recursive pruning

### Utility Methods

| Method | Description |
|---|---|
| `reconstructPath(previous, targetId)` | Trace back shortest path from prev-map |
| `getRoutingTable(nodeId)` | Full Dijkstra forwarding table for a node |
| `getAdjacencyMatrix()` | Dense matrix representation |
| `getStats()` | Active nodes, edges, density |

---

## Simulation Engine

`src/engine/simulation.js` manages the live simulation loop.

### Packet Types & QoS

| Type | Default QoS | Color |
|---|---|---|
| DATA | 0 (Low) | 🩵 Cyan |
| HEARTBEAT | 0 | 🩵 Cyan |
| SENSOR_ALERT | 1 (Medium) | 🟡 Warm Yellow |
| ROUTING_UPDATE | 0 | 🩵 Cyan |
| SOS | 2 (High) | 🟠 Neon Orange |

### Alert Thresholds

| Sensor | Warning | Critical |
|---|---|---|
| Temperature | > 45 °C | > 60 °C |
| Gas Level | > 400 | > 600 |
| Battery | < 30 % | < 15 % |

### Self-Healing Flow
1. `sim.failNode(id)` — sets `node.data.status = 'failed'`
2. All Dijkstra calls skip failed nodes
3. After 1 s, BFS re-checks reachability of remaining active nodes
4. Result logged to Event Stream: `"✅ Self-healing complete: N/M nodes reachable"`
5. `sim.recoverNode(id)` restores node with fresh battery (80–100%)

---

## Project Structure

```
ResQMesh/
├── index.html
├── package.json                  # Vite + React + Chart.js + React Router + socket.io-client
├── tsconfig.json
├── .env                          # VITE_SIMULATION_MODE, VITE_BACKEND_URL
├── .env.hardware                 # Copy to .env to enable hardware mode
│
├── backend/                      # Python hardware bridge
│   ├── .env                      # MQTT broker config, heartbeat timeout
│   ├── requirements.txt
│   ├── app.py                    # Flask-SocketIO + Paho MQTT backend
│   └── mqtt_consumer.py          # Standalone MQTT consumer helper
│
├── firmware/
│   └── resqmesh_node/
│       └── resqmesh_node.ino     # ESP32 firmware (gateway + mesh node)
│
└── src/
    ├── main.jsx
    ├── App.jsx                   # AppContext, routing shell, sidebar nav, dataSourceManager init
    ├── App.css                   # Design system — CSS variables, glass panels, animations
    ├── index.css
    ├── engine/
    │   ├── graph.js              # MeshGraph, GraphNode, GraphEdge, all algorithms
    │   └── simulation.js         # SimulationEngine, Packet, EventLog
    ├── services/
    │   ├── websocketService.js   # Socket.IO singleton (hardware mode)
    │   ├── hardwareDataAdapter.js# MQTT payload → GraphNode mapper
    │   └── dataSourceManager.js  # SIM ↔ HW mode switcher
    └── pages/
        ├── Landing.jsx
        ├── CommandCenter.jsx
        ├── AlgorithmLab.jsx
        ├── NetworkCenter.jsx
        └── RescueMode.jsx
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18, **npm** ≥ 9
- **Python** ≥ 3.10 (hardware mode only)
- **Mosquitto** MQTT broker (hardware mode only) — [mosquitto.org](https://mosquitto.org/download/)

### Frontend Installation

```bash
git clone https://github.com/<your-username>/ResQMesh.git
cd ResQMesh

npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
npm run build
npm run preview
```

---

## Hardware Setup

### 1. Start Mosquitto

```bash
mosquitto -v
```

Runs on `localhost:1883` by default. Edit `backend/.env` if your broker is remote.

### 2. Start the Python Backend

```powershell
# Windows
python -m venv venv
venv\Scripts\activate
pip install -r backend\requirements.txt
python backend\app.py
```

```bash
# macOS / Linux
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
python backend/app.py
```

Backend starts on `http://localhost:5000`.

### 3. Enable Hardware Mode

**Option A — env var (persists across restarts):**
```bash
# Copy the hardware env template
cp .env.hardware .env
# then restart: npm run dev
```

**Option B — live toggle (no restart needed):**  
Click the **`SIM`** badge at the bottom of the sidebar. It switches to **`HW:LIVE`** once the WebSocket connects.

### 4. Flash ESP32 Firmware

Open `firmware/resqmesh_node/resqmesh_node.ino` in Arduino IDE.

**Configure before flashing:**
```cpp
#define NODE_ID      "A"          // Unique ID for this node
#define NODE_LABEL   "Node A"
#define IS_GATEWAY   true         // true = gateway ESP32, false = mesh node
#define WIFI_SSID    "YOUR_SSID"
#define WIFI_PASSWORD "YOUR_PASS"
#define MQTT_BROKER  "192.168.1.100"  // IP of your Mosquitto broker
```

**Flash order:**
1. Flash **gateway** first — note its MAC from Serial Monitor
2. Set `GATEWAY_MAC[]` in all mesh node sketches
3. Flash all **mesh nodes** with `IS_GATEWAY false`

**Required Arduino libraries** (install via Library Manager):
- `PubSubClient` (Nick O'Leary)
- `ArduinoJson` (Benoit Blanchon)
- `DHT sensor library` (Adafruit)

### Backend Configuration (`backend/.env`)

```env
MQTT_BROKER=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
HEARTBEAT_TIMEOUT=6          # seconds before a silent node is marked failed
NODE_FAILURE_CHECK_INTERVAL=2
FLASK_HOST=0.0.0.0
FLASK_PORT=5000
```

---

## Usage Guide

### Simulation Mode

1. Launch the app → click **"Launch Simulation"** on the landing page
2. The default 5-node pentagon mesh (Nodes A–E) loads automatically
3. Click **`+ Node`** in the Command Center to add nodes
4. **Drag** any node on the canvas to reposition it

### Simulating Failures

1. Click any node on the canvas to select it
2. Use **`✕ Fail`** to take it offline — watch routes recalculate
3. Use **`↻ Recover`** to bring it back online
4. Monitor the Event Stream for self-healing notifications

### Running Algorithms

1. Navigate to **Algorithm Lab**
2. Pick a source node and algorithm
3. Click **▶ Run** then use **← Step / Step →** to walk through each decision
4. Canvas highlights currently visited nodes and relaxed edges in real time

### Rescue Planning (TSP)

1. Navigate to **Rescue Mode**
2. Toggle nodes as **alert targets**
3. Click **Run TSP** — Branch & Bound finds the optimal patrol order
4. The optimal route is drawn on the topology canvas

### Hardware Mode

1. Start Mosquitto + Python backend (see [Hardware Setup](#hardware-setup))
2. Click the **`SIM`** badge in the sidebar to switch to `HW:LIVE`
3. Nodes discovered from MQTT appear on the topology canvas automatically
4. All existing algorithms and visualizations work on live hardware data without any changes

---

## Key Concepts

### Normalized Coordinates
Nodes store positions as `(nx, ny) ∈ [0,1]²` so the graph scales to any canvas size:
```js
x = pad + nx * (canvasWidth  - 2 * pad)
y = pad + ny * (canvasHeight - 2 * pad)
```

### Graph Density
```
density = (2 × |E|) / (|V| × (|V| − 1))
```

### QoS Color Coding

| QoS | Color | Use Case |
|---|---|---|
| 2 | 🟠 `#FF653F` Neon Orange | SOS / Emergency |
| 1 | 🟡 `#FFC85C` Warm Yellow | Sensor Alert |
| 0 | 🩵 `#00E5FF` Cyan | Routine DATA / HEARTBEAT |

---

## License

This project is for academic and educational purposes.  
MIT License — feel free to fork, extend, and learn from it.

---
