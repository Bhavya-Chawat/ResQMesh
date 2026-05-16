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
  const { graph, sim } = useApp();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [, setTick] = useState(0);
  const dragRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);

  // Auto-start simulation
  useEffect(() => {
    if (!sim.isRunning) sim.start();
  }, [sim]);

  // Subscribe for re-renders
  useEffect(() => {
    const unsub = sim.subscribe(() => setTick(t => t + 1));
    return unsub;
  }, [sim]);

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

        // Sync legacy .x/.y for algorithm pages that still use them
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
          if (Math.sin(t * 6) > 0) {
            ctx.font = '12px sans-serif';
            ctx.fillText(status === 'critical' ? '⚠' : '!', x + r + 5, y - 4);
          }
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
    sim.eventLog.add('success', `✅ ${label} added to mesh`);
    setTick(t => t + 1);
  };

  const sel = selectedNode ? graph.nodes.get(selectedNode) : null;
  const health = sim.getNetworkHealth();
  const events = sim.eventLog.getRecent(30);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title glow-text-orange">⬡ Command Center</h1>
        <div className="page-controls">
          <button className="btn btn-sm" onClick={() => sim.isRunning ? sim.stop() : sim.start()}>
            {sim.isRunning ? '⏸ Pause' : '▶ Start'}
          </button>
          <button className="btn btn-sm btn-yellow" onClick={addNode}>+ Node</button>
          {selectedNode && <>
            <button className="btn btn-sm btn-danger" onClick={() => { sim.failNode(selectedNode); setSelectedNode(null); }}>✕ Fail Node</button>
            <button className="btn btn-sm btn-cyan" onClick={() => sim.recoverNode(selectedNode)}>↻ Recover</button>
            <button className="btn btn-sm btn-danger" onClick={() => { graph.removeNode(selectedNode); setSelectedNode(null); sim.eventLog.add('warning', 'Node removed from mesh'); setTick(t => t + 1); }}>🗑 Remove</button>
          </>}
        </div>
      </div>

      {/* Stat Strip */}
      <div className="stat-strip">
        {[
          { label: 'Active Nodes', value: `${health.activeNodes}/${health.totalNodes}`, cls: '' },
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
              <span className="icon">◎</span> Live Topology — ESP32 Mesh Network
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
          </div>
        </div>

        {/* Inspector Panel */}
        <div className="inspector-area panel glass-panel">
          <div className="section-header"><span className="icon">◈</span> Node Inspector</div>

          {sel ? (
            <div className="panel-scroll animate-slide-in">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--neon-orange)', marginBottom: 8 }}>
                {sel.label}
              </h3>
              <span className={`badge ${sel.data.status === 'active' ? 'badge-green' : sel.data.status === 'warning' ? 'badge-yellow' : 'badge-red'}`}>
                {sel.data.status.toUpperCase()}
              </span>
              <table className="data-table" style={{ marginTop: 12 }}>
                <tbody>
                  <tr><td>🌡 Temperature</td><td style={{ color: sel.data.temperature > 60 ? '#FF1744' : '#FFC85C' }}>{sel.data.temperature.toFixed(1)}°C</td></tr>
                  <tr><td>💧 Humidity</td><td>{sel.data.humidity.toFixed(1)}%</td></tr>
                  <tr><td>☢ Gas Level</td><td style={{ color: sel.data.gasLevel > 600 ? '#FF1744' : '#FFC85C' }}>{sel.data.gasLevel.toFixed(0)}</td></tr>
                  <tr><td>🔋 Battery</td><td style={{ color: sel.data.battery < 15 ? '#FF1744' : sel.data.battery < 30 ? '#FFC85C' : '#39FF14' }}>{sel.data.battery.toFixed(1)}%</td></tr>
                  <tr><td>📶 RSSI</td><td>{sel.data.rssi.toFixed(0)} dBm</td></tr>
                  <tr><td>⏱ Latency</td><td>{sel.data.latency.toFixed(1)} ms</td></tr>
                  <tr><td>📊 Throughput</td><td>{sel.data.throughput.toFixed(0)} kbps</td></tr>
                  <tr><td>📡 Signal</td><td>{sel.data.signalQuality.toFixed(0)}%</td></tr>
                </tbody>
              </table>

              <div className="section-header" style={{ marginTop: 16 }}><span className="icon">🗺</span> Routing Table</div>
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
          <div className="section-header" style={{ marginTop: 16 }}><span className="icon">📋</span> Live Event Stream</div>
          <div className="panel-scroll" style={{ maxHeight: 220 }}>
            {events.map(ev => (
              <div key={ev.id} className={`event-item ${ev.type}`}>
                <span style={{ opacity: 0.45, marginRight: 6, fontSize: '0.65rem' }}>{ev.timestamp.toLocaleTimeString()}</span>
                {ev.message}
              </div>
            ))}
          </div>
        </div>

        {/* Analytics Strip */}
        <div className="analytics-strip panel glass-panel" style={{ maxHeight: 90 }}>
          <div className="section-header" style={{ marginBottom: 4 }}><span className="icon">📊</span> Live Analytics</div>
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
