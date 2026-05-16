import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

export default function RescueMode() {
  const { graph, sim } = useApp();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedAlerts, setSelectedAlerts] = useState(new Set());
  const [rescueResult, setRescueResult] = useState(null);
  const [isComputing, setIsComputing] = useState(false);
  const [rescueStepIdx, setRescueStepIdx] = useState(-1);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = sim.subscribe(() => setTick(t => t + 1));
    return unsub;
  }, [sim]);

  const nodeIds = Array.from(graph.nodes.keys());

  const toggleAlert = (id) => {
    setSelectedAlerts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setRescueResult(null);
    setRescueStepIdx(-1);
  };

  const computeRescue = useCallback(() => {
    const alerts = Array.from(selectedAlerts);
    if (alerts.length < 2) return;
    setIsComputing(true);
    sim.eventLog.add('algorithm', `🚨 RESCUE MODE: Computing optimal route for ${alerts.length} alert nodes`);

    setTimeout(() => {
      const result = graph.tspBranchAndBound(alerts);
      setRescueResult(result);
      setRescueStepIdx(result.steps.length - 1);
      setIsComputing(false);
      sim.eventLog.add('success', `✅ Rescue route computed! Cost: ${result.bestCost.toFixed(1)}, States: ${result.statesExplored}`);
    }, 500);
  }, [selectedAlerts, graph, sim]);

  // Canvas
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
      ctx.strokeStyle = 'rgba(255,23,68,0.03)';
      for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      // Edges
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        ctx.strokeStyle = 'rgba(255,200,92,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.stroke();

        const mx = (src.x + tgt.x) / 2, my = (src.y + tgt.y) / 2;
        ctx.font = '9px "Share Tech Mono"';
        ctx.fillStyle = 'rgba(255,200,92,0.3)';
        ctx.textAlign = 'center';
        ctx.fillText(edge.weight.toString(), mx, my - 4);
      }

      // Rescue path
      if (rescueResult?.bestPath && rescueResult.bestPath.length > 1) {
        const path = rescueResult.bestPath;
        // Animated dashed rescue route
        const dashOffset = time * 30;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -dashOffset;
        ctx.strokeStyle = '#FF653F';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#FF653F';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const n = graph.nodes.get(path[i]);
          if (!n) continue;
          if (i === 0) ctx.moveTo(n.x, n.y); else ctx.lineTo(n.x, n.y);
        }
        // Close the loop
        const first = graph.nodes.get(path[0]);
        if (first) ctx.lineTo(first.x, first.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Animated rescue vehicle
        const totalSegs = path.length;
        const vehiclePos = (time * 0.15) % 1;
        const segFloat = vehiclePos * totalSegs;
        const seg = Math.floor(segFloat) % totalSegs;
        const segT = segFloat - Math.floor(segFloat);
        const sn = graph.nodes.get(path[seg]);
        const en = graph.nodes.get(path[(seg + 1) % path.length]);
        if (sn && en) {
          const vx = sn.x + (en.x - sn.x) * segT;
          const vy = sn.y + (en.y - sn.y) * segT;
          // Vehicle glow
          const vGrad = ctx.createRadialGradient(vx, vy, 0, vx, vy, 20);
          vGrad.addColorStop(0, 'rgba(255,101,63,0.5)');
          vGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = vGrad;
          ctx.beginPath();
          ctx.arc(vx, vy, 20, 0, Math.PI * 2);
          ctx.fill();
          // Vehicle dot
          ctx.fillStyle = '#FF653F';
          ctx.shadowColor = '#FF653F';
          ctx.shadowBlur = 15;
          ctx.beginPath();
          ctx.arc(vx, vy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = '12px sans-serif';
          ctx.fillText('🚑', vx - 6, vy - 12);
        }

        // Order labels on path
        for (let i = 0; i < path.length; i++) {
          const n = graph.nodes.get(path[i]);
          if (!n) continue;
          ctx.font = 'bold 12px "Orbitron"';
          ctx.fillStyle = '#FF653F';
          ctx.textAlign = 'center';
          ctx.fillText(`#${i + 1}`, n.x + 18, n.y - 18);
        }
      }

      // Nodes
      for (const [id, node] of graph.nodes) {
        const isAlert = selectedAlerts.has(id);
        const r = isAlert ? 14 : 10;
        let color = isAlert ? '#FF1744' : '#448AFF';

        if (isAlert) {
          // Pulsing alert
          const pulseR = 25 + Math.sin(time * 4) * 8;
          ctx.strokeStyle = `rgba(255,23,68,${0.3 + Math.sin(time * 4) * 0.2})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, pulseR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Glow
        const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 2.5);
        grad.addColorStop(0, color + '40');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = isAlert ? 16 : 6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.font = '11px "Orbitron"';
        ctx.fillStyle = '#f0eaf8';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y - r - 8);

        if (isAlert) {
          ctx.font = '14px sans-serif';
          ctx.fillText('🆘', node.x, node.y + r + 16);
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, [graph, selectedAlerts, rescueResult]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title" style={{ color: '#FF1744', textShadow: '0 0 15px rgba(255,23,68,0.5)' }}>
          ⊕ RESCUE OPERATION MODE
        </h1>
        <div className="page-controls">
          <button className="btn btn-primary" onClick={computeRescue} disabled={selectedAlerts.size < 2 || isComputing}>
            {isComputing ? '⏳ Computing...' : '🚨 Compute Rescue Route'}
          </button>
          <button className="btn btn-sm" onClick={() => { setSelectedAlerts(new Set()); setRescueResult(null); }}>
            ↻ Clear
          </button>
        </div>
      </div>

      {/* Alert node selector */}
      <div style={{ marginBottom: 12 }}>
        <div className="section-header"><span className="icon">🎯</span> Select Alert / Victim Nodes</div>
        <div className="rescue-alert-nodes">
          {nodeIds.map(id => (
            <button
              key={id}
              className={`rescue-node-btn ${selectedAlerts.has(id) ? 'selected' : ''}`}
              onClick={() => toggleAlert(id)}
            >
              {selectedAlerts.has(id) ? '🆘 ' : ''}{graph.nodes.get(id)?.label}
            </button>
          ))}
        </div>
        {selectedAlerts.size < 2 && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Select at least 2 nodes to compute a rescue route.
          </p>
        )}
      </div>

      <div className="rescue-layout">
        {/* Canvas */}
        <div className="panel glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="section-header" style={{ margin: 0 }}><span className="icon">🗺</span> Rescue Map</div>
          <div ref={containerRef} style={{ flex: 1, minHeight: 400, position: 'relative', marginTop: 8 }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Rescue Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* TSP Theory */}
          <div className="panel glass-panel">
            <div className="section-header"><span className="icon">📖</span> TSP & Branch and Bound</div>
            <div className="algo-theory">
              The <strong>Traveling Salesman Problem (TSP)</strong> finds the shortest route visiting all nodes exactly once and returning to start. It is <strong>NP-Hard</strong> with complexity <code>O(N!)</code>.
              <br /><br />
              <strong>Branch & Bound</strong> optimizes by pruning branches where accumulated cost exceeds the current best solution. This dramatically reduces the search space.
              <br /><br />
              In ResQMesh, TSP computes the <strong>optimal rescue path</strong> through all victim/alert locations — minimizing response time and travel distance for rescue teams.
            </div>
            <div className="complexity-badge" style={{ marginTop: 10 }}>⏱ O(N!) worst case</div>
          </div>

          {/* Results */}
          {rescueResult && (
            <div className="panel glass-panel animate-slide-in">
              <div className="section-header"><span className="icon">📊</span> Rescue Route Analysis</div>
              <table className="data-table">
                <tbody>
                  <tr><td>Optimal Cost</td><td style={{ color: 'var(--neon-orange)' }}>{rescueResult.bestCost.toFixed(1)}</td></tr>
                  <tr><td>States Explored</td><td style={{ color: 'var(--neon-cyan)' }}>{rescueResult.statesExplored}</td></tr>
                  <tr><td>States Pruned</td><td style={{ color: 'var(--neon-green)' }}>{rescueResult.statesPruned}</td></tr>
                  <tr><td>Route</td><td style={{ color: 'var(--warm-yellow)' }}>
                    {rescueResult.bestPath?.map(id => graph.nodes.get(id)?.label).join(' → ')}
                    {rescueResult.bestPath && ` → ${graph.nodes.get(rescueResult.bestPath[0])?.label}`}
                  </td></tr>
                  <tr><td>Alert Nodes</td><td>{selectedAlerts.size}</td></tr>
                  <tr><td>Est. Response Time</td><td style={{ color: 'var(--neon-green)' }}>{(rescueResult.bestCost * 2.5).toFixed(0)} sec</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Concepts */}
          <div className="panel glass-panel">
            <div className="section-header"><span className="icon">🎓</span> Key Concepts Demonstrated</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {[
                'Hamiltonian Path / Cycle — visiting all nodes exactly once',
                'NP-Hard Complexity — no known polynomial-time solution',
                'Branch & Bound — intelligent pruning of search space',
                'Graph Distance Matrix — shortest paths between all pairs',
                'Optimization under constraints — real-world rescue planning',
              ].map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--neon-orange)' }}>◆</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
