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
  const { graph, sim, dataSourceManager } = useApp();
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

  const handleResetMesh = () => {
    graph.resetToPreset(preset, nodeCount);
    setSelectedNode(null);
    sim.eventLog.add('info', `Reset topology to ${preset.toUpperCase()} with ${nodeCount} nodes`);
    setTick(t => t + 1);
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
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // ── Grid ──
      ctx.strokeStyle = 'rgba(255,101,63,0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      const PAD = 55;

      // ── Edges ──
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
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
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

        // Sync legacy .x/.y for algorithm pages that still use them
        node.x = x;
        node.y = y;

        // Pulse glow
        let glowColor;
        if (isGateway) glowColor = 'rgba(255,215,0,0.45)'; // Golden glow for Gateway Main Server
        else if (status === 'failed') glowColor = 'rgba(255,23,68,0.35)';
        else if (status === 'critical') glowColor = 'rgba(255,101,63,0.45)';
        else if (status === 'warning') glowColor = 'rgba(255,200,92,0.35)';
        else glowColor = 'rgba(0,229,255,0.22)';

        const pulseR = (isSel ? 30 : 24) + Math.sin(t * 2.2 + node.nx * 6.28) * 5;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, pulseR);
        grad.addColorStop(0, glowColor);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, pulseR, 0, Math.PI * 2);
        ctx.fill();

        // Node body
        const r = isSel ? (isGateway ? 18 : 14) : (isGateway ? 14 : 10);
        let fillColor;
        if (isGateway) fillColor = '#FFD700'; // Gold color for Gateway Main Server!
        else if (status === 'failed') fillColor = '#FF1744';
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
        let labelText = node.label;
        if (dataSourceManager?.isHardware) {
          if (id === 'A') {
            labelText = "Main Server (Gateway)";
          } else {
            labelText = `Sub-Server ${id}`;
          }
        }
        ctx.font = 'bold 10px "Orbitron", monospace';
        ctx.fillStyle = isGateway ? '#FFD700' : '#f0eaf8';
        ctx.textAlign = 'center';
        ctx.fillText(labelText, x, y - r - 8);

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
  }, [graph, sim, selectedNode]);

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
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title glow-text-orange">Command Center</h1>
        <div className="page-controls">
          {/* Mode Toggle Button */}
          <button 
            className="btn btn-sm" 
            style={{
              borderColor: dataSourceManager?.isHardware ? 'var(--neon-green)' : 'var(--neon-cyan)',
              color: dataSourceManager?.isHardware ? 'var(--neon-green)' : 'var(--neon-cyan)',
              background: dataSourceManager?.isHardware ? 'rgba(57,255,20,0.08)' : 'rgba(0,229,255,0.08)',
              marginRight: '8px'
            }}
            onClick={() => {
              dataSourceManager.toggle();
              setSelectedNode(null);
              setTick(t => t + 1);
            }}
          >
            {dataSourceManager?.isHardware ? '🔌 Mode: Hardware' : '💻 Mode: Simulation'}
          </button>

          {!dataSourceManager?.isHardware ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={preset}
                onChange={e => setPreset(e.target.value)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: 'rgba(10,6,24,0.6)',
                  color: 'var(--warm-yellow)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '4px 6px',
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
                  color: 'var(--warm-yellow)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '4px 6px',
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
              Auto-Detected: <strong style={{ color: 'var(--neon-green)' }}>{health.activeNodes}</strong>
            </div>
          )}
          <button className="btn btn-sm" onClick={() => sim.isRunning ? sim.stop() : sim.start()}>
            {sim.isRunning ? '⏸ Pause' : '▶ Start'}
          </button>
          {!dataSourceManager?.isHardware && (
            <button className="btn btn-sm btn-cyan" onClick={addNode}>+ Node</button>
          )}
          {selectedNode && <>
            <button className="btn btn-sm btn-cyan" onClick={() => sim.recoverNode(selectedNode)}>Recover Node</button>
          </>}
        </div>
      </div>

      {/* Stat Strip */}
      <div className="stat-strip">
        {[
          { 
            label: dataSourceManager?.isHardware ? 'Live ESP Nodes' : 'Active Nodes', 
            value: `${health.activeNodes}/${health.totalNodes}`, 
            cls: '' 
          },
          { label: 'Active Edges', value: health.activeEdges, cls: 'yellow' },
          { label: 'Packets Sent', value: health.packetsSent, cls: 'cyan' },
          { label: 'Delivery Rate', value: `${health.deliveryRate}%`, cls: 'green' },
          { label: 'Avg Latency', value: `${health.avgLatency.toFixed(1)}ms`, cls: 'yellow' },
          { label: 'Graph Density', value: `${(health.density * 100).toFixed(0)}%`, cls: '' },
        ].map(s => (
          <div key={s.label} className="stat-card glass-panel">
            <div className="stat-label">{s.label}</div>
            <div className={`stat-value ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Topology Canvas */}
        <div className="topology-area panel glass-panel topo-container">
          <div className="topo-controls">
            <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>
              Live Topology — ESP32 Mesh Network
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {sim.isRunning ? '● LIVE' : '○ PAUSED'} · Click node to inspect · Drag to reposition
            </span>
          </div>
          <div className="topo-canvas-wrap" ref={containerRef}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
            />
            {isAdjusting && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(10,6,24,0.85)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                zIndex: 10,
                backdropFilter: 'blur(4px)',
                fontFamily: 'var(--font-display)',
                color: 'var(--neon-orange)'
              }}>
                <div className="glow-text-orange" style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: 2, marginBottom: 8 }}>
                  Adjusting network layout...
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Freezing updates for 2 seconds
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Inspector Panel */}
        <div className="inspector-area panel glass-panel">
          <div className="section-header">Node Inspector</div>

          {sel ? (
            <div className="panel-scroll animate-slide-in">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className="btn btn-sm btn-danger" style={{ flex: 1, padding: '12px', fontWeight: 'bold', border: '2px solid rgba(255,255,255,0.2)' }} onClick={() => { graph.removeNode(selectedNode); setSelectedNode(null); sim.eventLog.add('warning', `Node ${sel.label} removed from mesh`); setTick(t => t + 1); }}>
                  Delete Node
                </button>
                <button className="btn btn-sm btn-yellow" style={{ flex: 1, padding: '12px', fontWeight: 'bold' }} onClick={() => sim.failNode(selectedNode)}>
                  Fail Node
                </button>
              </div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--neon-orange)', marginBottom: 8 }}>
                {dataSourceManager?.isHardware ? (sel.id === 'A' ? "Main Server" : `Sub-Server ${sel.id}`) : sel.label}
              </h3>
              <span className={`badge ${sel.data.status === 'active' ? 'badge-green' : sel.data.status === 'warning' ? 'badge-yellow' : 'badge-red'}`} style={{ marginBottom: 12 }}>
                {sel.data.status.toUpperCase()}
              </span>

              {/* Node-specific sensor values displayed in a dedicated toggle popup card */}
              <div className="glass-panel" style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid rgba(255,101,63,0.15)', background: 'rgba(10,6,24,0.4)', marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--font-display)', color: 'var(--neon-orange)', fontSize: '0.72rem', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  📡 {sel.id === 'A' ? 'Main Server Metrics' : `Sub-Server ${sel.id} Sensors`}
                </div>
                <table className="data-table">
                  <tbody>
                    <tr><td>Temperature</td><td style={{ color: sel.data.temperature > 60 ? '#FF1744' : '#FFC85C', fontWeight: 'bold' }}>{sel.data.temperature.toFixed(1)}°C</td></tr>
                    <tr><td>Humidity</td><td>{sel.data.humidity.toFixed(1)}%</td></tr>
                    <tr><td>Gas Level</td><td style={{ color: sel.data.gasLevel > 210 ? '#FF1744' : '#FFC85C', fontWeight: 'bold' }}>{sel.data.gasLevel.toFixed(0)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="section-header" style={{ marginTop: 16 }}>Detailed Info</div>
              <table className="data-table" style={{ marginBottom: 16 }}>
                <tbody>
                  {sel.id !== 'A' && <tr><td>Battery</td><td style={{ color: sel.data.battery < 15 ? '#FF1744' : sel.data.battery < 30 ? '#FFC85C' : '#39FF14' }}>{sel.data.battery.toFixed(1)}%</td></tr>}
                  <tr><td>RSSI</td><td>{sel.data.rssi.toFixed(0)} dBm</td></tr>
                  <tr><td>Latency</td><td>{sel.data.latency.toFixed(1)} ms</td></tr>
                  <tr><td>Throughput</td><td>{sel.data.throughput.toFixed(0)} kbps</td></tr>
                  <tr><td>Signal</td><td>{sel.data.signalQuality.toFixed(0)}%</td></tr>
                </tbody>
              </table>

              {/* Edge Weight Editor */}
              <div className="section-header" style={{ marginTop: 16 }}>Link Weights (Default: 2)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {graph.edges.filter(e => e.source === sel.id || e.target === sel.id).length > 0 ? (
                  graph.edges.filter(e => e.source === sel.id || e.target === sel.id).map(edge => {
                    const peerId = edge.source === sel.id ? edge.target : edge.source;
                    const peerLabel = dataSourceManager?.isHardware ? `Sub-Server ${peerId}` : (graph.nodes.get(peerId)?.label || peerId);
                    return (
                      <div key={`${edge.source}-${edge.target}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Link to {peerLabel}:</span>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          defaultValue={edge.weight}
                          style={{
                            width: 60,
                            background: 'rgba(0,0,0,0.6)',
                            color: 'var(--neon-orange)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            fontFamily: 'var(--font-mono)',
                            textAlign: 'center'
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.target.blur();
                          }}
                          onBlur={async (e) => {
                            const newWeight = Number(e.target.value);
                            if (isNaN(newWeight) || newWeight < 1) return;
                            
                            setIsAdjusting(true);
                            const prevIsRunning = sim.isRunning;
                            sim.stop();

                            edge.weight = newWeight;
                            edge.data.latency = newWeight;

                            if (dataSourceManager?.isHardware) {
                              try {
                                await fetch('/api/edges/weight', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    source: edge.source,
                                    target: edge.target,
                                    weight: newWeight
                                  })
                                });
                              } catch (err) {
                                console.error("Failed to update edge weight:", err);
                              }
                            }

                            setTimeout(() => {
                              setIsAdjusting(false);
                              if (prevIsRunning) {
                                sim.start();
                              }
                              setTick(t => t + 1);
                            }, 2000);
                          }}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', padding: 8 }}>
                    No active connections
                  </div>
                )}
              </div>

              <div className="section-header" style={{ marginTop: 16 }}>Routing Table</div>
              <div className="routing-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Dest</th><th>Next Hop</th><th>Cost</th><th>Hops</th></tr></thead>
                  <tbody>
                    {graph.getRoutingTable(selectedNode).map(r => (
                      <tr key={r.destination}>
                        <td>{r.destLabel}</td>
                        <td style={{ color: 'var(--neon-cyan)' }}>{r.nextHopLabel}</td>
                        <td>{r.distance === Infinity ? '∞' : r.distance.toFixed(1)}</td>
                        <td>{r.hopCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', padding: 20, textAlign: 'center', marginTop: 40 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.3 }}>◎</div>
              Click any node on the<br />topology to inspect it
            </div>
          )}

          {/* Event Log */}
          <div className="section-header" style={{ marginTop: 16 }}>Live Event Stream</div>
          <div className="panel-scroll" style={{ maxHeight: 220 }}>
            {events.map(ev => (
              <div key={ev.id} className={`event-item ${ev.type}`}>
                <span style={{ opacity: 0.45, marginRight: 6, fontSize: '0.65rem' }}>{ev.timestamp.toLocaleTimeString()}</span>
                {ev.message}
              </div>
            ))}
          </div>
        </div>

        {/* Sub-Servers Data Table */}
        <div className="subnodes-table-area panel glass-panel">
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

        {/* Analytics Strip */}
        <div className="analytics-strip panel glass-panel" style={{ maxHeight: 90 }}>
          <div className="section-header" style={{ marginBottom: 4 }}>Live Analytics</div>
          <div style={{ display: 'flex', gap: 24, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <span>📦 Sent: <strong style={{ color: 'var(--neon-cyan)' }}>{health.packetsSent}</strong></span>
            <span>✅ Delivered: <strong style={{ color: 'var(--neon-green)' }}>{health.packetsDelivered}</strong></span>
            <span>❌ Dropped: <strong style={{ color: 'var(--neon-red)' }}>{health.packetsDropped}</strong></span>
            <span>🔋 Avg Battery: <strong style={{ color: health.avgBattery < 30 ? 'var(--neon-red)' : 'var(--neon-green)' }}>{health.avgBattery.toFixed(1)}%</strong></span>
            <span>⏱ Avg Latency: <strong style={{ color: 'var(--warm-yellow)' }}>{health.avgLatency.toFixed(1)}ms</strong></span>
            <span>🔗 Density: <strong style={{ color: 'var(--neon-orange)' }}>{(health.density * 100).toFixed(0)}%</strong></span>
            <span>🟢 Active Packets: <strong style={{ color: 'var(--neon-cyan)' }}>{sim.activePackets.length}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}
