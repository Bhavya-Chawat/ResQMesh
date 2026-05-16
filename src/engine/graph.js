/**
 * ResQMesh Graph Engine
 * Core graph data structure and algorithm implementations
 * for mesh network simulation and academic visualization.
 */

export class GraphNode {
  constructor(id, label, x, y, data = {}) {
    this.id = id;
    this.label = label || `Node ${id}`;
    this.x = x;
    this.y = y;
    this.data = {
      temperature: 25 + Math.random() * 20,
      humidity: 40 + Math.random() * 40,
      gasLevel: 100 + Math.random() * 300,
      battery: 60 + Math.random() * 40,
      rssi: -30 - Math.random() * 60,
      latency: 5 + Math.random() * 45,
      throughput: 50 + Math.random() * 200,
      signalQuality: 50 + Math.random() * 50,
      packetQueue: [],
      status: 'active', // active, failed, warning, critical
      ...data,
    };
    this.vx = 0;
    this.vy = 0;
  }

  updateSensors() {
    this.data.temperature += (Math.random() - 0.48) * 2;
    this.data.humidity += (Math.random() - 0.5) * 3;
    this.data.gasLevel += (Math.random() - 0.45) * 20;
    this.data.battery -= Math.random() * 0.1;
    this.data.rssi += (Math.random() - 0.5) * 5;
    this.data.latency += (Math.random() - 0.5) * 4;
    this.data.throughput += (Math.random() - 0.5) * 10;
    this.data.signalQuality += (Math.random() - 0.5) * 3;

    // Clamp values
    this.data.temperature = Math.max(10, Math.min(100, this.data.temperature));
    this.data.humidity = Math.max(10, Math.min(99, this.data.humidity));
    this.data.gasLevel = Math.max(50, Math.min(1000, this.data.gasLevel));
    this.data.battery = Math.max(0, Math.min(100, this.data.battery));
    this.data.rssi = Math.max(-90, Math.min(-20, this.data.rssi));
    this.data.latency = Math.max(1, Math.min(100, this.data.latency));
    this.data.throughput = Math.max(10, Math.min(300, this.data.throughput));
    this.data.signalQuality = Math.max(10, Math.min(100, this.data.signalQuality));

    // Determine status based on thresholds
    if (this.data.status === 'failed') return;
    if (this.data.temperature > 60 || this.data.gasLevel > 600 || this.data.battery < 15) {
      this.data.status = 'critical';
    } else if (this.data.temperature > 45 || this.data.gasLevel > 400 || this.data.battery < 30) {
      this.data.status = 'warning';
    } else {
      this.data.status = 'active';
    }
  }
}

export class GraphEdge {
  constructor(source, target, weight = 1, data = {}) {
    this.source = source;
    this.target = target;
    this.weight = weight;
    this.data = {
      latency: weight,
      bandwidth: 100 + Math.random() * 200,
      packetLoss: Math.random() * 5,
      status: 'active',
      ...data,
    };
  }
}

export class MeshGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.adjacencyList = new Map();
  }

  addNode(node) {
    this.nodes.set(node.id, node);
    if (!this.adjacencyList.has(node.id)) {
      this.adjacencyList.set(node.id, []);
    }
    return node;
  }

  removeNode(nodeId) {
    this.nodes.delete(nodeId);
    this.adjacencyList.delete(nodeId);
    this.edges = this.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    for (const [, neighbors] of this.adjacencyList) {
      const idx = neighbors.findIndex(n => n.nodeId === nodeId);
      if (idx !== -1) neighbors.splice(idx, 1);
    }
  }

  addEdge(source, target, weight) {
    const edge = new GraphEdge(source, target, weight);
    this.edges.push(edge);
    if (!this.adjacencyList.has(source)) this.adjacencyList.set(source, []);
    if (!this.adjacencyList.has(target)) this.adjacencyList.set(target, []);
    this.adjacencyList.get(source).push({ nodeId: target, weight, edge });
    this.adjacencyList.get(target).push({ nodeId: source, weight, edge });
    return edge;
  }

  removeEdge(source, target) {
    this.edges = this.edges.filter(e => !(
      (e.source === source && e.target === target) ||
      (e.source === target && e.target === source)
    ));
    const srcAdj = this.adjacencyList.get(source);
    if (srcAdj) {
      const idx = srcAdj.findIndex(n => n.nodeId === target);
      if (idx !== -1) srcAdj.splice(idx, 1);
    }
    const tgtAdj = this.adjacencyList.get(target);
    if (tgtAdj) {
      const idx = tgtAdj.findIndex(n => n.nodeId === source);
      if (idx !== -1) tgtAdj.splice(idx, 1);
    }
  }

  getNeighbors(nodeId) {
    return this.adjacencyList.get(nodeId) || [];
  }

  getAdjacencyMatrix() {
    const nodeIds = Array.from(this.nodes.keys());
    const n = nodeIds.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(Infinity));
    for (let i = 0; i < n; i++) matrix[i][i] = 0;
    for (const edge of this.edges) {
      const i = nodeIds.indexOf(edge.source);
      const j = nodeIds.indexOf(edge.target);
      if (i !== -1 && j !== -1) {
        matrix[i][j] = edge.weight;
        matrix[j][i] = edge.weight;
      }
    }
    return { matrix, nodeIds };
  }

  getEdge(source, target) {
    return this.edges.find(e =>
      (e.source === source && e.target === target) ||
      (e.source === target && e.target === source)
    );
  }

  updateSensors() {
    for (const [, node] of this.nodes) {
      if (node.data.status !== 'failed') {
        node.updateSensors();
      }
    }
  }

  // ========== ALGORITHMS ==========

  /**
   * Dijkstra's Shortest Path Algorithm
   * Returns step-by-step execution for visualization
   */
  dijkstra(sourceId) {
    const steps = [];
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    const pq = []; // Min-heap simulated with array

    for (const [id] of this.nodes) {
      dist.set(id, Infinity);
      prev.set(id, null);
    }
    dist.set(sourceId, 0);
    pq.push({ id: sourceId, dist: 0 });

    steps.push({
      type: 'init',
      description: `Initialize: Set distance of source ${this.nodes.get(sourceId)?.label} to 0, all others to ∞`,
      distances: new Map(dist),
      visited: new Set(visited),
      current: sourceId,
      pq: [...pq],
    });

    while (pq.length > 0) {
      pq.sort((a, b) => a.dist - b.dist);
      const { id: u } = pq.shift();

      if (visited.has(u)) continue;
      visited.add(u);

      const nodeLabel = this.nodes.get(u)?.label || u;
      steps.push({
        type: 'visit',
        description: `Visit node ${nodeLabel} (distance: ${dist.get(u).toFixed(1)})`,
        distances: new Map(dist),
        visited: new Set(visited),
        current: u,
        pq: [...pq],
      });

      const neighbors = this.getNeighbors(u);
      for (const { nodeId: v, weight } of neighbors) {
        if (visited.has(v)) continue;
        if (this.nodes.get(v)?.data.status === 'failed') continue;

        const alt = dist.get(u) + weight;
        const vLabel = this.nodes.get(v)?.label || v;

        if (alt < dist.get(v)) {
          steps.push({
            type: 'relax',
            description: `Relax edge ${nodeLabel} → ${vLabel}: ${dist.get(v) === Infinity ? '∞' : dist.get(v).toFixed(1)} → ${alt.toFixed(1)}`,
            distances: new Map(dist),
            visited: new Set(visited),
            current: u,
            relaxEdge: { source: u, target: v },
            oldDist: dist.get(v),
            newDist: alt,
            pq: [...pq],
          });
          dist.set(v, alt);
          prev.set(v, u);
          pq.push({ id: v, dist: alt });
        }
      }
    }

    steps.push({
      type: 'complete',
      description: 'Dijkstra complete! All shortest paths found.',
      distances: new Map(dist),
      visited: new Set(visited),
      previous: new Map(prev),
    });

    return { steps, distances: dist, previous: prev };
  }

  /**
   * Bellman-Ford Algorithm
   * Handles negative weights and detects negative cycles
   */
  bellmanFord(sourceId) {
    const steps = [];
    const dist = new Map();
    const prev = new Map();
    const nodeIds = Array.from(this.nodes.keys());

    for (const id of nodeIds) {
      dist.set(id, Infinity);
      prev.set(id, null);
    }
    dist.set(sourceId, 0);

    steps.push({
      type: 'init',
      description: `Initialize Bellman-Ford from ${this.nodes.get(sourceId)?.label}`,
      distances: new Map(dist),
      iteration: 0,
    });

    const V = nodeIds.length;
    for (let i = 1; i < V; i++) {
      let updated = false;
      for (const edge of this.edges) {
        if (this.nodes.get(edge.source)?.data.status === 'failed') continue;
        if (this.nodes.get(edge.target)?.data.status === 'failed') continue;

        // Process both directions (undirected)
        for (const [u, v] of [[edge.source, edge.target], [edge.target, edge.source]]) {
          if (dist.get(u) !== Infinity && dist.get(u) + edge.weight < dist.get(v)) {
            const uLabel = this.nodes.get(u)?.label || u;
            const vLabel = this.nodes.get(v)?.label || v;
            steps.push({
              type: 'relax',
              description: `Iteration ${i}: Relax ${uLabel} → ${vLabel}: ${dist.get(v) === Infinity ? '∞' : dist.get(v).toFixed(1)} → ${(dist.get(u) + edge.weight).toFixed(1)}`,
              distances: new Map(dist),
              iteration: i,
              relaxEdge: { source: u, target: v },
              oldDist: dist.get(v),
              newDist: dist.get(u) + edge.weight,
            });
            dist.set(v, dist.get(u) + edge.weight);
            prev.set(v, u);
            updated = true;
          }
        }
      }

      steps.push({
        type: 'iteration',
        description: `Iteration ${i}/${V - 1} complete. ${updated ? 'Updates made.' : 'No updates — converged!'}`,
        distances: new Map(dist),
        iteration: i,
        converged: !updated,
      });

      if (!updated) break;
    }

    steps.push({
      type: 'complete',
      description: 'Bellman-Ford complete!',
      distances: new Map(dist),
      previous: new Map(prev),
    });

    return { steps, distances: dist, previous: prev };
  }

  /**
   * BFS - Breadth-First Search
   */
  bfs(sourceId) {
    const steps = [];
    const visited = new Set();
    const queue = [sourceId];
    visited.add(sourceId);
    const order = [];

    steps.push({
      type: 'init',
      description: `Start BFS from ${this.nodes.get(sourceId)?.label}`,
      visited: new Set(visited),
      queue: [...queue],
      current: sourceId,
    });

    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);
      const label = this.nodes.get(current)?.label || current;

      steps.push({
        type: 'dequeue',
        description: `Dequeue ${label} — process its neighbors`,
        visited: new Set(visited),
        queue: [...queue],
        current,
        order: [...order],
      });

      const neighbors = this.getNeighbors(current);
      for (const { nodeId } of neighbors) {
        if (!visited.has(nodeId) && this.nodes.get(nodeId)?.data.status !== 'failed') {
          visited.add(nodeId);
          queue.push(nodeId);
          const nLabel = this.nodes.get(nodeId)?.label || nodeId;
          steps.push({
            type: 'enqueue',
            description: `Discover ${nLabel} — add to queue`,
            visited: new Set(visited),
            queue: [...queue],
            current,
            discovered: nodeId,
            order: [...order],
          });
        }
      }
    }

    steps.push({
      type: 'complete',
      description: `BFS complete! Visited ${order.length} nodes.`,
      visited: new Set(visited),
      order,
    });

    return { steps, order, visited };
  }

  /**
   * DFS - Depth-First Search
   */
  dfs(sourceId) {
    const steps = [];
    const visited = new Set();
    const stack = [sourceId];
    const order = [];

    steps.push({
      type: 'init',
      description: `Start DFS from ${this.nodes.get(sourceId)?.label}`,
      visited: new Set(visited),
      stack: [...stack],
      current: sourceId,
    });

    while (stack.length > 0) {
      const current = stack.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      order.push(current);

      const label = this.nodes.get(current)?.label || current;
      steps.push({
        type: 'pop',
        description: `Pop ${label} from stack — visit it`,
        visited: new Set(visited),
        stack: [...stack],
        current,
        order: [...order],
      });

      const neighbors = this.getNeighbors(current);
      for (const { nodeId } of neighbors) {
        if (!visited.has(nodeId) && this.nodes.get(nodeId)?.data.status !== 'failed') {
          stack.push(nodeId);
          const nLabel = this.nodes.get(nodeId)?.label || nodeId;
          steps.push({
            type: 'push',
            description: `Push ${nLabel} onto stack`,
            visited: new Set(visited),
            stack: [...stack],
            current,
            discovered: nodeId,
            order: [...order],
          });
        }
      }
    }

    steps.push({
      type: 'complete',
      description: `DFS complete! Visited ${order.length} nodes.`,
      visited: new Set(visited),
      order,
    });

    return { steps, order, visited };
  }

  /**
   * Prim's Minimum Spanning Tree
   */
  primMST() {
    const steps = [];
    const mstEdges = [];
    const inMST = new Set();
    const nodeIds = Array.from(this.nodes.keys()).filter(id => this.nodes.get(id)?.data.status !== 'failed');

    if (nodeIds.length === 0) return { steps, mstEdges };

    const startNode = nodeIds[0];
    inMST.add(startNode);

    steps.push({
      type: 'init',
      description: `Start Prim's MST from ${this.nodes.get(startNode)?.label}`,
      inMST: new Set(inMST),
      mstEdges: [...mstEdges],
    });

    while (inMST.size < nodeIds.length) {
      let minEdge = null;
      let minWeight = Infinity;

      for (const nodeId of inMST) {
        const neighbors = this.getNeighbors(nodeId);
        for (const { nodeId: neighbor, weight } of neighbors) {
          if (!inMST.has(neighbor) && this.nodes.get(neighbor)?.data.status !== 'failed' && weight < minWeight) {
            minWeight = weight;
            minEdge = { source: nodeId, target: neighbor, weight };
          }
        }
      }

      if (!minEdge) break;

      mstEdges.push(minEdge);
      inMST.add(minEdge.target);

      const sLabel = this.nodes.get(minEdge.source)?.label;
      const tLabel = this.nodes.get(minEdge.target)?.label;
      steps.push({
        type: 'addEdge',
        description: `Add edge ${sLabel} — ${tLabel} (weight: ${minEdge.weight.toFixed(1)}) to MST`,
        inMST: new Set(inMST),
        mstEdges: [...mstEdges],
        addedEdge: { ...minEdge },
        totalWeight: mstEdges.reduce((s, e) => s + e.weight, 0),
      });
    }

    const totalWeight = mstEdges.reduce((s, e) => s + e.weight, 0);
    steps.push({
      type: 'complete',
      description: `MST complete! ${mstEdges.length} edges, total weight: ${totalWeight.toFixed(1)}`,
      inMST: new Set(inMST),
      mstEdges: [...mstEdges],
      totalWeight,
    });

    return { steps, mstEdges, totalWeight };
  }

  /**
   * TSP using Branch and Bound
   * For rescue route optimization
   */
  tspBranchAndBound(alertNodeIds) {
    const steps = [];
    const nodes = alertNodeIds.filter(id => this.nodes.has(id));
    if (nodes.length < 2) return { steps, bestPath: nodes, bestCost: 0 };

    // Build distance matrix for alert nodes using Dijkstra
    const distMatrix = new Map();
    for (const src of nodes) {
      const { distances } = this.dijkstra(src);
      distMatrix.set(src, distances);
    }

    let bestPath = null;
    let bestCost = Infinity;
    let statesExplored = 0;
    let statesPruned = 0;

    const solve = (current, visited, path, cost) => {
      statesExplored++;

      if (visited.size === nodes.length) {
        // Return to start
        const returnCost = distMatrix.get(current)?.get(path[0]) || Infinity;
        const totalCost = cost + returnCost;
        if (totalCost < bestCost) {
          bestCost = totalCost;
          bestPath = [...path];
          steps.push({
            type: 'newBest',
            description: `New best route found! Cost: ${totalCost.toFixed(1)}`,
            path: [...path],
            cost: totalCost,
            statesExplored,
            statesPruned,
          });
        }
        return;
      }

      for (const next of nodes) {
        if (visited.has(next)) continue;
        const edgeCost = distMatrix.get(current)?.get(next) || Infinity;
        const newCost = cost + edgeCost;

        // Branch and bound: prune if current cost exceeds best
        if (newCost >= bestCost) {
          statesPruned++;
          steps.push({
            type: 'prune',
            description: `Prune: ${this.nodes.get(current)?.label} → ${this.nodes.get(next)?.label} (cost ${newCost.toFixed(1)} ≥ best ${bestCost.toFixed(1)})`,
            path: [...path, next],
            cost: newCost,
            statesExplored,
            statesPruned,
          });
          continue;
        }

        visited.add(next);
        path.push(next);

        steps.push({
          type: 'explore',
          description: `Explore: ${this.nodes.get(next)?.label} (accumulated cost: ${newCost.toFixed(1)})`,
          path: [...path],
          cost: newCost,
          statesExplored,
          statesPruned,
        });

        solve(next, visited, path, newCost);
        path.pop();
        visited.delete(next);
      }
    };

    const startNode = nodes[0];
    steps.push({
      type: 'init',
      description: `Start TSP Branch & Bound from ${this.nodes.get(startNode)?.label} with ${nodes.length} rescue points`,
      alertNodes: nodes.map(id => this.nodes.get(id)?.label),
    });

    const visited = new Set([startNode]);
    solve(startNode, visited, [startNode], 0);

    steps.push({
      type: 'complete',
      description: `TSP complete! Best cost: ${bestCost.toFixed(1)}, States explored: ${statesExplored}, Pruned: ${statesPruned}`,
      bestPath,
      bestCost,
      statesExplored,
      statesPruned,
    });

    return { steps, bestPath, bestCost, statesExplored, statesPruned, distMatrix };
  }

  /**
   * Reconstruct path from previous map
   */
  reconstructPath(previous, targetId) {
    const path = [];
    let current = targetId;
    while (current !== null) {
      path.unshift(current);
      current = previous.get(current);
    }
    return path;
  }

  /**
   * Get routing table for a node
   */
  getRoutingTable(nodeId) {
    const { distances, previous } = this.dijkstra(nodeId);
    const table = [];
    for (const [destId, dist] of distances) {
      if (destId === nodeId) continue;
      const path = this.reconstructPath(previous, destId);
      const nextHop = path.length > 1 ? path[1] : null;
      table.push({
        destination: destId,
        destLabel: this.nodes.get(destId)?.label || destId,
        distance: dist,
        nextHop,
        nextHopLabel: nextHop ? (this.nodes.get(nextHop)?.label || nextHop) : '—',
        hopCount: path.length - 1,
        path,
      });
    }
    return table;
  }

  /**
   * Graph statistics
   */
  getStats() {
    const activeNodes = Array.from(this.nodes.values()).filter(n => n.data.status !== 'failed').length;
    const totalNodes = this.nodes.size;
    const totalEdges = this.edges.length;
    const activeEdges = this.edges.filter(e =>
      this.nodes.get(e.source)?.data.status !== 'failed' &&
      this.nodes.get(e.target)?.data.status !== 'failed'
    ).length;
    const density = totalNodes > 1 ? (2 * totalEdges) / (totalNodes * (totalNodes - 1)) : 0;

    return { activeNodes, totalNodes, totalEdges, activeEdges, density };
  }
}

/**
 * Create default 5-node ESP32 mesh network
 */
export function createDefaultMesh() {
  const graph = new MeshGraph();
  const centerX = 400;
  const centerY = 300;
  const radius = 200;

  const positions = [
    { x: centerX, y: centerY - radius },
    { x: centerX + radius * Math.sin(2 * Math.PI / 5), y: centerY - radius * Math.cos(2 * Math.PI / 5) },
    { x: centerX + radius * Math.sin(4 * Math.PI / 5), y: centerY - radius * Math.cos(4 * Math.PI / 5) },
    { x: centerX - radius * Math.sin(4 * Math.PI / 5), y: centerY - radius * Math.cos(4 * Math.PI / 5) },
    { x: centerX - radius * Math.sin(2 * Math.PI / 5), y: centerY - radius * Math.cos(2 * Math.PI / 5) },
  ];

  const nodeLabels = ['Node A', 'Node B', 'Node C', 'Node D', 'Node E'];
  const nodeIds = ['A', 'B', 'C', 'D', 'E'];

  for (let i = 0; i < 5; i++) {
    graph.addNode(new GraphNode(nodeIds[i], nodeLabels[i], positions[i].x, positions[i].y));
  }

  // Create mesh topology with varying weights
  graph.addEdge('A', 'B', 12);
  graph.addEdge('A', 'C', 18);
  graph.addEdge('A', 'E', 15);
  graph.addEdge('B', 'C', 10);
  graph.addEdge('B', 'D', 22);
  graph.addEdge('C', 'D', 14);
  graph.addEdge('D', 'E', 16);
  graph.addEdge('B', 'E', 20);

  return graph;
}
