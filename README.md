# ResQMesh — Disaster Intelligence Platform

> **Intelligent Self-Healing Disaster Communication & Rescue Routing System**
>
> An interactive Graph-Theory, Networking, and IoT Disaster Intelligence Platform.  
> Explore algorithms, visualize mesh networks, and simulate disaster rescue operations in real time.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Live Modules](#live-modules)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Algorithms Implemented](#algorithms-implemented)
- [Simulation Engine](#simulation-engine)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
- [Key Concepts](#key-concepts)
- [Screenshots & UI](#screenshots--ui)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

**ResQMesh** is an academic-grade, browser-based simulation platform that models how a self-healing mesh network of IoT sensor nodes would behave during a disaster scenario (fires, floods, building collapses, etc.).

It combines:
- **Graph theory** — shortest paths, spanning trees, traversal algorithms
- **Network simulation** — real-time packet routing, node failure & recovery, QoS
- **IoT sensor modeling** — temperature, gas, battery, RSSI, latency streams
- **Rescue routing** — TSP-based optimal patrol planning for first responders

The platform is designed as an interactive visualization and teaching tool that brings algorithms to life on a live, animated mesh topology.

---

## Features

| Feature | Description |
|---|---|
| 🗺 **Live Topology Canvas** | Drag-and-drop interactive graph rendered on HTML5 Canvas with animated packet flow |
| ⚡ **Real-Time Sensor Simulation** | Nodes emit live temperature, humidity, gas, battery, RSSI, latency, throughput data |
| 🔄 **Self-Healing Mesh** | Node failure triggers automatic BFS connectivity re-check and route recalculation |
| 🧮 **Step-by-Step Algorithm Visualizer** | Watch Dijkstra, Bellman-Ford, BFS, DFS, Prim's, TSP execute node-by-node with annotations |
| 📦 **Packet Simulator** | DATA / SOS / HEARTBEAT / ROUTING_UPDATE / SENSOR_ALERT packets routed via Dijkstra |
| 🆘 **Rescue Mode** | TSP Branch-and-Bound computes optimal multi-stop rescue patrol routes |
| 📊 **Network Analytics** | Real-time delivery rate, packet loss, avg latency, battery health, graph density |
| 🗺 **Routing Tables** | Per-node Dijkstra-computed forwarding tables with next-hop, cost, and hop count |
| 🔔 **Event Stream** | Live timestamped log of all network events, alerts, and algorithm steps |

---

## Live Modules

### 1. `Command Center` (`/command`)
The operational dashboard. Contains:
- **Live Topology Canvas** — renders the mesh graph; drag nodes freely; edges show weight labels and animated data-flow
- **Node Inspector** — click any node to see all its sensor readings and its full Dijkstra routing table
- **Node Controls** — add nodes, fail nodes, recover nodes, remove nodes on the fly
- **Event Stream** — scrolling log of all simulation events with color-coded severity

### 2. `Algorithm Lab` (`/algorithms`)
Step-through algorithm visualizer:
- Select any source node and algorithm
- Step forward/backward through each decision
- See highlighted edges/nodes change color in real time on the canvas
- Read the human-readable description of each step at the bottom

### 3. `Network Center` (`/network`)
Deep network diagnostics:
- Adjacency matrix view
- Per-node routing table aggregation
- Real-time sensor sparklines (Chart.js)
- Packet log with QoS filtering

### 4. `Rescue Mode` (`/rescue`)
Disaster response planning:
- Mark nodes as alert/rescue targets
- Run TSP Branch-and-Bound to compute optimal patrol order
- Visualize the optimal route highlighted on the mesh
- Review states explored vs. pruned (algorithm efficiency view)

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 18 (JSX, Hooks, Context API) |
| **Routing** | React Router DOM v7 (HashRouter) |
| **Build Tool** | Vite 8 + TypeScript |
| **Charts** | Chart.js 4 + react-chartjs-2 |
| **Rendering** | HTML5 Canvas (2D API) — no WebGL |
| **Styling** | Vanilla CSS — custom design system with CSS variables, glassmorphism, neon palette |
| **Fonts** | Google Fonts: Orbitron (display), Share Tech Mono (mono) |
| **State** | React Context (`AppContext`) — global graph + simulation engine shared across all pages |

---

## Architecture

```
AppContext (React Context)
├── MeshGraph           ← graph data structure + all algorithm methods
│   ├── GraphNode       ← node with sensor data, position, status
│   └── GraphEdge       ← weighted edge with bandwidth/latency/packet-loss
└── SimulationEngine    ← real-time tick loop, packet router, alert checker
    ├── EventLog        ← event bus + listener system
    └── Packet          ← routed message with QoS / type / TTL / path
```

The `MeshGraph` and `SimulationEngine` are created once in `App.jsx` and injected via React Context. All pages (`CommandCenter`, `AlgorithmLab`, `NetworkCenter`, `RescueMode`) consume them via the `useApp()` hook.

**Data flow:**
```
SimulationEngine.start()
  ↓  every 1 000 ms
graph.updateSensors()  →  checkAlerts()  →  notify() → React re-render
  ↓  every 2 000 ms
generateRandomPacket() → graph.dijkstra() → route packet → EventLog
```

---

## Algorithms Implemented

All algorithms live in `src/engine/graph.js` and return **step arrays** for visualization.

### Dijkstra's Shortest Path
```
graph.dijkstra(sourceId)
→ { steps[], distances: Map<id,dist>, previous: Map<id,prev> }
```
- Priority-queue (min-heap via sort) relaxation
- Skips `failed` nodes automatically
- Powers all real-time packet routing and routing tables

### Bellman-Ford
```
graph.bellmanFord(sourceId)
→ { steps[], distances, previous }
```
- V−1 iterations over all edges
- Early-exit on convergence
- Supports negative-weight edges (useful for RSSI-weighted topologies)

### BFS — Breadth-First Search
```
graph.bfs(sourceId)
→ { steps[], order[], visited: Set }
```
- Queue-based level-order traversal
- Used internally by self-healing to check connectivity after node failure

### DFS — Depth-First Search
```
graph.dfs(sourceId)
→ { steps[], order[], visited: Set }
```
- Stack-based traversal
- Useful for spanning tree / connectivity probing

### Prim's Minimum Spanning Tree
```
graph.primMST()
→ { steps[], mstEdges[], totalWeight }
```
- Greedy MST from the first active node
- Useful for finding the minimum-cost backbone for sensor data aggregation

### TSP — Branch and Bound
```
graph.tspBranchAndBound(alertNodeIds)
→ { steps[], bestPath[], bestCost, statesExplored, statesPruned, distMatrix }
```
- Precomputes all-pairs shortest paths via repeated Dijkstra
- Recursive branch-and-bound with cost pruning
- Returns optimal rescue patrol order for alert nodes

### Utility Methods
| Method | Description |
|---|---|
| `reconstructPath(previous, targetId)` | Trace back the shortest path from prev-map |
| `getRoutingTable(nodeId)` | Full Dijkstra forwarding table for a node |
| `getAdjacencyMatrix()` | Dense matrix representation |
| `getStats()` | Active nodes, edges, density |

---

## Simulation Engine

`src/engine/simulation.js` manages the live simulation loop.

### Packet Types & QoS
| Type | Icon | Default QoS |
|---|---|---|
| DATA | 📦 | 0 (Low) |
| HEARTBEAT | 💓 | 0 |
| SENSOR_ALERT | ⚠️ | 1 (Medium) |
| ROUTING_UPDATE | 🔄 | 0 |
| SOS | 🆘 | 2 (High — Neon Orange) |

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
├── index.html                  # App entry, meta description, title
├── package.json                # Vite + React + Chart.js + React Router
├── tsconfig.json
├── vite.config.*
└── src/
    ├── main.jsx                # ReactDOM.render root
    ├── App.jsx                 # AppContext, routing shell, sidebar nav
    ├── App.css                 # Global design system (CSS variables, glass panels, animations)
    ├── index.css               # Base resets and typography
    ├── style.css               # Additional utility classes
    ├── engine/
    │   ├── graph.js            # MeshGraph, GraphNode, GraphEdge, all algorithms
    │   └── simulation.js       # SimulationEngine, Packet, EventLog
    └── pages/
        ├── Landing.jsx         # Animated hero page with canvas particle mesh
        ├── CommandCenter.jsx   # Live topology + inspector + event log
        ├── AlgorithmLab.jsx    # Step-through algorithm visualizer
        ├── NetworkCenter.jsx   # Adjacency matrix, routing tables, sensor charts
        └── RescueMode.jsx      # TSP rescue planner + route visualizer
```

---

## Getting Started

### Prerequisites
- **Node.js** ≥ 18
- **npm** ≥ 9

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/ResQMesh.git
cd ResQMesh

# Install dependencies
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build

```bash
npm run build
npm run preview
```

---

## Usage Guide

### Creating a Mesh Network
1. Launch the app → Click **"Launch Simulation"** on the landing page
2. The default 5-node pentagon mesh (Nodes A–E) is loaded automatically
3. Click **`+ Node`** in the Command Center to add new nodes (auto-wired to 2 random existing nodes)
4. **Drag** any node on the canvas to reposition it

### Simulating Failures
1. Click any node on the canvas to select it
2. Use **`✕ Fail`** to take the node offline — watch routes re-calculate
3. Use **`↻ Recover`** to bring it back online
4. Monitor the Event Stream for self-healing notifications

### Running Algorithms
1. Navigate to **Algorithm Lab**
2. Pick a source node from the dropdown
3. Select an algorithm (Dijkstra / Bellman-Ford / BFS / DFS / Prim's)
4. Click **▶ Run** then use **← Step** / **Step →** to walk through each decision
5. The canvas highlights currently visited nodes and relaxed edges in real time

### Rescue Planning (TSP)
1. Navigate to **Rescue Mode**
2. Toggle nodes as **alert targets** using the node list
3. Click **Run TSP** — Branch & Bound finds the optimal patrol order
4. The optimal route is drawn on the topology canvas
5. Stats show total cost, states explored, and states pruned

---

## Key Concepts

### Normalized Coordinates
Nodes store positions as `(nx, ny) ∈ [0,1]²` (normalized fractions) so the graph scales to any canvas size without distortion. Pixel positions are computed on every render frame via:
```js
x = pad + nx * (canvasWidth  - 2*pad)
y = pad + ny * (canvasHeight - 2*pad)
```

### Graph Density
```
density = (2 × |E|) / (|V| × (|V| − 1))
```
Displayed as a percentage in the Command Center analytics strip.

### QoS Color Coding
| QoS | Color | Use Case |
|---|---|---|
| 2 | 🟠 `#FF653F` Neon Orange | SOS / Emergency |
| 1 | 🟡 `#FFC85C` Warm Yellow | Sensor Alert |
| 0 | 🩵 `#00E5FF` Cyan | Routine DATA / HEARTBEAT |

---

## Roadmap

- [ ] OSPF / RIP protocol simulation
- [ ] Multi-hop packet animation along the full path (currently segment-interpolated)
- [ ] Export topology as JSON / import custom topologies
- [ ] Battery depletion failure events (auto-fail when battery < 5%)
- [ ] Kruskal's MST implementation for comparison with Prim's
- [ ] A* pathfinding with Euclidean heuristic
- [ ] WebSocket-based multi-user collaborative topology editing
- [ ] Mobile responsive layout for tablet viewing

---

## License

This project is for academic and educational purposes.  
MIT License — feel free to fork, extend, and learn from it.

---

<div align="center">
  <strong>ResQMesh</strong> — Built for graph theory, networking, and disaster intelligence education.<br/>
  <em>◈ RQM — Rescue. Route. Recover.</em>
</div>
