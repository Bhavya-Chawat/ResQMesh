import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

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

// Convert normalized (0-1) node coords → canvas pixels
function nPos(node, w, h, pad = 50) {
  return {
    x: pad + node.nx * (w - 2 * pad),
    y: pad + node.ny * (h - 2 * pad),
  };
}

export default function AlgorithmLab() {
  const { graph, sim, dataSourceManager, tick } = useApp();
  const mapRef = useRef(null);
  const mapDivRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef(new Map());
  const polylinesRef = useRef([]);
  const weightLabelsRef = useRef([]);
  const tspPathPolylineRef = useRef(null);
  const [radarLayer, setRadarLayer] = useState(null);

  const [activeAlgo, setActiveAlgo] = useState('dijkstra');
  const [sourceNode, setSourceNode] = useState('A');
  const [steps, setSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [highlightData, setHighlightData] = useState(null);
  const intervalRef = useRef(null);
  // Global tick handles updates for both simulation and hardware modes

  const algo = ALGORITHMS[activeAlgo];

  const isNodeOnline = useCallback((n) => {
    if (dataSourceManager?.mode === 'hardware' || dataSourceManager?.mode === 'online') {
      return n.data.status !== 'failed';
    }
    return true;
  }, [dataSourceManager?.mode]);

  const nodeIds = Array.from(graph.nodes.keys()).filter(id => isNodeOnline(graph.nodes.get(id)));
  const effectiveSourceNode = graph.nodes.has(sourceNode) && isNodeOnline(graph.nodes.get(sourceNode)) 
    ? sourceNode 
    : (nodeIds[0] || 'A');

  // Run algorithm
  const runAlgorithm = useCallback(() => {
    let result;
    switch (activeAlgo) {
      case 'dijkstra': result = graph.dijkstra(effectiveSourceNode); break;
      case 'bellmanford': result = graph.bellmanFord(effectiveSourceNode); break;
      case 'bfs': result = graph.bfs(effectiveSourceNode); break;
      case 'dfs': result = graph.dfs(effectiveSourceNode); break;
      case 'prim': result = graph.primMST(); break;
      case 'tsp': result = graph.tspBranchAndBound(nodeIds.slice(0, Math.min(nodeIds.length, 6))); break;
      default: return;
    }
    setSteps(result.steps);
    setCurrentStep(0);
    setIsRunning(true);
    sim.eventLog.add('algorithm', `Running ${algo.name} from ${effectiveSourceNode}`);
  }, [activeAlgo, effectiveSourceNode, graph, nodeIds, algo.name, sim]);

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

  // Fetch RainViewer radar layer timestamp
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') return;
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(res => res.json())
      .then(data => {
        if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
          const latest = data.radar.past[data.radar.past.length - 1].time;
          setRadarLayer(`https://tilecache.rainviewer.com/v2/radar/${latest}/256/{z}/{x}/{y}/2/1_1.png`);
        }
      })
      .catch(err => console.error("Error fetching radar timestamp:", err));
  }, [dataSourceManager?.mode]);

  // Initialize Map
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }
    if (!mapDivRef.current || mapRef.current) return;

    const L = window.L;
    if (!L) return;

    const map = L.map(mapDivRef.current, {
      zoomControl: true,
      attributionControl: false
    }).setView([12.9716, 77.5946], 12); // Centered on Bangalore

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [dataSourceManager?.mode]);

  // Sync radar layer
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') return;
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L || !radarLayer) return;

    const layer = L.tileLayer(radarLayer, {
      opacity: 0.45,
      zIndex: 10,
      maxNativeZoom: 7
    }).addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [radarLayer, dataSourceManager?.mode]);

  // Sync nodes, links, and algorithm execution states on Leaflet Map
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') return;
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L) return;

    // 1. Remove old polylines and weight labels
    for (const pl of polylinesRef.current) {
      map.removeLayer(pl);
    }
    polylinesRef.current = [];

    for (const lbl of weightLabelsRef.current) {
      map.removeLayer(lbl);
    }
    weightLabelsRef.current = [];

    if (tspPathPolylineRef.current) {
      map.removeLayer(tspPathPolylineRef.current);
      tspPathPolylineRef.current = null;
    }

    const step = (() => {
      if (highlightData) return highlightData;

      // If not currently running/animating, compute the final state of the algorithm to show actual routing
      try {
        let result;
        switch (activeAlgo) {
          case 'dijkstra': result = graph.dijkstra(effectiveSourceNode); break;
          case 'bellmanford': result = graph.bellmanFord(effectiveSourceNode); break;
          case 'bfs': result = graph.bfs(effectiveSourceNode); break;
          case 'dfs': result = graph.dfs(effectiveSourceNode); break;
          case 'prim': result = graph.primMST(); break;
          case 'tsp': result = graph.tspBranchAndBound(nodeIds.slice(0, Math.min(nodeIds.length, 6))); break;
          default: return null;
        }
        if (result && result.steps && result.steps.length > 0) {
          return {
            ...result.steps[result.steps.length - 1],
            isDefaultRouting: true
          };
        }
      } catch (e) {
        console.error("Error computing default routing for map:", e);
      }
      return null;
    })();

    const visitedSet = step?.visited || step?.inMST || new Set();
    const relaxEdge = step?.relaxEdge;
    const mstEdges = step?.mstEdges || [];
    const tspPath = step?.path || step?.bestPath;

    // 2. Draw edges
    for (const edge of graph.edges) {
      const src = graph.nodes.get(edge.source);
      const tgt = graph.nodes.get(edge.target);
      if (!src || !tgt) continue;

      let isRelax = relaxEdge && (
        (relaxEdge.source === edge.source && relaxEdge.target === edge.target) ||
        (relaxEdge.source === edge.target && relaxEdge.target === edge.source)
      );
      let isMST = mstEdges.some(me =>
        (me.source === edge.source && me.target === edge.target) ||
        (me.source === edge.target && me.target === edge.source)
      );
      
      let isTreeEdge = false;
      if (step?.previous) {
        const p1 = step.previous.get(edge.source);
        const p2 = step.previous.get(edge.target);
        if (p1 === edge.target || p2 === edge.source) {
          isTreeEdge = true;
        }
      }

      let color = 'rgba(11, 18, 32, 0.2)';
      let weight = 1.5;
      let opacity = 0.45;
      let dashArray = null;

      if (isRelax) {
        color = '#FF653F';
        weight = 3.5;
        opacity = 0.95;
      } else if (isMST || isTreeEdge) {
        color = '#16a34a';
        weight = 3.5;
        opacity = 0.9;
      }

      const polyline = L.polyline([[src.lat, src.lon], [tgt.lat, tgt.lon]], {
        color,
        weight,
        opacity,
        dashArray
      }).addTo(map);
      polylinesRef.current.push(polyline);

      // Label at midpoint
      const midLat = (src.lat + tgt.lat) / 2;
      const midLon = (src.lon + tgt.lon) / 2;
      const labelColor = isRelax ? '#FF653F' : (isMST || isTreeEdge) ? '#16a34a' : 'rgba(11,18,32,0.6)';
      const labelWeight = isRelax || isMST || isTreeEdge ? 'bold' : 'normal';

      const labelMarker = L.marker([midLat, midLon], {
        icon: L.divIcon({
          html: `<div style="font-family: var(--font-mono); font-size: 0.65rem; color: ${labelColor}; text-align: center; white-space: nowrap; font-weight: ${labelWeight}">${edge.weight.toFixed(1)} km</div>`,
          className: 'edge-weight-label',
          iconSize: [40, 12],
          iconAnchor: [20, 6]
        }),
        interactive: false
      }).addTo(map);
      weightLabelsRef.current.push(labelMarker);
    }

    // 3. Draw TSP Path overlay
    if (tspPath && tspPath.length > 1) {
      const pathCoords = tspPath.map(id => {
        const node = graph.nodes.get(id);
        return [node.lat, node.lon];
      });
      if (step?.type === 'complete' || step?.type === 'newBest' || step?.isDefaultRouting) {
        const startNode = graph.nodes.get(tspPath[0]);
        pathCoords.push([startNode.lat, startNode.lon]);
      }
      const tspPolyline = L.polyline(pathCoords, {
        color: '#FF653F',
        weight: 3.5,
        dashArray: '6, 4',
        opacity: 0.9,
        zIndexOffset: 200
      }).addTo(map);
      tspPathPolylineRef.current = tspPolyline;
    }

      // 4. Render/Update nodes
      const currentIds = new Set(
        Array.from(graph.nodes.keys()).filter(id => isNodeOnline(graph.nodes.get(id)))
      );
      for (const [id, marker] of markersRef.current.entries()) {
        if (!currentIds.has(id)) {
          map.removeLayer(marker);
          markersRef.current.delete(id);
        }
      }

      for (const [id, node] of graph.nodes.entries()) {
        if (!isNodeOnline(node)) continue;
        let marker = markersRef.current.get(id);
        const isVisited = visitedSet.has(id);
        const isCurrent = step?.isDefaultRouting
          ? (['dijkstra', 'bellmanford', 'bfs', 'dfs'].includes(activeAlgo) && id === effectiveSourceNode)
          : (step?.current === id);
        const isDiscovered = step?.discovered === id;

        const size = isCurrent ? 14 : 10;
        let color = '#448AFF'; // unvisited (blue)
        if (isCurrent) color = '#FF653F'; // red-orange
        else if (isDiscovered) color = '#FFC85C'; // yellow
        else if (isVisited) color = '#16a34a'; // green

        let distText = '';
        if (step?.distances) {
          const dist = step.distances.get(id);
          distText = dist === Infinity ? '∞' : dist.toFixed(1);
        }

        const markerHtml = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
            <!-- Node Label -->
            <div style="
              font-family: var(--font-mono);
              font-size: 0.65rem;
              font-weight: bold;
              color: #ffffff;
              background: rgba(0,0,0,0.65);
              padding: 2px 6px;
              border-radius: 3px;
              margin-bottom: 2px;
              white-space: nowrap;
              border: 1px solid ${isCurrent ? '#FF653F' : 'rgba(255,255,255,0.1)'};
            ">
              ${node.label}
            </div>
            
            <!-- Distance Badge -->
            ${distText ? `
              <div style="
                font-family: var(--font-mono);
                font-size: 0.6rem;
                color: #FFC85C;
                background: rgba(0,0,0,0.8);
                padding: 1px 4px;
                border-radius: 2px;
                margin-bottom: 2px;
                white-space: nowrap;
                border: 1px solid rgba(255, 200, 92, 0.2);
              ">
                dist: ${distText} km
              </div>
            ` : ''}

            <!-- Circle & Sonar -->
            <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
              ${isCurrent ? '<div class="sonar-pulse-ring" style="border-color:#FF653F;"></div>' : ''}
              <div style="
                width: ${size}px;
                height: ${size}px;
                background-color: ${color};
                border-radius: 50%;
                border: 2px solid #ffffff;
                box-shadow: 0 0 10px ${color};
              "></div>
            </div>
          </div>
        `;

        const markerOptions = {
          icon: L.divIcon({
            html: markerHtml,
            className: 'algo-node-icon',
            iconSize: [80, 80],
            iconAnchor: [40, 50]
          }),
          zIndexOffset: isCurrent ? 1000 : isDiscovered ? 500 : 0
        };

        if (!marker) {
          marker = L.marker([node.lat, node.lon], markerOptions).addTo(map);
          marker.on('click', () => {
            setSourceNode(id);
          });
          markersRef.current.set(id, marker);
        } else {
          marker.setLatLng([node.lat, node.lon]);
          marker.setIcon(markerOptions.icon);
          marker.setZIndexOffset(isCurrent ? 1000 : isDiscovered ? 500 : 0);
          if (!map.hasLayer(marker)) {
            marker.addTo(map);
          }
        }
      }
  }, [graph, highlightData, activeAlgo, effectiveSourceNode, dataSourceManager?.mode, tick]);

  // Canvas rendering loop for Simulation Mode
  useEffect(() => {
    if (dataSourceManager?.mode !== 'simulation') return;
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
      const tspPath = step?.path || step?.bestPath;

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
  }, [graph, highlightData, dataSourceManager?.mode]);

  return (
    <div className="page-container animate-fade-in" style={{ padding: '24px 40px', width: '100%', boxSizing: 'border-box' }}>
      <div className="page-header" style={{ marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="page-title" style={{ fontSize: '2.2rem', fontWeight: '850', letterSpacing: '-0.5px', textTransform: 'none' }}>Algorithm Lab</h2>
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
            <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Source:
            </label>
            <select
              value={graph.nodes.has(sourceNode) ? sourceNode : effectiveSourceNode}
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

          <div ref={containerRef} style={{ height: '680px', position: 'relative', marginTop: 8, borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.03)' }}>
            {dataSourceManager?.mode === 'simulation' ? (
              <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', background: '#05020f' }} />
            ) : (
              <>
                <div ref={mapDivRef} style={{ width: '100%', height: '100%', minHeight: '600px', background: '#05020f' }} />

                {/* Floating Legend Overlay */}
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  background: 'rgba(6,10,21,0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  backdropFilter: 'blur(10px)',
                  zIndex: 500,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', marginBottom: '4px', fontWeight: 'bold' }}>Color Legend</div>
                  {[
                    { color: '#FF653F', label: 'Current Node / Step' },
                    { color: '#16a34a', label: 'Visited / MST edge' },
                    { color: '#FFC85C', label: 'Discovered / Relaxing edge' },
                    { color: '#448AFF', label: 'Unvisited' }
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                      <div style={{ width: '8px', height: '8px', background: item.color, borderRadius: '2px', boxShadow: `0 0 6px ${item.color}` }} />
                      <span style={{ color: '#ffffff' }}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Info Panel */}
        <div className="algo-info-panel">
          {/* Theory */}
          <div className="panel glass-panel">
            <div className="section-header">Theory — {algo.name}</div>
            <div className="algo-theory">{algo.description}</div>
            <div className="complexity-badge" style={{ marginTop: 10 }}>⏱ {algo.complexity}</div>
          </div>

          {/* Why Used */}
          <div className="panel glass-panel">
            <div className="section-header">Why This Algorithm?</div>
            <div className="algo-theory">{algo.why}</div>
          </div>

          {/* Pseudocode */}
          <div className="panel glass-panel">
            <div className="section-header">Pseudocode</div>
            <div className="pseudocode-block">{algo.pseudocode}</div>
          </div>

          {/* Live Variables */}
          {highlightData && (
            <div className="panel glass-panel animate-slide-in">
              <div className="section-header">Live State</div>
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
