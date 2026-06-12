import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../App';
import { GraphNode, pixelToNorm } from '../engine/graph';

// Convert normalized (0-1) node coords → canvas pixels
function nodePos(node, w, h, pad = 55) {
  return {
    x: pad + node.nx * (w - 2 * pad),
    y: pad + node.ny * (h - 2 * pad),
  };
}

export default function CommandCenter() {
  const { graph, sim, dataSourceManager, theme, tick, packetFlowActive, setPacketFlowActive } = useApp();
  const mapRef = useRef(null);
  const mapDivRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef(new Map());
  const polylinesRef = useRef([]);
  const packetMarkersRef = useRef(new Map());
  const [radarLayer, setRadarLayer] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const selectedNodeRef = useRef(selectedNode);
  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);
  const dragRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);

  const [preset, setPreset] = useState('ring');
  const [nodeCount, setNodeCount] = useState(5);
  const [expectedHwNodes, setExpectedHwNodes] = useState(dataSourceManager?.expectedNodes || 5);
  
  // Custom states for architectural redesign
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [tableData, setTableData] = useState([]);
  const [simSpeed, setSimSpeed] = useState(1);

  // Fetch RainViewer radar layer timestamp
  useEffect(() => {
    if (dataSourceManager.mode === 'simulation') return;
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(res => res.json())
      .then(data => {
        if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
          const latest = data.radar.past[data.radar.past.length - 1].time;
          setRadarLayer(`https://tilecache.rainviewer.com/v2/radar/${latest}/256/{z}/{x}/{y}/2/1_1.png`);
        }
      })
      .catch(err => console.error("Error fetching radar timestamp:", err));
  }, [dataSourceManager.mode]);

  // Initialize Map
  useEffect(() => {
    if (dataSourceManager.mode === 'simulation') {
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

    // CartoDB Positron tileset
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
  }, [dataSourceManager.mode]);

  // Sync radar layer
  useEffect(() => {
    if (dataSourceManager.mode === 'simulation') return;
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
  }, [radarLayer, dataSourceManager.mode]);

  // Sync graph state on Leaflet Map
  useEffect(() => {
    if (dataSourceManager.mode === 'simulation') return;
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L) return;

    const isNodeOnline = (n) => {
      if (dataSourceManager.mode === 'hardware' || dataSourceManager.mode === 'online') {
        return n.data.status !== 'failed';
      }
      return true;
    };

    // 1. Remove old polylines
    for (const pl of polylinesRef.current) {
      map.removeLayer(pl);
    }
    polylinesRef.current = [];

    // 2. Render Edges (Polylines)
    for (const edge of graph.edges) {
      const src = graph.nodes.get(edge.source);
      const tgt = graph.nodes.get(edge.target);
      if (!src || !tgt) continue;
      if (!isNodeOnline(src) || !isNodeOnline(tgt)) continue;

      const failed = src.data.status === 'failed' || tgt.data.status === 'failed';
      const color = failed ? '#ff1744' : '#16a34a';
      const options = {
        color: color,
        weight: 1.5,
        dashArray: '5, 5',
        opacity: failed ? 0.35 : 0.75
      };

      const polyline = L.polyline([[src.lat, src.lon], [tgt.lat, tgt.lon]], options).addTo(map);
      polylinesRef.current.push(polyline);
    }

    // 3. Render/Update Nodes (Markers)
    const currentIds = new Set(
      Array.from(graph.nodes.keys()).filter(id => isNodeOnline(graph.nodes.get(id)))
    );
    
    // Remove markers for deleted or offline nodes
    for (const [id, marker] of markersRef.current.entries()) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
      }
    }

    // Render/Update nodes A-E
    for (const [id, node] of graph.nodes.entries()) {
      if (!isNodeOnline(node)) continue;
      let marker = markersRef.current.get(id);
      const isFailed = node.data.status === 'failed';
      const isSelected = id === selectedNode;
      const size = isSelected ? 14 : 10;
      const color = '#FF653F'; // bright orange circles
      
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
            border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255,255,255,0.1)'};
          ">
            ${node.label}
          </div>

          <!-- Circle & Sonar -->
          <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
            ${isSelected ? '<div class="sonar-pulse-ring" style="border-color:#ffffff;"></div>' : ''}
            ${isFailed ? '<div class="sonar-pulse-ring" style="border-color:#ff1744; animation-duration: 1.5s;"></div>' : ''}
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
          className: 'command-node-icon',
          iconSize: [80, 80],
          iconAnchor: [40, 50]
        }),
        zIndexOffset: isSelected ? 1000 : 0
      };

      if (!marker) {
        marker = L.marker([node.lat, node.lon], markerOptions).addTo(map);
        marker.on('click', () => {
          setSelectedNode(id);
        });
        markersRef.current.set(id, marker);
      } else {
        marker.setLatLng([node.lat, node.lon]);
        marker.setIcon(markerOptions.icon);
        marker.setZIndexOffset(isSelected ? 1000 : 0);
        if (!map.hasLayer(marker)) {
          marker.addTo(map);
        }
      }

      let weatherInfo = '';
      if (id === 'A') {
        weatherInfo = `Wind: <b>${node.data.gasLevel !== null && node.data.gasLevel !== undefined ? node.data.gasLevel.toFixed(1) : 'N/A'} km/h</b>`;
      } else if (id === 'B') {
        weatherInfo = `Rain: <b>${node.data.gasLevel !== null && node.data.gasLevel !== undefined ? node.data.gasLevel.toFixed(1) : 'N/A'} mm</b>`;
      } else if (id === 'E') {
        weatherInfo = `CO: <b>${node.data.gasLevel !== null && node.data.gasLevel !== undefined ? node.data.gasLevel.toFixed(0) : 'N/A'} ppm</b>`;
      } else {
        weatherInfo = `Env: <b>Safe</b>`;
      }

      const tooltipContent = `
        <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #ffffff; padding: 4px;">
          <strong style="color: var(--nash-chartreuse);">${node.label}</strong> [Node ${id}]<br/>
          Temp: <b>${node.data.temperature !== null && node.data.temperature !== undefined ? `${node.data.temperature.toFixed(1)}°C` : 'N/A'}</b><br/>
          Hum: <b>${node.data.humidity !== null && node.data.humidity !== undefined ? `${node.data.humidity.toFixed(1)}%` : 'N/A'}</b><br/>
          ${weatherInfo}<br/>
          Status: <b style="color: ${color};">${node.data.status.toUpperCase()}</b>
        </div>
      `;
      marker.bindTooltip(tooltipContent, {
        direction: 'top',
        className: 'leaflet-dark-tooltip',
        opacity: 0.9,
        permanent: false
      });
    }
  }, [graph, selectedNode, dataSourceManager.mode, tick]);

  // Packet flow animation loop on Leaflet Map — only runs when packetFlowActive
  useEffect(() => {
    if (dataSourceManager.mode === 'simulation') return;
    if (!packetFlowActive) {
      // Clean up any existing packet markers when flow is stopped
      for (const m of packetMarkersRef.current.values()) {
        const map = mapRef.current;
        if (map) map.removeLayer(m);
      }
      packetMarkersRef.current.clear();
      return;
    }
    let animId;
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L) return;

    const cleanUpPacketMarkers = () => {
      for (const m of packetMarkersRef.current.values()) {
        map.removeLayer(m);
      }
      packetMarkersRef.current.clear();
    };

    let time = 0;
    const drawPackets = () => {
      time += 0.016;
      const flowSpeed = 0.55;

      const activePacketIds = new Set();
      const isNodeOnline = (n) => {
        if (dataSourceManager.mode === 'hardware' || dataSourceManager.mode === 'online') {
          return n.data.status !== 'failed';
        }
        return true;
      };

      let pIdx = 0;
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        if (!isNodeOnline(src) || !isNodeOnline(tgt)) continue;

        // Animate a packet moving from src to tgt
        const progress = (time * flowSpeed + pIdx * 0.35) % 1;
        const pLat = src.lat + (tgt.lat - src.lat) * progress;
        const pLon = src.lon + (tgt.lon - src.lon) * progress;

        const pktId = `flow-${edge.source}-${edge.target}`;
        activePacketIds.add(pktId);

        let marker = packetMarkersRef.current.get(pktId);
        if (!marker) {
          marker = L.circleMarker([pLat, pLon], {
            radius: 4.5,
            fillColor: '#00E5FF', // bright cyan packet
            fillOpacity: 0.95,
            color: '#ffffff',
            weight: 1.5,
            className: 'pulse-packet-marker'
          }).addTo(map);
          packetMarkersRef.current.set(pktId, marker);
        } else {
          marker.setLatLng([pLat, pLon]);
        }
        pIdx++;
      }

      // Remove any markers that are no longer active
      for (const [id, marker] of packetMarkersRef.current.entries()) {
        if (!activePacketIds.has(id)) {
          map.removeLayer(marker);
          packetMarkersRef.current.delete(id);
        }
      }

      animId = requestAnimationFrame(drawPackets);
    };

    drawPackets();

    return () => {
      cancelAnimationFrame(animId);
      cleanUpPacketMarkers();
    };
  }, [graph, dataSourceManager.mode, tick]);

  // Canvas Loop for Simulation Mode
  useEffect(() => {
    if (dataSourceManager.mode !== 'simulation') return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    function resize() {
      const r = container.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
      graph.setCanvasSize(r.width, r.height);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    function draw() {
      timeRef.current += 0.016;
      const t = timeRef.current;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = 'rgba(255,101,63,0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      const PAD = 55;

      // Edges
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        const sp = nodePos(src, w, h, PAD);
        const tp = nodePos(tgt, w, h, PAD);
        const failed = src.data.status === 'failed' || tgt.data.status === 'failed';

        ctx.strokeStyle = failed ? 'rgba(255,23,68,0.2)' : 'rgba(255,200,92,0.25)';
        ctx.lineWidth = failed ? 1 : 1.5;
        ctx.setLineDash(failed ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();

        // Weight label
        if (!failed) {
          ctx.font = '10px "Share Tech Mono"';
          ctx.fillStyle = 'rgba(255,200,92,0.55)';
          ctx.textAlign = 'center';
          ctx.fillText(edge.weight.toString(), (sp.x + tp.x) / 2, (sp.y + tp.y) / 2 - 5);
        }

        // Animated flow dots on active edges
        if (!failed) {
          const flowOff = (t * 40) % 20;
          ctx.setLineDash([3, 17]);
          ctx.lineDashOffset = -flowOff;
          ctx.strokeStyle = 'rgba(0,229,255,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          ctx.lineTo(tp.x, tp.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      // Active Packets — only draw when flow is active (sim.isRunning)
      if (sim.isRunning) {
        for (const pkt of sim.activePackets) {
          if (!pkt.path || pkt.path.length < 2) continue;
          const progress = (t * 0.45) % 1;
          const totalSegs = pkt.path.length - 1;
          const segFloat = progress * totalSegs;
          const seg = Math.min(Math.floor(segFloat), totalSegs - 1);
          const segT = segFloat - seg;
          const sn = graph.nodes.get(pkt.path[seg]);
          const en = graph.nodes.get(pkt.path[seg + 1]);
          if (!sn || !en) continue;
          const sp = nodePos(sn, w, h, PAD);
          const ep = nodePos(en, w, h, PAD);
          const px = sp.x + (ep.x - sp.x) * segT;
          const py = sp.y + (ep.y - sp.y) * segT;

          const color = pkt.getPriorityColor();
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Nodes
      for (const [id, node] of graph.nodes) {
        const isSel = selectedNode === id;
        const status = node.data.status;
        const { x, y } = nodePos(node, w, h, PAD);

        node.x = x;
        node.y = y;

        // Pulse glow
        let glowColor;
        if (status === 'failed') glowColor = 'rgba(255,23,68,0.35)';
        else if (status === 'critical') glowColor = 'rgba(255,101,63,0.45)';
        else if (status === 'warning') glowColor = 'rgba(255,200,92,0.35)';
        else glowColor = 'rgba(0,229,255,0.22)';

        const pulseR = (isSel ? 28 : 22) + Math.sin(t * 2.2 + node.nx * 6.28) * 5;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, pulseR);
        grad.addColorStop(0, glowColor);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, pulseR, 0, Math.PI * 2);
        ctx.fill();

        // Node body
        const r = isSel ? 14 : 10;
        let fillColor;
        if (status === 'failed') fillColor = '#FF1744';
        else if (status === 'critical') fillColor = '#FF653F';
        else if (status === 'warning') fillColor = '#FFC85C';
        else fillColor = '#00E5FF';

        ctx.fillStyle = fillColor;
        ctx.shadowColor = fillColor;
        ctx.shadowBlur = isSel ? 20 : 10;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Selection ring
        if (isSel) {
          ctx.strokeStyle = '#FFC85C';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, r + 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        // ESP32 label
        ctx.font = 'bold 10px "Orbitron", monospace';
        ctx.fillStyle = '#f0eaf8';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, x, y - r - 8);

        // Alert blink
        if (status === 'critical' || status === 'warning') {
            ctx.fillText(status === 'critical' ? 'ALERT' : '!', x + r + 5, y - 4);
        }

        // Battery micro-bar
        const bw = 28, bh = 4;
        const bx = x - bw / 2, by = y + r + 3;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(bx, by, bw, bh);
        const pct = node.data.battery / 100;
        ctx.fillStyle = pct < 0.15 ? '#FF1744' : pct < 0.3 ? '#FFC85C' : '#39FF14';
        ctx.fillRect(bx, by, bw * pct, bh);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [graph, sim, selectedNode, dataSourceManager.mode, tick, packetFlowActive]);

  const handleToggleSim = () => {
    if (sim.isRunning) {
      sim.stop();
      setPacketFlowActive(false);
    } else {
      sim.start();
      setPacketFlowActive(true);
    }
    setTick(t => t + 1);
  };

  const handleReset = () => {
    sim.stop();
    graph.resetToPreset(preset, nodeCount);
    sim.packets = [];
    sim.activePackets = [];
    sim.stats = {
      totalPacketsSent: 0,
      totalPacketsDelivered: 0,
      totalPacketsDropped: 0,
      avgLatency: 0,
      throughput: 0
    };
    sim.eventLog.clear();
    sim.eventLog.add('info', 'Simulation reset');
    setSelectedNode(null);
    if (!dataSourceManager.isHardware) {
      sim.start();
    }
    setTick(t => t + 1);
  };

  const handleResetMesh = () => {
    graph.resetToPreset(preset, nodeCount);
    setSelectedNode(null);
    sim.eventLog.add('info', `Reset topology to ${preset.toUpperCase()} with ${nodeCount} nodes`);
    setTick(t => t + 1);
  };

  useEffect(() => {
    // Do NOT auto-start sim — user must press Start
    // This ensures packet flow only starts on explicit user action
  }, [sim]);

  // Global tick handles updates for both simulation and hardware modes

  useEffect(() => {
    const subs = Array.from(graph.nodes.entries())
      .filter(([id]) => id !== 'A')
      .map(([id, node]) => ({
        id,
        label: dataSourceManager?.isHardware ? `Sub-Server ${id}` : node.label,
        temperature: node.data.temperature,
        humidity: node.data.humidity,
        gasLevel: node.data.gasLevel,
        status: node.data.status,
      }));
    setTableData(subs);
  }, [graph, dataSourceManager, tick]);

  const handleMouseDown = useCallback((e) => {
    if (dataSourceManager.mode !== 'simulation') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = canvas.width, h = canvas.height, PAD = 55;

    for (const [id, node] of graph.nodes) {
      const { x, y } = nodePos(node, w, h, PAD);
      const dx = mx - x, dy = my - y;
      if (dx * dx + dy * dy < 256) {
        setSelectedNode(id);
        dragRef.current = { id, offsetX: dx, offsetY: dy };
        return;
      }
    }
    setSelectedNode(null);
  }, [graph, dataSourceManager.mode]);

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = canvas.width, h = canvas.height;
    const node = graph.nodes.get(dragRef.current.id);
    if (node) {
      const { nx, ny } = pixelToNorm(
        mx - dragRef.current.offsetX,
        my - dragRef.current.offsetY,
        w, h, 55
      );
      node.nx = Math.max(0, Math.min(1, nx));
      node.ny = Math.max(0, Math.min(1, ny));
    }
  }, [graph]);

  const handleMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // ── Add node ─────────────────────────────────────────────────────
  const addNode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const usedIds = new Set(graph.nodes.keys());
    let newId = '';
    for (const ch of letters) {
      if (!usedIds.has(ch)) { newId = ch; break; }
    }
    if (!newId) newId = `N${graph.nodes.size}`;
    const label = `Node ${newId}`;
    const nx = 0.15 + Math.random() * 0.7;
    const ny = 0.15 + Math.random() * 0.7;
    const node = new GraphNode(newId, label, nx, ny);
    graph.addNode(node);
    // Connect to 1-2 random existing active nodes
    const existing = Array.from(graph.nodes.keys()).filter(k => k !== newId && graph.nodes.get(k)?.data.status !== 'failed');
    if (existing.length > 0) {
      const n1 = existing[Math.floor(Math.random() * existing.length)];
      graph.addEdge(newId, n1, Math.floor(8 + Math.random() * 22));
      if (existing.length > 1) {
        let n2 = n1;
        while (n2 === n1) n2 = existing[Math.floor(Math.random() * existing.length)];
        graph.addEdge(newId, n2, Math.floor(8 + Math.random() * 22));
      }
    }
    sim.eventLog.add('success', `${label} added to mesh`);
    setTick(t => t + 1);
  };

  const sel = selectedNode ? graph.nodes.get(selectedNode) : null;
  const health = sim.getNetworkHealth();
  const events = sim.eventLog.getRecent(30);

  return (
    <div className="page-container animate-fade-in" style={{ padding: '24px 40px', width: '100%', boxSizing: 'border-box' }}>
      <div className="page-header" style={{ marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="page-title" style={{ fontSize: '1.4rem', fontWeight: '800', letterSpacing: '-0.5px', textTransform: 'none' }}>Command Center</h2>
        <div className="page-controls" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {dataSourceManager?.isSimulation ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={preset}
                onChange={e => setPreset(e.target.value)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: 'rgba(10,6,24,0.6)',
                  color: 'var(--warm-yellow)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                }}
              >
                <option value="ring">Ring Network</option>
                <option value="grid">Grid Mesh</option>
                <option value="star">Star Hub</option>
                <option value="random">Random Mesh</option>
              </select>
              <select
                value={nodeCount}
                onChange={e => setNodeCount(Number(e.target.value))}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: 'rgba(10,6,24,0.6)',
                  color: 'var(--warm-yellow)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                }}
              >
                {[3, 5, 8, 10, 12, 15].map(n => (
                  <option key={n} value={n}>{n} Nodes</option>
                ))}
              </select>
              <button className="btn btn-sm btn-yellow" onClick={handleResetMesh}>Rebuild</button>
            </div>
          ) : (
            <div style={{ marginRight: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
               Auto-Detected: <strong style={{ color: 'var(--nash-chartreuse)' }}>{health.activeNodes}</strong>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>SPEED</span>
            <input
              type="range"
              min="0.2"
              max="3"
              step="0.2"
              value={simSpeed}
              onChange={(e) => {
                const spd = Number(e.target.value);
                setSimSpeed(spd);
                sim.setSpeed(spd);
              }}
              style={{ width: 60, cursor: 'pointer', accentColor: 'var(--nash-chartreuse)' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', minWidth: 28 }}>{simSpeed.toFixed(1)}x</span>
          </div>

          <button
            className="btn btn-primary"
            onClick={() => {
              if (dataSourceManager.mode !== 'simulation') {
                // In online/hardware mode: just toggle packet flow
                setPacketFlowActive(v => !v);
              } else {
                handleToggleSim();
              }
            }}
            style={{ padding: '6px 16px', fontWeight: '600' }}
          >
            {packetFlowActive || sim.isRunning ? '⏸ Pause Flow' : '▶ Start Flow'}
          </button>
          <button className="btn" onClick={handleReset} style={{ padding: '6px 16px', borderColor: 'rgba(255,255,255,0.1)' }}>
            Reset
          </button>
        </div>
      </div>

      {/* Main Grid: Left side (Topology + Table), Right side (Inspector + Logs) */}
      <div className="command-grid">
        
        {/* Topology Canvas Card */}
        <div className="panel glass-panel topo-container topo-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: '680px', position: 'relative', padding: '16px', marginBottom: 0 }}>
          <div className="topo-controls" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#ffffff', fontFamily: 'var(--font-display)', letterSpacing: '0.5px' }}>
              Live Topology Map — Autonomic Mesh
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {(dataSourceManager.mode === 'simulation' ? sim.isRunning : packetFlowActive) ? '● LIVE MONITORING' : '○ PAUSED'} · Click node to inspect
            </span>
          </div>
          
          <div className="topo-canvas-wrap" ref={containerRef} style={{ flex: 1, position: 'relative', borderRadius: '8px', overflow: 'hidden' }}>
            {dataSourceManager.mode === 'simulation' ? (
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ display: 'block', width: '100%', height: '100%', background: '#05020f', cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
              />
            ) : (
              <div
                ref={mapDivRef}
                style={{ width: '100%', height: '100%', background: '#05020f' }}
              />
            )}

            {/* Floating Metrics Overlay (Nash.ai Style, Screenshot 3) */}
            <div style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              right: '12px',
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '8px',
              zIndex: 5
            }}>
              <div style={{ background: 'rgba(6,10,21,0.85)', border: '1px solid rgba(201, 255, 0, 0.25)', borderRadius: '8px', padding: '8px 12px', backdropFilter: 'blur(10px)' }}>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', marginBottom: '2px' }}>Nodes Active</div>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: '#ffffff' }}>{health.activeNodes}</div>
              </div>
              <div style={{ background: 'rgba(6,10,21,0.85)', border: '1px solid rgba(201, 255, 0, 0.25)', borderRadius: '8px', padding: '8px 12px', backdropFilter: 'blur(10px)' }}>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', marginBottom: '2px' }}>Delivery Rate</div>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--nash-chartreuse)' }}>{health.deliveryRate}%</div>
              </div>
              <div style={{ background: 'rgba(6,10,21,0.85)', border: '1px solid rgba(201, 255, 0, 0.25)', borderRadius: '8px', padding: '8px 12px', backdropFilter: 'blur(10px)' }}>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', marginBottom: '2px' }}>Avg Latency</div>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: '#ffffff' }}>{health.avgLatency.toFixed(1)}ms</div>
              </div>
              <div style={{ background: 'rgba(6,10,21,0.85)', border: '1px solid rgba(201, 255, 0, 0.25)', borderRadius: '8px', padding: '8px 12px', backdropFilter: 'blur(10px)' }}>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', marginBottom: '2px' }}>Grid Density</div>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: '#ffffff' }}>{(health.density * 100).toFixed(0)}%</div>
              </div>
              <div style={{ background: 'rgba(6,10,21,0.85)', border: '1px solid rgba(201, 255, 0, 0.25)', borderRadius: '8px', padding: '8px 12px', backdropFilter: 'blur(10px)' }}>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', marginBottom: '2px' }}>Avg Battery</div>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: health.avgBattery < 30 ? 'var(--neon-red)' : 'var(--nash-chartreuse)' }}>{health.avgBattery.toFixed(0)}%</div>
              </div>
            </div>
            
            {isAdjusting && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(1,5,30,0.85)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                zIndex: 10,
                backdropFilter: 'blur(4px)',
                fontFamily: 'var(--font-display)',
                color: 'var(--nash-chartreuse)'
              }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: 2, marginBottom: 8, color: 'var(--nash-chartreuse)' }}>
                  Adjusting network layout...
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Freezing updates for 2 seconds
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sub-Servers Distributed Monitor Card */}
        <div className="panel glass-panel table-panel" style={{ height: '220px', minHeight: '220px', padding: '16px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
          <div className="section-header" style={{ marginBottom: 8 }}>Distributed Sub-Servers Monitor</div>
          <div className="panel-scroll" style={{ flex: 1 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sub-Server ID</th>
                  <th>Temperature</th>
                  <th>Humidity</th>
                  <th>Gas Level</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tableData.length > 0 ? (
                  tableData.map(node => (
                    <tr key={node.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ color: 'var(--neon-cyan)', fontWeight: 'bold' }}>Sub-Server {node.id}</td>
                      <td style={{ color: node.temperature !== null && node.temperature > 60 ? '#FF1744' : '#FFC85C' }}>
                        {node.temperature !== undefined && node.temperature !== null ? `${node.temperature.toFixed(1)}°C` : 'N/A'}
                      </td>
                      <td>
                        {node.humidity !== undefined && node.humidity !== null ? `${node.humidity.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td style={{ color: node.gasLevel !== null && node.gasLevel > 210 ? '#FF1744' : '#FFC85C' }}>
                        {node.gasLevel !== undefined && node.gasLevel !== null ? node.gasLevel.toFixed(0) : 'N/A'}
                      </td>
                      <td>
                        <span className={`badge ${node.status === 'active' ? 'badge-green' : node.status === 'warning' ? 'badge-yellow' : 'badge-red'}`}>
                          {node.status ? node.status.toUpperCase() : 'UNKNOWN'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      No active Sub-Servers detected in the network
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Node Inspector Card */}
        <div className="panel glass-panel inspector-panel" style={{ flex: 1.3, padding: '16px', display: 'flex', flexDirection: 'column', minHeight: '520px', marginBottom: 0 }}>
          <div className="section-header" style={{ marginBottom: 12 }}>Node Inspector</div>

          {sel ? (
            <div className="panel-scroll animate-slide-in">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {dataSourceManager?.isSimulation && (
                  <button className="btn btn-sm btn-danger" style={{ flex: 1, padding: '8px', fontWeight: 'bold' }} onClick={() => { graph.removeNode(selectedNode); setSelectedNode(null); sim.eventLog.add('warning', `Node ${sel.label} removed from mesh`); setTick(t => t + 1); }}>
                    Delete Node
                  </button>
                )}
                <button className="btn btn-sm btn-yellow" style={{ flex: 1, padding: '8px', fontWeight: 'bold' }} onClick={() => sim.failNode(selectedNode)}>
                  Fail Node
                </button>
              </div>
              
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', color: 'var(--nash-chartreuse)', marginBottom: 8, fontWeight: 'bold' }}>
                {dataSourceManager?.isHardware ? (sel.id === 'A' ? "Main Server" : `Sub-Server ${sel.id}`) : sel.label}
              </h3>
              
              <span className={`badge ${sel.data.status === 'active' ? 'badge-green' : sel.data.status === 'warning' ? 'badge-yellow' : 'badge-red'}`} style={{ marginBottom: 12 }}>
                {sel.data.status.toUpperCase()}
              </span>

              {/* Node-specific sensor values popup card */}
              <div className="glass-panel" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--font-display)', color: 'var(--nash-chartreuse)', fontSize: '0.72rem', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                  {sel.id === 'A' ? 'Main Server Metrics' : `Sub-Server ${sel.id} Sensors`}
                </div>
                <table className="data-table">
                  <tbody>
                    <tr>
                      <td>Temperature</td>
                      <td style={{ color: sel.data.temperature !== null && sel.data.temperature !== undefined && sel.data.temperature > 60 ? '#FF1744' : '#FFC85C', fontWeight: 'bold' }}>
                        {sel.data.temperature !== null && sel.data.temperature !== undefined ? `${sel.data.temperature.toFixed(1)}°C` : 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td>Humidity</td>
                      <td>
                        {sel.data.humidity !== null && sel.data.humidity !== undefined ? `${sel.data.humidity.toFixed(1)}%` : 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td>Gas Level</td>
                      <td style={{ color: sel.data.gasLevel !== null && sel.data.gasLevel !== undefined && sel.data.gasLevel > 210 ? '#FF1744' : '#FFC85C', fontWeight: 'bold' }}>
                        {sel.data.gasLevel !== null && sel.data.gasLevel !== undefined ? sel.data.gasLevel.toFixed(0) : 'N/A'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="section-header" style={{ marginTop: 12, fontSize: '0.7rem', paddingBottom: 4 }}>Detailed Info</div>
              <table className="data-table" style={{ marginBottom: 12 }}>
                <tbody>
                  {sel.id !== 'A' && (
                    <tr>
                      <td>Battery</td>
                      <td style={{ color: sel.data.battery !== null && sel.data.battery !== undefined && sel.data.battery < 15 ? '#FF1744' : sel.data.battery !== null && sel.data.battery !== undefined && sel.data.battery < 30 ? '#FFC85C' : '#39FF14' }}>
                        {sel.data.battery !== null && sel.data.battery !== undefined ? `${sel.data.battery.toFixed(1)}%` : 'N/A'}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>RSSI</td>
                    <td>
                      {sel.data.rssi !== null && sel.data.rssi !== undefined ? `${sel.data.rssi.toFixed(0)} dBm` : 'N/A'}
                    </td>
                  </tr>
                  <tr>
                    <td>Latency</td>
                    <td>
                      {sel.data.latency !== null && sel.data.latency !== undefined ? `${sel.data.latency.toFixed(1)} ms` : 'N/A'}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Edge Weight Editor */}
              <div className="section-header" style={{ marginTop: 12, fontSize: '0.7rem', paddingBottom: 4 }}>Link Weights</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {graph.edges.filter(e => e.source === sel.id || e.target === sel.id).length > 0 ? (
                  graph.edges.filter(e => e.source === sel.id || e.target === sel.id).map(edge => {
                    const peerId = edge.source === sel.id ? edge.target : edge.source;
                    const peerLabel = dataSourceManager?.isHardware ? `Sub-Server ${peerId}` : (graph.nodes.get(peerId)?.label || peerId);
                    return (
                      <div key={`${edge.source}-${edge.target}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Link to {peerLabel}:</span>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          defaultValue={edge.weight}
                          style={{
                            width: 50,
                            background: 'rgba(0,0,0,0.6)',
                            color: 'var(--nash-chartreuse)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 4,
                            padding: '2px 4px',
                            textAlign: 'center'
                          }}
                          onBlur={(e) => {
                            const newWeight = Number(e.target.value);
                            if (isNaN(newWeight) || newWeight < 1) return;
                            edge.weight = newWeight;
                            
                            // Also update backend API in online/hardware mode
                            if (dataSourceManager.mode !== 'simulation') {
                              fetch('/api/edges/weight', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ source: edge.source, target: edge.target, weight: newWeight })
                              }).catch(err => console.error("Error updating edge weight:", err));
                            }
                            
                            setTick(t => t + 1);
                          }}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No connections</div>
                )}
              </div>
            </div>
          ) : (
            <div className="panel-scroll animate-fade-in" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ textTransform: 'uppercase', fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '1.5px', fontWeight: 'bold' }}>
                System Diagnostics
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="glass-panel" style={{ padding: '12px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>MESH SIGNAL HEALTH</div>
                  <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--nash-chartreuse)', marginTop: '4px' }}>OPTIMAL</div>
                </div>
                <div className="glass-panel" style={{ padding: '12px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>NETWORK TOPOLOGY</div>
                  <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--neon-cyan)', marginTop: '4px' }}>CONVERGED</div>
                </div>
              </div>
              
              <div className="glass-panel" style={{ padding: '14px', background: 'var(--bg-secondary)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#ffffff', marginBottom: '10px', letterSpacing: '0.5px' }}>LIVE MESH ADJACENCY (TOP 4 LINKS)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {graph.edges.slice(0, 4).map((edge, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Link {graph.nodes.get(edge.source)?.label} ↔ {graph.nodes.get(edge.target)?.label}
                      </span>
                      <span style={{ color: 'var(--warm-yellow)', fontWeight: 'bold' }}>
                        Cost: {edge.weight.toFixed(dataSourceManager.mode === 'simulation' ? 0 : 1)}{dataSourceManager.mode === 'simulation' ? 'ms' : ' km'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', textAlign: 'center' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Select any active node on the topology map to inspect details, modify connection weights, or simulate system failures.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Live Events Stream Card */}
        <div className="panel glass-panel events-panel" style={{ flex: 0.7, padding: '16px', display: 'flex', flexDirection: 'column', minHeight: '220px', marginBottom: 0 }}>
          <div className="section-header" style={{ marginBottom: 8 }}>Live Event Stream</div>
          <div className="panel-scroll" style={{ flex: 1 }}>
            {events.map(ev => (
              <div key={ev.id} className={`event-item ${ev.type}`} style={{ fontSize: '0.72rem', padding: '4px 8px' }}>
                <span style={{ opacity: 0.45, marginRight: 6, fontSize: '0.62rem' }}>{ev.timestamp.toLocaleTimeString()}</span>
                {ev.message}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
