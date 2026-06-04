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
  const { graph, sim, dataSourceManager, theme } = useApp();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [tick, setTick] = useState(0);
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

  const handleToggleSim = () => {
    if (sim.isRunning) {
      sim.stop();
    } else {
      sim.start();
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

  const handleFailNode = () => {
    if (!selectedNode) return;
    if (dataSourceManager?.isHardware) {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      fetch(`${backendUrl}/api/nodes/${selectedNode}/fail`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') {
            sim.eventLog.add('critical', `Manual fail command sent for Sub-Server ${selectedNode}`);
          }
        })
        .catch(err => console.error('Failed to fail node:', err));
    } else {
      sim.failNode(selectedNode);
    }
  };

  const handleRecoverNode = () => {
    if (!selectedNode) return;
    if (dataSourceManager?.isHardware) {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      fetch(`${backendUrl}/api/nodes/${selectedNode}/recover`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') {
            sim.eventLog.add('success', `Manual recover command sent for Sub-Server ${selectedNode}`);
          }
        })
        .catch(err => console.error('Failed to recover node:', err));
    } else {
      sim.recoverNode(selectedNode);
    }
  };

  // Auto-start simulation (only in simulation mode)
  useEffect(() => {
    if (dataSourceManager && !dataSourceManager.isHardware && !sim.isRunning) {
      sim.start();
    }
  }, [sim]);

  // Subscribe for re-renders
  useEffect(() => {
    const unsub = sim.subscribe(() => setTick(t => t + 1));
    return unsub;
  }, [sim]);

  // Live real-time update of the sub-servers data table
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

  // ── Main Canvas Loop ──────────────────────────────────────────────
  useEffect(() => {
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
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const isLight = theme === 'light';

      // ── Dotted Grid (Nash.ai style) ──
      ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.08)';
      for (let x = 20; x < w; x += 40) {
        for (let y = 20; y < h; y += 40) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const PAD = 65;

      // ── Edges ──
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        const sp = nodePos(src, w, h, PAD);
        const tp = nodePos(tgt, w, h, PAD);
        const failed = src.data.status === 'failed' || tgt.data.status === 'failed';

        ctx.strokeStyle = failed 
          ? (isLight ? 'rgba(255,138,128,0.3)' : 'rgba(255,23,68,0.25)') 
          : (isLight ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)');
        ctx.lineWidth = failed ? 1.5 : 2.5;
        ctx.setLineDash(failed ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();

        // Weight label
        if (!failed) {
          ctx.font = 'bold 11px "Geist Mono", monospace';
          ctx.fillStyle = isLight ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)';
          ctx.textAlign = 'center';
          ctx.fillText(edge.weight.toString(), (sp.x + tp.x) / 2, (sp.y + tp.y) / 2 - 5);
        }

        // Animated flow dots on active edges (Nash.ai style)
        if (!failed) {
          const flowOff = (t * 30) % 20;
          ctx.setLineDash([3, 17]);
          ctx.lineDashOffset = -flowOff;
          ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.75)' : 'rgba(201,255,0,0.6)';
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          ctx.lineTo(tp.x, tp.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      // ── Active Packets ──
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
        let dotColor;
        if (isLight) {
          dotColor = '#ffffff';
        } else {
          dotColor = color === '#39FF14' || color === 'var(--neon-green)' ? '#c9ff00' : color;
        }
        
        ctx.fillStyle = dotColor;
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = isLight ? 3 : 8;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── Nodes ──
      for (const [id, node] of graph.nodes) {
        const isSel = selectedNode === id;
        const status = node.data.status;
        const { x, y } = nodePos(node, w, h, PAD);

        const isGateway = id === 'A' && dataSourceManager?.isHardware;

        // Sync legacy .x/.y for algorithm pages
        node.x = x;
        node.y = y;

        // Node base colors based on theme
        const activeColor = isLight ? '#ffffff' : '#c9ff00';
        const gatewayColor = '#FFD700';
        
        let fillColor;
        if (isGateway) fillColor = gatewayColor;
        else if (status === 'failed') fillColor = isLight ? '#ff8a80' : '#FF1744';
        else if (status === 'critical') fillColor = isLight ? '#ffb74d' : '#FF9100';
        else if (status === 'warning') fillColor = isLight ? '#ffe082' : '#FFC85C';
        else fillColor = activeColor;

        // Node core body (Larger visible dot)
        const r = isSel ? (isGateway ? 24 : 18) : (isGateway ? 18 : 14);

        ctx.fillStyle = fillColor;
        ctx.shadowColor = fillColor;
        ctx.shadowBlur = isSel ? (isLight ? 8 : 18) : (isLight ? 3 : 8);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Selection ring
        if (isSel) {
          ctx.strokeStyle = fillColor;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 8, 0, Math.PI * 2);
          ctx.stroke();
        }

        // ESP32 label (placed cleanly at top/bottom of node)
        let labelText = node.label;
        if (dataSourceManager?.isHardware) {
          if (id === 'A') {
            labelText = "Main Server (Gateway)";
          } else {
            labelText = `Sub-Server ${id}`;
          }
        }
        ctx.font = 'bold 11px "Geist Mono", monospace';
        ctx.fillStyle = isLight ? '#ffffff' : (isGateway ? '#FFD700' : 'rgba(255,255,255,0.75)');
        ctx.textAlign = 'center';
        ctx.fillText(labelText, x, y - r - 10);

        // Alert text (emojiless alert label)
        if (status === 'critical' || status === 'warning') {
            ctx.font = 'bold 11px "Geist Mono", monospace';
            ctx.fillStyle = status === 'critical' ? (isLight ? '#ff8a80' : '#FF1744') : '#FFC85C';
            ctx.fillText(status === 'critical' ? 'ALERT' : '!', x + r + 8, y + 4);
        }

        // Battery micro-bar (drawn elegantly below node)
        const bw = 24, bh = 4;
        const bx = x - bw / 2, by = y + r + 10;
        ctx.fillStyle = isLight ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx, by, bw, bh);
        const pct = node.data.battery / 100;
        ctx.fillStyle = pct < 0.15 ? (isLight ? '#ff8a80' : '#FF1744') : pct < 0.3 ? '#FFC85C' : (isLight ? '#ffffff' : '#c9ff00');
        ctx.fillRect(bx, by, bw * pct, bh);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [graph, sim, selectedNode, theme]);

  // ── Mouse: select & drag ──────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
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
  }, [graph]);

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const canvas = canvasRef.current;
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
          {!dataSourceManager?.isHardware ? (
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

          <button className="btn btn-primary" onClick={handleToggleSim} style={{ padding: '6px 16px', fontWeight: '600' }}>
            {sim.isRunning ? 'Pause' : 'Start'}
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
              {sim.isRunning ? '● LIVE MONITORING' : '○ PAUSED'} · Click node to inspect
            </span>
          </div>
          
          <div className="topo-canvas-wrap" ref={containerRef} style={{ flex: 1, position: 'relative', borderRadius: '8px', overflow: 'hidden' }}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ width: '100%', height: '100%', display: 'block', cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
            />

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
                      <td style={{ color: node.temperature > 60 ? '#FF1744' : '#FFC85C' }}>
                        {node.temperature !== undefined ? `${node.temperature.toFixed(1)}°C` : 'N/A'}
                      </td>
                      <td>
                        {node.humidity !== undefined ? `${node.humidity.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td style={{ color: node.gasLevel > 210 ? '#FF1744' : '#FFC85C' }}>
                        {node.gasLevel !== undefined ? node.gasLevel.toFixed(0) : 'N/A'}
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
                <button className="btn btn-sm btn-danger" style={{ flex: 1, padding: '8px', fontWeight: 'bold' }} onClick={() => { graph.removeNode(selectedNode); setSelectedNode(null); sim.eventLog.add('warning', `Node ${sel.label} removed from mesh`); setTick(t => t + 1); }}>
                  Delete Node
                </button>
                {sel.data.status === 'failed' ? (
                  <button className="btn btn-sm btn-green" style={{ flex: 1, padding: '8px', fontWeight: 'bold' }} onClick={handleRecoverNode}>
                    Recover Node
                  </button>
                ) : (
                  <button className="btn btn-sm btn-yellow" style={{ flex: 1, padding: '8px', fontWeight: 'bold' }} onClick={handleFailNode}>
                    Fail Node
                  </button>
                )}
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
                    <tr><td>Temperature</td><td style={{ color: sel.data.temperature > 60 ? '#FF1744' : '#FFC85C', fontWeight: 'bold' }}>{sel.data.temperature.toFixed(1)}°C</td></tr>
                    <tr><td>Humidity</td><td>{sel.data.humidity.toFixed(1)}%</td></tr>
                    <tr><td>Gas Level</td><td style={{ color: sel.data.gasLevel > 210 ? '#FF1744' : '#FFC85C', fontWeight: 'bold' }}>{sel.data.gasLevel.toFixed(0)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="section-header" style={{ marginTop: 12, fontSize: '0.7rem', paddingBottom: 4 }}>Detailed Info</div>
              <table className="data-table" style={{ marginBottom: 12 }}>
                <tbody>
                  {sel.id !== 'A' && <tr><td>Battery</td><td style={{ color: sel.data.battery < 15 ? '#FF1744' : sel.data.battery < 30 ? '#FFC85C' : '#39FF14' }}>{sel.data.battery.toFixed(1)}%</td></tr>}
                  <tr><td>RSSI</td><td>{sel.data.rssi.toFixed(0)} dBm</td></tr>
                  <tr><td>Latency</td><td>{sel.data.latency.toFixed(1)} ms</td></tr>
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
                        Cost: {edge.weight}ms
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
