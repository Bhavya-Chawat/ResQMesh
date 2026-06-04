import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

function nPos(node, w, h, pad = 55) {
  return {
    x: pad + node.nx * (w - 2 * pad),
    y: pad + node.ny * (h - 2 * pad),
  };
}

export default function RescueMode() {
  const { graph, sim } = useApp();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedAlerts, setSelectedAlerts] = useState(new Set());
  const [rescueResult, setRescueResult] = useState(null);
  const [isComputing, setIsComputing] = useState(false);
  const [rescueStepIdx, setRescueStepIdx] = useState(-1);
  const resultsRef = useRef(null);
  const [, setTick] = useState(0);

  // Refs so canvas loop always has fresh values
  const selectedAlertsRef = useRef(selectedAlerts);
  const rescueResultRef = useRef(rescueResult);
  const toggleAlertRef = useRef(null);

  useEffect(() => { selectedAlertsRef.current = selectedAlerts; }, [selectedAlerts]);
  useEffect(() => { rescueResultRef.current = rescueResult; }, [rescueResult]);

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
  // Keep ref up to date so canvas click handler can call the latest version
  toggleAlertRef.current = toggleAlert;

  const computeRescue = useCallback(() => {
    const alerts = Array.from(selectedAlerts);
    if (alerts.length < 2) return;
    setIsComputing(true);
    sim.eventLog.add('algorithm', `RESCUE MODE: Computing optimal route for ${alerts.length} alert nodes`);

    setTimeout(() => {
      const result = graph.tspBranchAndBound(alerts);
      setRescueResult(result);
      setRescueStepIdx(result.steps.length - 1);
      setIsComputing(false);
      sim.eventLog.add('success', `Rescue route computed! Cost: ${result.bestCost.toFixed(1)}ms`);
      
      // Auto-scroll to results on mobile
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }, 800);
  }, [selectedAlerts, graph, sim]);

  // Canvas — runs ONCE on mount, reads state via refs
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

    const handleCanvasClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = canvas.width, h = canvas.height, PAD = 65;

      for (const [id, node] of graph.nodes) {
        const { x, y } = nPos(node, w, h, PAD);
        const dx = mx - x, dy = my - y;
        if (dx * dx + dy * dy < 900) {
          // Call the latest toggleAlert via ref
          toggleAlertRef.current(id);
          return;
        }
      }
    };

    canvas.addEventListener('mousedown', handleCanvasClick);

    let time = 0;
    function draw() {
      time += 0.016;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // Read fresh state from refs
      const curAlerts = selectedAlertsRef.current;
      const curResult = rescueResultRef.current;

      // ── Tactical rescue grid ──
      const GRID = 65;
      // Vertical lines (red-tinted)
      ctx.strokeStyle = 'rgba(255,23,68,0.15)';
      ctx.lineWidth = 0.8;
      for (let gx = 0; gx < w; gx += GRID) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      // Horizontal lines (orange tint)
      ctx.strokeStyle = 'rgba(255,101,63,0.12)';
      for (let gy = 0; gy < h; gy += GRID) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
      // Grid intersection markers
      ctx.fillStyle = 'rgba(255,23,68,0.28)';
      for (let gx = 0; gx < w; gx += GRID) {
        for (let gy = 0; gy < h; gy += GRID) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Corner bracket accents (red)
      const bS = 24;
      ctx.strokeStyle = 'rgba(255,23,68,0.55)';
      ctx.lineWidth = 1.5;
      [[0,0,1,1],[w,0,-1,1],[0,h,1,-1],[w,h,-1,-1]].forEach(([bx,by,sx,sy]) => {
        ctx.beginPath();
        ctx.moveTo(bx + sx*bS, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + sy*bS);
        ctx.stroke();
      });
      // Center crosshair
      ctx.strokeStyle = 'rgba(255,23,68,0.12)';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
      ctx.setLineDash([]);

      // Tactical coordinates overlays on canvas edges
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.06)';
      ctx.lineWidth = 1;
      ctx.font = '7.5px "Geist Mono", monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      for (let offset = 50; offset < w; offset += 100) {
        ctx.beginPath();
        ctx.moveTo(offset, 0); ctx.lineTo(offset, 6);
        ctx.moveTo(offset, h); ctx.lineTo(offset, h - 6);
        ctx.stroke();
        ctx.fillText(`LNG ${(120.984 + offset / 1200).toFixed(4)}`, offset - 20, 14);
      }
      for (let offset = 50; offset < h; offset += 100) {
        ctx.beginPath();
        ctx.moveTo(0, offset); ctx.lineTo(6, offset);
        ctx.moveTo(w, offset); ctx.lineTo(w - 6, offset);
        ctx.stroke();
        ctx.fillText(`LAT ${(14.599 + offset / 1200).toFixed(4)}`, 9, offset + 3);
      }

      const PAD = 65;
      
      // Draw standard links
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        const sp = nPos(src, w, h, PAD);
        const tp = nPos(tgt, w, h, PAD);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();

        ctx.font = 'bold 10px "Geist Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'center';
        ctx.fillText(`${edge.weight.toFixed(0)}m`, (sp.x + tp.x) / 2, (sp.y + tp.y) / 2 - 4);
      }

      // Draw active rescue path
      if (curResult?.bestPath && curResult.bestPath.length > 1) {
        const path = curResult.bestPath;
        const dashOffset = time * 35;
        ctx.setLineDash([10, 6]);
        ctx.lineDashOffset = -dashOffset;
        ctx.strokeStyle = '#FF653F';
        ctx.lineWidth = 4.5;
        ctx.shadowColor = '#FF653F';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const n = graph.nodes.get(path[i]);
          if (!n) continue;
          const p = nPos(n, w, h, PAD);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        const first = graph.nodes.get(path[0]);
        if (first) { const fp = nPos(first, w, h, PAD); ctx.lineTo(fp.x, fp.y); }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Animated rescue vehicle
        const totalSegs = path.length;
        const vehicleProgress = (time * 0.12) % 1;
        const segFloat = vehicleProgress * totalSegs;
        const seg = Math.floor(segFloat) % totalSegs;
        const segT = segFloat - Math.floor(segFloat);
        const sn = graph.nodes.get(path[seg]);
        const en = graph.nodes.get(path[(seg + 1) % path.length]);
        if (sn && en) {
          const sp2 = nPos(sn, w, h, PAD);
          const ep2 = nPos(en, w, h, PAD);
          const vx = sp2.x + (ep2.x - sp2.x) * segT;
          const vy = sp2.y + (ep2.y - sp2.y) * segT;
          const vGrad = ctx.createRadialGradient(vx, vy, 0, vx, vy, 25);
          vGrad.addColorStop(0, 'rgba(255,101,63,0.5)');
          vGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = vGrad;
          ctx.beginPath(); ctx.arc(vx, vy, 25, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#FF653F'; ctx.shadowColor = '#FF653F'; ctx.shadowBlur = 16;
          ctx.beginPath(); ctx.arc(vx, vy, 9, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = 'bold 11px "Geist Mono", monospace';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText('R', vx, vy + 4);
        }

        // Draw node indices along the path
        for (let i = 0; i < path.length; i++) {
          const n = graph.nodes.get(path[i]);
          if (!n) continue;
          const p = nPos(n, w, h, PAD);
          ctx.font = 'bold 11px "Geist Mono", monospace';
          ctx.fillStyle = '#FF653F';
          ctx.textAlign = 'center';
          ctx.fillText(`#${i + 1}`, p.x + 16, p.y - 16);
        }
      }

      // Draw Nodes — using refs for fresh alert state
      for (const [id, node] of graph.nodes) {
        const isAlert = curAlerts.has(id);
        const { x, y } = nPos(node, w, h, PAD);
        node.x = x; node.y = y;
        
        const color = isAlert ? '#FF1744' : '#448AFF';

        // Pulse sonar rings around active alert nodes
        if (isAlert) {
          const pulseR = 18 + (time * 16) % 24;
          const pulseOpacity = 1 - ((time * 16) % 24) / 24;
          ctx.strokeStyle = `rgba(255, 23, 68, ${pulseOpacity})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, pulseR, 0, Math.PI * 2);
          ctx.stroke();
        }

        const r = isAlert ? 18 : 12;

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = isAlert ? 18 : 6;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        ctx.font = 'bold 11px "Geist Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, x, y - r - 8);

        if (isAlert) {
          ctx.font = 'bold 9px "Geist Mono", monospace';
          ctx.fillStyle = '#FF1744';
          ctx.fillText('DISASTER AREA', x, y + r + 12);
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => { 
      cancelAnimationFrame(animId); 
      ro.disconnect(); 
      canvas.removeEventListener('mousedown', handleCanvasClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]); // Run once — state accessed via refs

  return (
    <div className="page-container animate-fade-in" style={{ padding: '24px 40px', width: '100%', boxSizing: 'border-box' }}>
      <div className="page-header" style={{ marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
        <h2 className="page-title" style={{ fontSize: '1.7rem', fontWeight: '800', letterSpacing: '-0.5px', textTransform: 'none' }}>Rescue Operation Command</h2>
        <div className="page-controls" style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" style={{ padding: '8px 20px', fontSize: '0.78rem' }} onClick={computeRescue} disabled={selectedAlerts.size < 2 || isComputing}>
            {isComputing ? 'Computing Route...' : 'Compute Rescue Route'}
          </button>
          <button className="btn btn-sm" style={{ padding: '8px 20px', borderColor: 'rgba(255,255,255,0.1)', fontSize: '0.78rem' }} onClick={() => { setSelectedAlerts(new Set()); setRescueResult(null); }}>
            Clear Selection
          </button>
        </div>
      </div>

      {/* Alert node selector */}
      <div style={{ marginBottom: 20 }}>
        <div className="section-header" style={{ marginBottom: '8px' }}>Active Emergency Locations / Victim Nodes</div>
        <div className="rescue-alert-nodes" style={{ gap: '10px', marginBottom: '8px' }}>
          {nodeIds.map(id => {
            const isAlert = selectedAlerts.has(id);
            return (
              <button
                key={id}
                className={`rescue-node-btn ${isAlert ? 'selected' : ''}`}
                onClick={() => toggleAlert(id)}
                style={{
                  padding: '10px 18px',
                  fontSize: '0.8rem',
                  borderRadius: '24px',
                  fontWeight: '600',
                  border: isAlert ? '1px solid var(--neon-red)' : '1px solid var(--border-subtle)',
                  background: isAlert ? 'rgba(255,23,68,0.2)' : 'rgba(10,6,24,0.4)',
                  color: isAlert ? 'var(--neon-red)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: isAlert ? '0 0 10px rgba(255,23,68,0.3)' : 'none'
                }}
              >
                {isAlert ? '🚨 NODE ' : 'NODE '}{graph.nodes.get(id)?.label}
              </button>
            );
          })}
        </div>
        {selectedAlerts.size < 2 && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Select 2 or more emergency nodes directly on the interactive map or from the options above.
          </p>
        )}
      </div>

      <div className="rescue-layout" style={{ gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
        {/* Map Canvas - Enlarge map to be primary hero */}
        <div className="panel glass-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: '700px', padding: '20px', marginBottom: 0 }}>
          <div className="section-header" style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Tactical Response Live Map</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--neon-red)', fontFamily: 'var(--font-mono)', animation: 'pulse 2s infinite' }}>
              ● DISASTER MODE ACTIVE
            </span>
          </div>
          <div ref={containerRef} style={{ flex: 1, position: 'relative', marginTop: 12, background: 'rgba(5, 2, 15, 0.45)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.03)' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        </div>

        {/* Rescue Info */}
        <div className="rescue-info-column" style={{ gap: '16px' }}>
          {/* TSP Results Display as Large KPIs */}
          {rescueResult && (
            <div className="panel glass-panel animate-slide-in" ref={resultsRef} style={{ padding: '20px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <div className="section-header" style={{ marginBottom: '16px' }}>Optimal Mission Calculations</div>
              
              {/* Massive KPIs */}
              <div className="stat-strip" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '18px' }}>
                <div className="stat-card glass-panel" style={{ padding: '16px', borderLeft: '4px solid var(--nash-chartreuse)' }}>
                  <div className="stat-label" style={{ fontSize: '0.75rem' }}>Optimal Route Cost</div>
                  <div className="stat-value green" style={{ fontSize: '2.4rem', fontWeight: '900' }}>
                    {rescueResult.bestCost.toFixed(1)}<span style={{ fontSize: '1rem', fontWeight: '500' }}> ms</span>
                  </div>
                </div>
                <div className="stat-card glass-panel" style={{ padding: '16px', borderLeft: '4px solid var(--neon-cyan)' }}>
                  <div className="stat-label" style={{ fontSize: '0.75rem' }}>Est. Mission Time</div>
                  <div className="stat-value cyan" style={{ fontSize: '2.4rem', fontWeight: '900' }}>
                    {(rescueResult.bestCost * 2.5).toFixed(0)}<span style={{ fontSize: '1rem', fontWeight: '500' }}> s</span>
                  </div>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <table className="data-table" style={{ marginBottom: '12px' }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 'bold' }}>Alert Nodes Count</td>
                      <td style={{ padding: '12px 10px', textAlign: 'right', color: 'var(--neon-red)' }}>{selectedAlerts.size}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 'bold' }}>Search States Explored</td>
                      <td style={{ padding: '12px 10px', textAlign: 'right', color: 'var(--warm-yellow)' }}>{rescueResult.statesExplored}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 'bold' }}>Pruned Search Branches</td>
                      <td style={{ padding: '12px 10px', textAlign: 'right', color: 'var(--neon-cyan)' }}>{rescueResult.statesPruned}</td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ padding: '12px 14px', background: 'rgba(255,101,63,0.08)', borderRadius: '6px', border: '1px solid rgba(255,101,63,0.2)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#FF653F', fontWeight: 'bold', marginBottom: '4px', letterSpacing: 0.5 }}>
                    COMPUTED MISSION PATH TRACE
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: '#ffffff', fontWeight: 'bold' }}>
                    {rescueResult.bestPath?.map(id => graph.nodes.get(id)?.label).join(' ➔ ')}
                    {rescueResult.bestPath && ` ➔ ${graph.nodes.get(rescueResult.bestPath[0])?.label}`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TSP Theory */}
          <div className="panel glass-panel" style={{ padding: '20px', marginBottom: 0 }}>
            <div className="section-header" style={{ marginBottom: '8px' }}>Disaster Pathfinding Optimization</div>
            <div className="algo-theory" style={{ lineHeight: '1.6', fontSize: '0.85rem' }}>
              The <strong>Traveling Salesman Problem (TSP)</strong> calculates the shortest Hamilton cycle visiting all locations exactly once. It is <strong>NP-Hard</strong> with computational complexity <code style={{ background: 'rgba(255,23,68,0.1)', padding: '2px 6px', borderRadius: '4px', color: 'var(--neon-red)' }}>O(N!)</code>.
              <br /><br />
              <strong>Branch & Bound</strong> uses an intelligent search tree structure to prune sub-optimal paths early if their lower bound cost exceeds the current best path. This permits real-time optimal rescue planning.
            </div>
            <div className="complexity-badge" style={{ marginTop: 14, fontSize: '0.75rem' }}>Worst Case: O(N!) | Optimized Branch & Bound</div>
          </div>

          {/* Concepts */}
          <div className="panel glass-panel" style={{ padding: '20px', marginBottom: 0 }}>
            <div className="section-header" style={{ marginBottom: '10px' }}>Mission Response Guidelines</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {[
                'Hamiltonian Route Cycle — Ensures rescue teams visit every target exactly once.',
                'NP-Hard Search Space — Intelligent pruning saves compute power for field hardware.',
                'Disaster Zone Node Selection — Click nodes directly to trigger local SOS flooding.',
                'Self-healing Mesh Recalculation — Computes alternative routes if link RSSI values drop.',
              ].map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.4 }}>
                  <span style={{ color: 'var(--nash-chartreuse)', fontSize: '1rem', marginTop: -2 }}>◆</span>
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
