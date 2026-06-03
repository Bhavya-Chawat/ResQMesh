# ResQMesh

**Intelligent Self-Healing Disaster Communication & Rescue Routing System**

ResQMesh is a disaster-response communication platform combining ESP32-based mesh networking, IoT sensing, graph algorithms, and real-time visualization to provide resilient communication and situational awareness when traditional infrastructure is unavailable.

Designed for flood, earthquake, landslide, and building-collapse scenarios where cellular networks are unavailable or unreliable.

---

## Table of Contents

1. [Features](#features)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Project Structure](#project-structure)
5. [Firmware Architecture](#firmware-architecture)
6. [Installation](#installation)
7. [Frontend Setup](#frontend-setup)
8. [Backend Setup](#backend-setup)
9. [MQTT Setup](#mqtt-setup)
10. [Firmware Setup](#firmware-setup)
11. [Running in Simulation Mode](#running-in-simulation-mode)
12. [Running in Hardware Mode](#running-in-hardware-mode)
13. [MQTT Topics](#mqtt-topics)
14. [REST API](#rest-api)
15. [WebSocket Events](#websocket-events)
16. [Firmware Configuration](#firmware-configuration)
17. [Demo Workflow](#demo-workflow)
18. [Future Work](#future-work)
19. [License](#license)

---

## Features

### Mesh Networking (Firmware)

| Feature | Detail |
|---|---|
| Discovery | HELLO / HELLO\_ACK broadcast, dynamic peer registration, neighbor table with RSSI EMA |
| Distance Vector Routing | Bellman-Ford relaxation, RSSI-based link cost `max(1, 110 + RSSI)`, per-destination routing table |
| Multi-hop Forwarding | Next-hop lookup, TTL decrement and drop, loop guard |
| Deduplication | Per-source 16-bit sequence numbers, 32-slot circular seen-set |
| QoS Queues | Four strict-priority ring buffers — HIGH / MEDIUM / LOW / DEBUG |
| Failure Detection | Heartbeat every 2 s, neighbor eviction after 15 s silence |
| Route Reconvergence | Immediate poison-reverse on neighbor loss, triggered DV broadcast, topology push |
| Self-healing | Automatic re-routing around failed nodes within one DV cycle |

### IoT Sensing

- Temperature & humidity (DHT22)
- Gas / smoke level (MQ-2)
- Battery voltage monitor
- Real-time alert generation

### Algorithms (Frontend Simulation Engine)

- Dijkstra Shortest Path
- Bellman-Ford Routing Updates
- Breadth-First Search (BFS)
- Depth-First Search (DFS)
- Prim's Minimum Spanning Tree
- Traveling Salesman Problem (Branch & Bound)

### Dashboard

- Live topology visualization
- Node health monitoring
- Routing table inspection
- Adjacency matrix visualization
- Packet monitoring
- Rescue route planning
- Event and alert feed

### Backend Services

- MQTT integration (Paho)
- WebSocket streaming (Flask-SocketIO)
- Topology & node-state management (NetworkX)
- Heartbeat failure detection (6 s timeout)
- REST APIs for topology, nodes, and health

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ESP32 Mesh Nodes (N nodes)                                 │
│  discovery.h → routing.h → forwarding.h → qos_queue.h      │
└───────────────────────┬─────────────────────────────────────┘
                        │ ESP-NOW (2.4 GHz)
┌───────────────────────▼─────────────────────────────────────┐
│  Gateway ESP32                                               │
│  resqmesh_node.ino  (IS_GATEWAY = true)                     │
│  ESP-NOW receive → MQTT publish                             │
└───────────────────────┬─────────────────────────────────────┘
                        │ MQTT (TCP 1883)
┌───────────────────────▼─────────────────────────────────────┐
│  Mosquitto MQTT Broker                                       │
└───────────────────────┬─────────────────────────────────────┘
                        │ subscribe
┌───────────────────────▼─────────────────────────────────────┐
│  Flask Backend  (backend/app.py)                            │
│  • Paho MQTT consumer                                       │
│  • NetworkX topology graph                                  │
│  • Heartbeat failure detection                              │
│  • REST API  /api/topology  /api/nodes  /api/health         │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket (Socket.IO)
┌───────────────────────▼─────────────────────────────────────┐
│  React Dashboard  (src/)                                    │
│  • Live graph visualization                                 │
│  • Simulation engine (Dijkstra, BFS, DFS, MST, TSP)        │
│  • Hardware data adapter (websocketService.js)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend
| Package | Version |
|---|---|
| React + TypeScript | 18 |
| Vite | ^8 |
| Chart.js + react-chartjs-2 | ^4 / ^5 |
| React Router DOM | ^7 |
| Socket.IO Client | ^4 |

### Backend
| Package | Version |
|---|---|
| Flask | 3.0.3 |
| Flask-SocketIO | 5.3.6 |
| Flask-CORS | 4.0.1 |
| Paho MQTT | 2.1.0 |
| NetworkX | 3.3 |
| Eventlet | 0.36.1 |
| python-dotenv | 1.0.1 |

### Firmware
| Component | Detail |
|---|---|
| MCU | ESP32 (any variant with 2.4 GHz WiFi) |
| Transport | ESP-NOW (250-byte frames, 2.4 GHz) |
| Sensors | DHT22 (temp/humidity), MQ-2 (gas), voltage divider (battery) |
| Libraries | ArduinoJson, PubSubClient, DHT sensor library |
| Broker | Mosquitto 2.x |

---

## Project Structure

```
ResQMesh/
│
├── src/                          # React frontend (TypeScript)
│   ├── pages/                    # Dashboard pages
│   ├── engine/                   # Graph & simulation engine
│   ├── services/                 # websocketService.js, hardwareDataAdapter.js
│   └── components/               # UI components
│
├── backend/                      # Python Flask backend
│   ├── app.py                    # Main server (MQTT + WebSocket + REST)
│   ├── mqtt_consumer.py          # MQTT subscriber helper
│   └── requirements.txt
│
├── firmware/
│   └── resqmesh_node/            # Single sketch flashed on all ESP32s
│       ├── config.h              # Per-node identity, WiFi, timing constants
│       ├── mesh_types.h          # MeshFrame wire format, QosPriority enum
│       ├── discovery.h           # HELLO/HELLO_ACK, neighbor table
│       ├── routing.h             # Distance Vector routing, reconvergence
│       ├── forwarding.h          # Multi-hop forwarding, TTL, dedup
│       ├── qos_queue.h           # Four-priority transmission queue
│       └── resqmesh_node.ino     # Main sketch (orchestrates all modules)
│
├── public/
├── index.html
├── package.json
├── tsconfig.json
├── .env                          # Frontend environment variables
├── .env.hardware                 # Hardware-mode overrides
└── README.md
```

---

## Firmware Architecture

The firmware is split into five single-header modules, included in `resqmesh_node.ino`:

```
resqmesh_node.ino
│
├── config.h          Node identity, WiFi/MQTT credentials, all timing constants
├── mesh_types.h      MeshFrame wire struct, PktType enum, QosPriority enum, frameInit()
├── discovery.h       HELLO/HELLO_ACK, neighbor table, eviction callback → routing
├── routing.h         DV table, Bellman-Ford, onNeighborLost(), broadcastDV() → qosQueue
├── forwarding.h      Dedup cache, TTL check, next-hop send → qosQueue
└── qos_queue.h       4 × ring-buffer queues, drainOne() called in loop()
```

### Frame layout (`MeshFrame`, 226 bytes, packed)

| Field | Type | Description |
|---|---|---|
| `pktType` | `uint8_t` | PKT\_HELLO / HELLO\_ACK / DV\_UPDATE / SENSOR / HEARTBEAT / ALERT / TOPOLOGY |
| `srcId` | `char[8]` | Originating node ID |
| `dstId` | `char[8]` | Destination node ID; `"**"` = broadcast, `"GW"` = gateway |
| `srcMac` | `uint8_t[6]` | Originating MAC |
| `rssi` | `int8_t` | Sender-side RSSI (HELLO frames only) |
| `ttl` | `uint8_t` | Hops remaining (default 7); frame dropped at 0 |
| `seqNum` | `uint16_t` | Per-source sequence number for deduplication |
| `payload` | `char[196]` | JSON string payload |

### QoS priority mapping

| Priority | Level | Packet types |
|---|---|---|
| `QOS_HIGH` | 0 | `PKT_ALERT` — emergency/SOS |
| `QOS_MEDIUM` | 1 | `PKT_SENSOR`, `PKT_HEARTBEAT`, `PKT_TOPOLOGY` |
| `QOS_LOW` | 2 | `PKT_DATA`, `PKT_DV_UPDATE` |
| `QOS_DEBUG` | 3 | Future diagnostic types |

### Reconvergence sequence on node failure

```
Neighbor timeout (NEIGHBOR_TIMEOUT_MS = 15 s)
  └─ discovery: evict neighbor, fire OnNeighborLostCb
        ├─ routing.onNeighborLost() — poison all routes via dead node
        │                             _dirty = true
        └─ publishTopology()       — immediate topology push to backend

  Next routing.tick() (< 10 ms)
        └─ _dirty → broadcastDV() → qosQueue enqueue DV_UPDATE

  Neighbors receive poison DV_UPDATE
        └─ handleDvUpdate() → invalidate route → _dirty → re-broadcast
           (converges hop-by-hop across the mesh)
```

---

## Installation

### Prerequisites

- Node.js 18+
- Python 3.10+
- Mosquitto MQTT Broker 2.x
- Arduino IDE 2.x **or** PlatformIO
- ESP32 Arduino core (Board Manager: `esp32` by Espressif)

---

## Frontend Setup

Install dependencies:

```bash
npm install
```

Create `.env` in the project root:

```env
VITE_BACKEND_URL=http://localhost:5000
VITE_SIMULATION_MODE=true
```

> Set `VITE_SIMULATION_MODE=false` when using real ESP32 hardware.

Start the development server:

```bash
npm run dev
```

Frontend available at `http://localhost:5173`

---

## Backend Setup

Navigate to backend:

```bash
cd backend
```

Create and activate a virtual environment:

```bash
# Create
python -m venv ../venv

# Windows
..\venv\Scripts\activate

# Linux / macOS
source ../venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure backend (optional — defaults work out of the box):

```bash
# backend/.env (auto-loaded by python-dotenv)
MQTT_BROKER=localhost
MQTT_PORT=1883
SECRET_KEY=resqmesh-secret
```

Run backend:

```bash
python app.py
```

Backend available at `http://localhost:5000`

---

## MQTT Setup

### Install Mosquitto

**Windows:** Download from [mosquitto.org](https://mosquitto.org/download/) and install.

**Linux:**
```bash
sudo apt install mosquitto mosquitto-clients
```

### Start the broker

**Windows:**
```bash
mosquitto
```

**Linux:**
```bash
sudo systemctl start mosquitto
sudo systemctl enable mosquitto
```

### Verify

```bash
mosquitto_sub -h localhost -t "#" -v
```

Default broker address: `localhost:1883`

---

## Firmware Setup

### Arduino IDE

1. Open **Arduino IDE 2.x**
2. Install board: **Tools → Board Manager → search "esp32" → install Espressif Systems**
3. Install libraries via **Library Manager**:
   - `ArduinoJson` by Benoit Blanchon
   - `PubSubClient` by Nick O'Leary
   - `DHT sensor library` by Adafruit
4. Open `firmware/resqmesh_node/resqmesh_node.ino`

### Configure each node

Edit `config.h` before flashing:

```cpp
// ── Per-node identity ─────────────────────────────────────────
#define NODE_ID     "A"         // Unique ID (≤ 7 chars), e.g. "A", "B", "GW"
#define NODE_LABEL  "Node A"    // Display name

// ── Role ──────────────────────────────────────────────────────
#define IS_GATEWAY  false       // true only for the gateway node

// ── WiFi / MQTT (gateway only) ────────────────────────────────
#define WIFI_SSID     "YOUR_SSID"
#define WIFI_PASSWORD "YOUR_PASSWORD"
#define MQTT_BROKER   "192.168.1.100"   // IP of the Mosquitto host
#define MQTT_PORT     1883
```

### Timing constants (all in `config.h`)

| Constant | Default | Purpose |
|---|---|---|
| `HELLO_INTERVAL_MS` | 5 000 ms | HELLO broadcast interval |
| `NEIGHBOR_TIMEOUT_MS` | 15 000 ms | Evict neighbor after this silence |
| `DV_UPDATE_INTERVAL_MS` | 6 000 ms | Periodic DV broadcast interval |
| `ROUTE_TIMEOUT_MS` | 20 000 ms | Invalidate route after this age |
| `HEARTBEAT_INTERVAL_MS` | 2 000 ms | Heartbeat TX interval |
| `SENSOR_INTERVAL_MS` | 2 000 ms | Sensor publish interval |
| `TOPOLOGY_INTERVAL_MS` | 10 000 ms | Topology report interval |
| `QOS_QUEUE_DEPTH` | 8 | Slots per priority ring buffer |
| `QOS_DRAIN_BUDGET_MS` | 8 ms | Max QoS drain time per loop() call |

### Flash order

1. Flash **gateway node** first — note its MAC address from Serial Monitor
2. Flash **mesh nodes** — set `IS_GATEWAY false`, unique `NODE_ID` per node
3. Power all devices
4. Open Serial Monitor (115200 baud) to observe discovery, routing, and forwarding logs

---

## Running in Simulation Mode

No hardware required.

1. Set `.env`: `VITE_SIMULATION_MODE=true`
2. Start backend: `cd backend && python app.py`
3. Start frontend: `npm run dev`
4. Open `http://localhost:5173`

The dashboard generates simulated nodes, sensor readings, packets, and routing events using the built-in graph engine.

---

## Running in Hardware Mode

1. Set `.env`: `VITE_SIMULATION_MODE=false`
2. Start Mosquitto broker
3. Start Flask backend: `cd backend && python app.py`
4. Flash and power all ESP32 nodes (gateway first)
5. Start frontend: `npm run dev`
6. Open `http://localhost:5173`

The dashboard automatically receives live topology, sensor data, and failure events via WebSocket.

---

## MQTT Topics

All topics use the scheme `resqmesh/{node_id}/{type}`.

| Topic | Direction | Payload |
|---|---|---|
| `resqmesh/{node_id}/sensor` | Node → Backend | `{nodeId, temperature, humidity, gasLevel, battery, rssi}` |
| `resqmesh/{node_id}/heartbeat` | Node → Backend | `{nodeId, ts}` |
| `resqmesh/{node_id}/alert` | Node → Backend | `{nodeId, type, severity, message}` |
| `resqmesh/{node_id}/topology` | Node → Backend | `{nodeId, neighbours[], routes[]}` |
| `resqmesh/network/events` | Backend → All | `{type, nodeId, message, ts}` |

---

## REST API

Base URL: `http://localhost:5000`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/topology` | Full graph: nodes + edges |
| `GET` | `/api/nodes` | All known nodes with current state |
| `GET` | `/api/nodes/{id}` | Single node details |
| `GET` | `/api/health` | Backend health check |
| `POST` | `/api/nodes/{id}/fail` | Simulate node failure |
| `POST` | `/api/nodes/{id}/recover` | Simulate node recovery |

---

## WebSocket Events

Namespace: `/` (Socket.IO)

| Event | Direction | Payload |
|---|---|---|
| `topology_update` | Server → Client | Updated graph topology |
| `node_update` | Server → Client | Single node state change |
| `sensor_data` | Server → Client | Live sensor reading |
| `alert` | Server → Client | Emergency alert |
| `node_failure` | Server → Client | Node failure detected |
| `node_recovery` | Server → Client | Node back online |

---

## Demo Workflow

1. Start all ESP32 nodes and observe automatic mesh formation in the Serial Monitor.
2. Open the dashboard — live nodes appear as the topology is reported.
3. Disconnect a node (cut power or block RF) — watch the backend detect the heartbeat timeout, the firmware poison-reverse propagate, and the topology update within one DV cycle.
4. Reconnect the node — observe automatic route reconvergence and topology recovery.
5. Trigger a gas alert (bring MQ-2 near smoke) — HIGH-priority alert frame is queued and forwarded to the gateway with highest QoS.
6. Open Rescue Mode on the dashboard — run Dijkstra or TSP to compute optimal rescue routes over the live topology.

---

## Future Work

- LoRa integration for long-range links
- Drone relay nodes
- TinyML-based failure prediction
- Reinforcement-learning adaptive routing
- Satellite backhaul support
- Hybrid BLE / LoRa / WiFi mesh
- Encrypted mesh frames (ESP-NOW CCM)

---

## License

Academic / Educational Use.  
Project developed as part of an engineering disaster-response and networking research initiative.
