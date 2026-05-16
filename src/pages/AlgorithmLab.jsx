import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

// Convert normalized (0-1) node coords → canvas pixels
function nPos(node, w, h, pad = 50) {
  return {
    x: pad + node.nx * (w - 2 * pad),
    y: pad + node.ny * (h - 2 * pad),
  };
}

const ALGORITHMS = {
  dijkstra: {
    name: 'Dijkstra',
    complexity: 'O((V+E) log V)',
    description: 'Finds the shortest path from a single source to all other nodes in a weighted graph with non-negative edge weights. Uses a priority queue (min-heap) to greedily select the nearest unvisited node.',
    why: 'Used in ResQMesh to compute optimal routing paths between ESP32 nodes, minimizing latency for real-time disaster communication.',
    pseudocode: `function Dijkstra(G, source):
  for each vertex v in G:
    dist[v] ← ∞
    prev[v] ← null
  dist[source] ← 0
  Q ← priority queue of all vertices
  
  while Q is not empty:
    u ← vertex in Q with min dist[u]
    remove u from Q
    
    for each neighbor v of u:
      alt ← dist[u] + weight(u, v)
      if alt < dist[v]:     // Relaxation
        dist[v] ← alt
        prev[v] ← u
  
  return dist[], prev[]`,
  },
  bellmanford: {
    name: 'Bellman-Ford',
    complexity: 'O(V × E)',
    description: 'Computes shortest paths from a single source, handling negative edge weights and detecting negative cycles. Iteratively relaxes all edges V-1 times until convergence.',
    why: 'Used for rerouting after node failures — when link costs change dynamically (even negatively), Bellman-Ford guarantees correctness where Dijkstra cannot.',
    pseudocode: `function BellmanFord(G, source):
  for each vertex v in G:
    dist[v] ← ∞
  dist[source] ← 0
  
  for i from 1 to |V|-1:
    for each edge (u, v, w) in G:
      if dist[u] + w < dist[v]:
        dist[v] ← dist[u] + w
        prev[v] ← u
  
  // Check for negative cycles
  for each edge (u, v, w) in G:
    if dist[u] + w < dist[v]:
      report "Negative cycle!"`,
  },
  bfs: {
    name: 'BFS',
    complexity: 'O(V + E)',
    description: 'Breadth-First Search explores the graph level by level using a queue. It finds the shortest path in unweighted graphs and checks connectivity.',
    why: 'Used for reachability analysis — after a node failure, BFS determines which nodes are still connected in the mesh network.',
    pseudocode: `function BFS(G, source):
  visited ← {source}
  queue ← [source]
  order ← []
  
  while queue is not empty:
    u ← dequeue(queue)
    order.append(u)
    
    for each neighbor v of u:
      if v not in visited:
        visited.add(v)
        enqueue(queue, v)
  
  return order`,
  },
  dfs: {
    name: 'DFS',
    complexity: 'O(V + E)',
    description: 'Depth-First Search explores as deep as possible along each branch before backtracking. Uses a stack (or recursion) and is useful for detecting cycles and finding connected components.',
    why: 'Used for failure detection and connectivity analysis — DFS can identify disconnected subgraphs after network partitions.',
    pseudocode: `function DFS(G, source):
  visited ← {}
  stack ← [source]
  order ← []
  
  while stack is not empty:
    u ← pop(stack)
    if u in visited: continue
    visited.add(u)
    order.append(u)
    
    for each neighbor v of u:
      if v not in visited:
        push(stack, v)
  
  return order`,
  },
  prim: {
    name: "Prim's MST",
    complexity: 'O(E log V)',
    description: "Prim's algorithm builds a Minimum Spanning Tree by greedily adding the cheapest edge connecting the tree to a non-tree vertex. Ensures all nodes are connected with minimum total edge weight.",
    why: 'Used to create the backbone mesh network topology — MST minimizes total transmission overhead while maintaining full connectivity.',
    pseudocode: `function Prim(G):
  inMST ← {start_vertex}
  mstEdges ← []
  
  while |inMST| < |V|:
    (u, v, w) ← cheapest edge from
      inMST to non-MST vertex
    inMST.add(v)
    mstEdges.append((u, v, w))
  
  return mstEdges`,
  },
  tsp: {
    name: 'TSP (Branch & Bound)',
    complexity: 'O(N!)',
    description: 'The Traveling Salesman Problem finds the shortest route visiting all specified nodes exactly once and returning to the start. Branch & Bound prunes search space by eliminating paths that exceed the current best.',
    why: 'Used for rescue route optimization — finding the optimal path for rescue teams to visit all alert locations with minimum travel time.',
    pseudocode: `function TSP_BranchBound(nodes):
  bestCost ← ∞
  bestPath ← null
  
  function solve(current, visited, cost):
    if all nodes visited:
      total ← cost + dist(current, start)
      if total < bestCost:
        bestCost ← total
        bestPath ← current path
      return
    
    for each unvisited node next:
      newCost ← cost + dist(current, next)
      if newCost < bestCost:  // Bound
        solve(next, visited∪{next}, newCost)
      else:
        prune this branch
  
  return bestPath, bestCost`,
  },
};

export default function AlgorithmLab() {
  const { graph, sim } = useApp();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [activeAlgo, setActiveAlgo] = useState('dijkstra');
  const [sourceNode, setSourceNode] = useState('A');
  const [steps, setSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [highlightData, setHighlightData] = useState(null);
  const intervalRef = useRef(null);

  const algo = ALGORITHMS[activeAlgo];
  const nodeIds = Array.from(graph.nodes.keys());

  // Run algorithm
  const runAlgorithm = useCallback(() => {
    let result;
    switch (activeAlgo) {
      case 'dijkstra': result = graph.dijkstra(sourceNode); break;
      case 'bellmanford': result = graph.bellmanFord(sourceNode); break;
      case 'bfs': result = graph.bfs(sourceNode); break;
      case 'dfs': result = graph.dfs(sourceNode); break;
      case 'prim': result = graph.primMST(); break;
      case 'tsp': result = graph.tspBranchAndBound(nodeIds.slice(0, Math.min(nodeIds.length, 6))); break;
      default: return;
    }
    setSteps(result.steps);
    setCurrentStep(0);
    setIsRunning(true);
    sim.eventLog.add('algorithm', `🔬 Running ${algo.name} from ${sourceNode}`);
  }, [activeAlgo, sourceNode, graph, nodeIds, algo.name, sim]);

  // Step through
  useEffect(() => {
    if (!isRunning || steps.length === 0) return;
    intervalRef.current = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= steps.length - 1) {
          setIsRunning(false);
          clearInterval(intervalRef.current);
          return prev;
        }
        return prev + 1;
      });
    }, 800);
    return () => clearInterval(intervalRef.current);
  }, [isRunning, steps.length]);

  // Update highlight data when step changes
  useEffect(() => {
    if (currentStep >= 0 && currentStep < steps.length) {
      setHighlightData(steps[currentStep]);
    }
  }, [currentStep, steps]);

  const stopAlgo = () => {
    setIsRunning(false);
    clearInterval(intervalRef.current);
  };

  const resetAlgo = () => {
    stopAlgo();
    setSteps([]);
    setCurrentStep(-1);
    setHighlightData(null);
  };

  const stepForward = () => {
    if (currentStep < steps.length - 1) setCurrentStep(s => s + 1);
  };
  const stepBack = () => {
    if (currentStep > 0) setCurrentStep(s => s - 1);
  };

  // Canvas rendering for algorithm visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let animId;

    function resize() {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let time = 0;
    function draw() {
      time += 0.016;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = 'rgba(255,101,63,0.03)';
      for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      const step = highlightData;
      const visitedSet = step?.visited || step?.inMST || new Set();
      const relaxEdge = step?.relaxEdge;
      const mstEdges = step?.mstEdges || [];
      const tspPath = step?.path;

      const PAD = 50;

      // Draw edges
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        const sp = nPos(src, w, h, PAD);
        const tp = nPos(tgt, w, h, PAD);

        let isRelax = relaxEdge && (
          (relaxEdge.source === edge.source && relaxEdge.target === edge.target) ||
          (relaxEdge.source === edge.target && relaxEdge.target === edge.source)
        );
        let isMST = mstEdges.some(me =>
          (me.source === edge.source && me.target === edge.target) ||
          (me.source === edge.target && me.target === edge.source)
        );

        if (isRelax) {
          ctx.strokeStyle = '#FF653F'; ctx.lineWidth = 3;
          ctx.shadowColor = '#FF653F'; ctx.shadowBlur = 12;
        } else if (isMST) {
          ctx.strokeStyle = '#39FF14'; ctx.lineWidth = 3;
          ctx.shadowColor = '#39FF14'; ctx.shadowBlur = 8;
        } else {
          ctx.strokeStyle = 'rgba(255,200,92,0.18)'; ctx.lineWidth = 1.5; ctx.shadowBlur = 0;
        }

        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Weight label
        ctx.font = '11px "Share Tech Mono"';
        ctx.fillStyle = isRelax ? '#FF653F' : isMST ? '#39FF14' : 'rgba(255,200,92,0.45)';
        ctx.textAlign = 'center';
        ctx.fillText(edge.weight.toString(), (sp.x + tp.x) / 2, (sp.y + tp.y) / 2 - 6);
      }

      // TSP path overlay
      if (tspPath && tspPath.length > 1) {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#FF653F'; ctx.lineWidth = 3;
        ctx.shadowColor = '#FF653F'; ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let i = 0; i < tspPath.length; i++) {
          const n = graph.nodes.get(tspPath[i]);
          if (!n) continue;
          const p = nPos(n, w, h, PAD);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 0;
      }

      // Draw nodes
      for (const [id, node] of graph.nodes) {
        const isVisited = visitedSet.has(id);
        const isCurrent = step?.current === id;
        const isDiscovered = step?.discovered === id;
        const { x, y } = nPos(node, w, h, PAD);
        // Sync legacy coords for other consumers
        node.x = x; node.y = y;

        const r = isCurrent ? 14 : 10;
        let color;
        if (isCurrent) color = '#FF653F';
        else if (isDiscovered) color = '#FFC85C';
        else if (isVisited) color = '#39FF14';
        else color = '#448AFF';

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
        grad.addColorStop(0, color + '40');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = isCurrent ? 16 : 8;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.font = 'bold 10px "Orbitron", monospace';
        ctx.fillStyle = '#f0eaf8';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, x, y - r - 8);

        if (step?.distances) {
          const dist = step.distances.get(id);
          ctx.font = '10px "Share Tech Mono"';
          ctx.fillStyle = '#FFC85C';
          ctx.fillText(dist === Infinity ? '∞' : dist.toFixed(1), x, y + r + 14);
        }
      }

      // Legend
      ctx.font = '10px "Share Tech Mono"';
      const legends = [
        { color: '#FF653F', label: 'Current' },
        { color: '#39FF14', label: 'Visited' },
        { color: '#FFC85C', label: 'Discovered' },
        { color: '#448AFF', label: 'Unvisited' },
      ];
      legends.forEach((l, i) => {
        ctx.fillStyle = l.color;
        ctx.fillRect(10, 10 + i * 18, 8, 8);
        ctx.fillStyle = '#a89cc8';
        ctx.textAlign = 'left';
        ctx.fillText(l.label, 24, 18 + i * 18);
      });

      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, [graph, highlightData]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title glow-text-yellow">◇ Algorithm & Network Intelligence Center</h1>
      </div>

      {/* Algorithm Tabs */}
      <div className="algo-tabs">
        {Object.entries(ALGORITHMS).map(([key, a]) => (
          <button
            key={key}
            className={`algo-tab ${activeAlgo === key ? 'active' : ''}`}
            onClick={() => { setActiveAlgo(key); resetAlgo(); }}
          >
            {a.name}
          </button>
        ))}
      </div>

      <div className="algo-layout">
        {/* Graph Visualization */}
        <div className="panel glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Source:
            </label>
            <select
              value={sourceNode}
              onChange={e => setSourceNode(e.target.value)}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.75rem', background: 'rgba(10,6,24,0.6)',
                color: 'var(--neon-cyan)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '4px 8px',
              }}
            >
              {nodeIds.map(id => (
                <option key={id} value={id}>{graph.nodes.get(id)?.label}</option>
              ))}
            </select>
            <button className="btn btn-sm btn-primary" onClick={runAlgorithm} disabled={isRunning}>
              ▶ Run {algo.name}
            </button>
            <button className="btn btn-sm" onClick={stepBack} disabled={currentStep <= 0}>◀</button>
            <button className="btn btn-sm" onClick={stepForward} disabled={currentStep >= steps.length - 1}>▶</button>
            {isRunning && <button className="btn btn-sm btn-danger" onClick={stopAlgo}>⏸</button>}
            <button className="btn btn-sm" onClick={resetAlgo}>↻ Reset</button>
            {steps.length > 0 && (
              <span className="badge badge-orange">Step {currentStep + 1}/{steps.length}</span>
            )}
          </div>

          {/* Step description */}
          {highlightData && (
            <div className="step-display animate-slide-in">
              {highlightData.description}
            </div>
          )}

          <div ref={containerRef} style={{ flex: 1, minHeight: 300, position: 'relative', marginTop: 8 }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Info Panel */}
        <div className="algo-info-panel">
          {/* Theory */}
          <div className="panel glass-panel">
            <div className="section-header"><span className="icon">📖</span> Theory — {algo.name}</div>
            <div className="algo-theory">{algo.description}</div>
            <div className="complexity-badge" style={{ marginTop: 10 }}>⏱ {algo.complexity}</div>
          </div>

          {/* Why Used */}
          <div className="panel glass-panel">
            <div className="section-header"><span className="icon">❓</span> Why This Algorithm?</div>
            <div className="algo-theory">{algo.why}</div>
          </div>

          {/* Pseudocode */}
          <div className="panel glass-panel">
            <div className="section-header"><span className="icon">💻</span> Pseudocode</div>
            <div className="pseudocode-block">{algo.pseudocode}</div>
          </div>

          {/* Live Variables */}
          {highlightData && (
            <div className="panel glass-panel animate-slide-in">
              <div className="section-header"><span className="icon">📊</span> Live State</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {highlightData.distances && (
                  <div>
                    <strong style={{ color: 'var(--warm-yellow)' }}>Distances:</strong><br />
                    {Array.from(highlightData.distances.entries()).map(([id, d]) => (
                      <span key={id} style={{ marginRight: 10 }}>
                        {graph.nodes.get(id)?.label}: <span style={{ color: d === Infinity ? 'var(--neon-red)' : 'var(--neon-cyan)' }}>
                          {d === Infinity ? '∞' : d.toFixed(1)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {highlightData.visited && (
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ color: 'var(--neon-green)' }}>Visited:</strong>{' '}
                    {Array.from(highlightData.visited).map(id => graph.nodes.get(id)?.label).join(', ') || 'None'}
                  </div>
                )}
                {highlightData.queue && (
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ color: 'var(--neon-orange)' }}>Queue:</strong>{' '}
                    [{highlightData.queue.map(q => typeof q === 'object' ? graph.nodes.get(q.id)?.label : graph.nodes.get(q)?.label).join(', ')}]
                  </div>
                )}
                {highlightData.stack && (
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ color: 'var(--neon-orange)' }}>Stack:</strong>{' '}
                    [{highlightData.stack.map(s => graph.nodes.get(s)?.label).join(', ')}]
                  </div>
                )}
                {highlightData.mstEdges && (
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ color: 'var(--neon-green)' }}>MST Edges:</strong>{' '}
                    {highlightData.mstEdges.map(e => `${graph.nodes.get(e.source)?.label}-${graph.nodes.get(e.target)?.label}`).join(', ') || 'None'}
                    {highlightData.totalWeight !== undefined && (
                      <span style={{ color: 'var(--warm-yellow)', marginLeft: 8 }}>
                        Total: {highlightData.totalWeight.toFixed(1)}
                      </span>
                    )}
                  </div>
                )}
                {highlightData.statesExplored !== undefined && (
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ color: 'var(--neon-cyan)' }}>States Explored:</strong> {highlightData.statesExplored}
                    {' | '}
                    <strong style={{ color: 'var(--neon-red)' }}>Pruned:</strong> {highlightData.statesPruned}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
