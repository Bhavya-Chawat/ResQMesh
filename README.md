# ResQMesh

**Intelligent Self-Healing Disaster Communication & Rescue Routing System**

ResQMesh is a disaster-response communication platform that combines ESP32-based mesh networking, IoT sensing, graph algorithms, and real-time visualization to provide resilient communication and situational awareness when traditional infrastructure is unavailable.

The project is designed for disaster scenarios such as floods, earthquakes, landslides, and building collapses where cellular networks may be unavailable or unreliable.

---

## Features

### Mesh Networking

* ESP-NOW based ESP32 mesh communication
* Dynamic node discovery using HELLO / HELLO_ACK packets
* Neighbor table maintenance
* Multi-hop packet forwarding
* TTL-based packet expiry
* Sequence-number based packet deduplication
* RSSI-aware routing metrics

### Routing & Self-Healing

* Distance Vector routing
* Dynamic routing table maintenance
* Route invalidation on node failure
* Heartbeat-based liveness monitoring
* Automatic route reconvergence
* Self-healing network topology

### IoT Monitoring

* Temperature sensing
* Humidity sensing
* Gas / smoke detection
* Battery monitoring
* Real-time alert generation

### Algorithms

* Dijkstra Shortest Path
* Bellman-Ford Routing Updates
* Breadth First Search (BFS)
* Depth First Search (DFS)
* Prim's Minimum Spanning Tree
* Traveling Salesman Problem (Branch & Bound)

### Dashboard

* Live topology visualization
* Node health monitoring
* Routing table inspection
* Adjacency matrix visualization
* Packet monitoring
* Rescue route planning
* Event and alert feed

### Backend Services

* MQTT integration
* WebSocket streaming
* Topology management
* Node state tracking
* Health monitoring APIs

---

# System Architecture

ESP32 Nodes

↓

ESP-NOW Mesh Network

↓

Gateway ESP32

↓

MQTT Broker (Mosquitto)

↓

Flask Backend

↓

WebSocket Layer

↓

React Dashboard

---

# Technology Stack

## Frontend

* React 18
* Vite
* React Router
* Chart.js
* Socket.IO Client
* HTML5 Canvas

## Backend

* Python
* Flask
* Flask-SocketIO
* Paho MQTT
* NetworkX
* Eventlet

## Firmware

* ESP32
* ESP-NOW
* WiFi
* MQTT
* DHT Sensor
* MQ2 Gas Sensor

---

# Project Structure

```text
ResQMesh/
│
├── src/
│   ├── pages/
│   ├── engine/
│   ├── services/
│   └── components/
│
├── backend/
│   ├── app.py
│   ├── mqtt_consumer.py
│   └── requirements.txt
│
├── firmware/
│   ├── resqmesh_node/
│   └── gateway/
│
├── public/
│
└── README.md
```

---

# Installation

## Prerequisites

Install:

* Node.js 18+
* Python 3.10+
* Mosquitto MQTT Broker
* Arduino IDE or PlatformIO
* ESP32 Board Package

---

# Frontend Setup

Install dependencies:

```bash
npm install
```

Create `.env`:

```env
VITE_BACKEND_URL=http://localhost:5000
VITE_SIMULATION_MODE=true
```

Start frontend:

```bash
npm run dev
```

Frontend will be available at:

```text
http://localhost:5173
```

---

# Backend Setup

Navigate to backend:

```bash
cd backend
```

Create virtual environment:

```bash
python -m venv venv
```

Activate environment:

### Windows

```bash
venv\Scripts\activate
```

### Linux / macOS

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run backend:

```bash
python app.py
```

Backend runs at:

```text
http://localhost:5000
```

---

# MQTT Setup

Install Mosquitto.

Start broker:

### Windows

```bash
mosquitto
```

### Linux

```bash
sudo systemctl start mosquitto
```

Verify:

```bash
mosquitto_sub -t "#"
```

Default broker:

```text
localhost:1883
```

---

# Running in Simulation Mode

Set:

```env
VITE_SIMULATION_MODE=true
```

Start:

1. Backend
2. Frontend

The dashboard will generate simulated nodes, sensors, packets, and routing events.

No hardware required.

---

# Running in Hardware Mode

Set:

```env
VITE_SIMULATION_MODE=false
```

Steps:

1. Start Mosquitto Broker
2. Start Flask Backend
3. Flash ESP32 Node Firmware
4. Flash Gateway Firmware
5. Power all ESP32 devices
6. Open Dashboard

Dashboard will automatically receive live topology and sensor data.

---

# MQTT Topics

Sensor Data

```text
resqmesh/{node_id}/sensor
```

Heartbeat

```text
resqmesh/{node_id}/heartbeat
```

Alerts

```text
resqmesh/{node_id}/alert
```

Topology Updates

```text
resqmesh/{node_id}/topology
```

Network Events

```text
resqmesh/network/events
```

---

# REST API

Get topology

```http
GET /api/topology
```

Get nodes

```http
GET /api/nodes
```

Get node

```http
GET /api/nodes/{id}
```

Get health

```http
GET /api/health
```

Fail node

```http
POST /api/nodes/{id}/fail
```

Recover node

```http
POST /api/nodes/{id}/recover
```

---

# Demo Workflow

1. Start all ESP32 nodes.
2. Observe automatic mesh formation.
3. Trigger a gas alert.
4. Watch alert propagation.
5. Disconnect a node.
6. Observe network reconvergence.
7. Open Rescue Mode.
8. Compute optimal rescue route.
9. View routing updates in real time.

---

# Future Work

* LoRa integration
* Drone relay nodes
* TinyML-based failure prediction
* Reinforcement-learning routing
* Satellite backhaul support
* Hybrid BLE/LoRa/WiFi mesh

---

# License

Academic / Educational Use.
Project developed as part of an engineering disaster-response and networking research initiative.
