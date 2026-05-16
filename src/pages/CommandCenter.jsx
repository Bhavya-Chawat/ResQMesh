import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../App';
import { GraphNode } from '../engine/graph';

export default function CommandCenter() {
  const { graph, sim } = useApp();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [, setTick] = useState(0);
  const dragRef = useRef(null);

  // Start sim on mount
  useEffect(() => {
    if (!sim.isRunning) sim.start();
  }, [sim]);

  // Redraw loop
  useEffect(() => {
    const unsub = sim.subscribe(() => setTick(t => t + 1));
    return unsub;
  }, [sim]);

  // Canvas rendering
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
      ctx.strokeStyle = 'rgba(255,101,63,0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      // Draw edges
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        const failed = src.data.status === 'failed' || tgt.data.status === 'failed';

        ctx.strokeStyle = failed ? 'rgba(255,23,68,0.2)' : 'rgba(255,200,92,0.2)';
        ctx.lineWidth = failed ? 1 : 2;
        if (failed) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.stroke();

        // Weight label
        if (!failed) {
          const mx = (src.x + tgt.x) / 2;
          const my = (src.y + tgt.y) / 2;
          ctx.font = '10px "Share Tech Mono"';
          ctx.fillStyle = 'rgba(255,200,92,0.5)';
          ctx.textAlign = 'center';
          ctx.fillText(edge.weight.toString(), mx, my - 5);
        }

        // Animated flow
        if (!failed) {
          const flowOffset = (time * 40) % 20;
          ctx.setLineDash([3, 17]);
          ctx.lineDashOffset = -flowOffset;
          ctx.strokeStyle = 'rgba(0,229,255,0.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      // Draw animated packets
      for (const pkt of sim.activePackets) {
        if (!pkt.path || pkt.path.length < 2) continue;
        const progress = ((time * 0.5) % 1);
        const totalSegs = pkt.path.length - 1;
        const segFloat = progress * totalSegs;
        const seg = Math.min(Math.floor(segFloat), totalSegs - 1);
        const segT = segFloat - seg;
        const sn = graph.nodes.get(pkt.path[seg]);
        const en = graph.nodes.get(pkt.path[seg + 1]);
        if (!sn || !en) continue;
        const px = sn.x + (en.x - sn.x) * segT;
        const py = sn.y + (en.y - sn.y) * segT;

        const color = pkt.getPriorityColor();
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw nodes
      for (const [id, node] of graph.nodes) {
        const isSel = selectedNode === id;
        const status = node.data.status;

        // Outer glow
        let glowColor;
        if (status === 'failed') glowColor = 'rgba(255,23,68,0.3)';
        else if (status === 'critical') glowColor = 'rgba(255,23,68,0.4)';
        else if (status === 'warning') glowColor = 'rgba(255,200,92,0.3)';
        else glowColor = 'rgba(0,229,255,0.2)';

        const pulseR = 20 + Math.sin(time * 2 + node.x * 0.01) * 5;
        const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, pulseR);
        grad.addColorStop(0, glowColor);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseR, 0, Math.PI * 2);
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
        ctx.shadowBlur = isSel ? 16 : 8;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Selection ring
        if (isSel) {
          ctx.strokeStyle = '#FFC85C';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Label
        ctx.font = '11px "Orbitron"';
        ctx.fillStyle = '#f0eaf8';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y - r - 8);

        // Status indicator for critical/warning
        if (status === 'critical' || status === 'warning') {
          const blink = Math.sin(time * 6) > 0;
          if (blink) {
            ctx.font = '12px sans-serif';
            ctx.fillText(status === 'critical' ? '⚠' : '!', node.x + r + 4, node.y - 4);
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, [graph, sim, selectedNode]);

  // Mouse handling
  const handleCanvasMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const [id, node] of graph.nodes) {
      const dx = mx - node.x, dy = my - node.y;
      if (dx * dx + dy * dy < 225) {
        setSelectedNode(id);
        dragRef.current = { id, offsetX: dx, offsetY: dy };
        return;
      }
    }
    setSelectedNode(null);
  }, [graph]);

  const handleCanvasMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const node = graph.nodes.get(dragRef.current.id);
    if (node) {
      node.x = e.clientX - rect.left - dragRef.current.offsetX;
      node.y = e.clientY - rect.top - dragRef.current.offsetY;
    }
  }, [graph]);

  const handleCanvasMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // Add node
  const addNode = () => {
    const id = String.fromCharCode(65 + graph.nodes.size);
    const label = `Node ${id}`;
    const canvas = canvasRef.current;
    const x = 100 + Math.random() * (canvas ? canvas.width - 200 : 400);
    const y = 100 + Math.random() * (canvas ? canvas.height - 200 : 300);
    graph.addNode(new GraphNode(id, label, x, y));
    // Connect to random existing nodes
    const existing = Array.from(graph.nodes.keys()).filter(k => k !== id);
    if (existing.length > 0) {
      const n1 = existing[Math.floor(Math.random() * existing.length)];
      graph.addEdge(id, n1, Math.floor(8 + Math.random() * 20));
      if (existing.length > 1) {
        let n2 = n1;
        while (n2 === n1) n2 = existing[Math.floor(Math.random() * existing.length)];
        graph.addEdge(id, n2, Math.floor(8 + Math.random() * 20));
      }
    }
    sim.eventLog.add('success', `✅ Node ${label} added to mesh`);
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
        </div>
      </div>

      {/* Stat Strip */}
      <div className="stat-strip">
        <div className="stat-card glass-panel">
          <div className="stat-label">Active Nodes</div>
          <div className="stat-value">{health.activeNodes}/{health.totalNodes}</div>
        </div>
        <div className="stat-card glass-panel">
          <div className="stat-label">Edges</div>
          <div className="stat-value yellow">{health.activeEdges}</div>
        </div>
        <div className="stat-card glass-panel">
          <div className="stat-label">Packets Sent</div>
          <div className="stat-value cyan">{health.packetsSent}</div>
        </div>
        <div className="stat-card glass-panel">
          <div className="stat-label">Delivery Rate</div>
          <div className="stat-value green">{health.deliveryRate}%</div>
        </div>
        <div className="stat-card glass-panel">
          <div className="stat-label">Avg Latency</div>
          <div className="stat-value yellow">{health.avgLatency.toFixed(1)}ms</div>
        </div>
        <div className="stat-card glass-panel">
          <div className="stat-label">Density</div>
          <div className="stat-value">{(health.density * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Topology Canvas */}
        <div className="topology-area panel glass-panel topo-container">
          <div className="topo-controls">
            <span className="section-header" style={{ margin: 0, border: 'none', paddingBottom: 0 }}>
              <span className="icon">◎</span> Live Topology
            </span>
            <div style={{ flex: 1 }} />
            {selectedNode && (
              <>
                <button className="btn btn-sm btn-danger" onClick={() => {
                  sim.failNode(selectedNode);
                  setSelectedNode(null);
                }}>✕ Fail</button>
                <button className="btn btn-sm btn-cyan" onClick={() => sim.recoverNode(selectedNode)}>
                  ↻ Recover
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => {
                  graph.removeNode(selectedNode);
                  setSelectedNode(null);
                  sim.eventLog.add('warning', `Node removed from mesh`);
                }}>🗑 Remove</button>
              </>
            )}
          </div>
          <div className="topo-canvas-wrap" ref={containerRef}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
          </div>
        </div>

        {/* Inspector Panel */}
        <div className="inspector-area panel glass-panel">
          <div className="section-header"><span className="icon">◈</span> Inspector</div>
          {sel ? (
            <div className="panel-scroll animate-slide-in">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--neon-orange)', marginBottom: 10 }}>
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

              {/* Routing Table */}
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
            <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', padding: 20, textAlign: 'center' }}>
              Click a node to inspect
            </div>
          )}

          {/* Event Log */}
          <div className="section-header" style={{ marginTop: 16 }}><span className="icon">📋</span> Event Stream</div>
          <div className="panel-scroll" style={{ maxHeight: 200 }}>
            {events.map(ev => (
              <div key={ev.id} className={`event-item ${ev.type}`}>
                <span style={{ opacity: 0.5, marginRight: 6 }}>{ev.timestamp.toLocaleTimeString()}</span>
                {ev.message}
              </div>
            ))}
          </div>
        </div>

        {/* Analytics Strip */}
        <div className="analytics-strip panel glass-panel" style={{ maxHeight: 100 }}>
          <div className="section-header" style={{ marginBottom: 6 }}><span className="icon">📊</span> Live Analytics</div>
          <div style={{ display: 'flex', gap: 20, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <span>📦 Sent: <strong style={{ color: 'var(--neon-cyan)' }}>{health.packetsSent}</strong></span>
            <span>✅ Delivered: <strong style={{ color: 'var(--neon-green)' }}>{health.packetsDelivered}</strong></span>
            <span>❌ Dropped: <strong style={{ color: 'var(--neon-red)' }}>{health.packetsDropped}</strong></span>
            <span>🔋 Avg Battery: <strong style={{ color: health.avgBattery < 30 ? 'var(--neon-red)' : 'var(--neon-green)' }}>{health.avgBattery.toFixed(1)}%</strong></span>
            <span>⏱ Avg Latency: <strong style={{ color: 'var(--warm-yellow)' }}>{health.avgLatency.toFixed(1)}ms</strong></span>
            <span>🔗 Graph Density: <strong style={{ color: 'var(--neon-orange)' }}>{(health.density * 100).toFixed(0)}%</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}
