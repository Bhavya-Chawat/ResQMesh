import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { MeshGraph, GraphNode, createDefaultMesh } from './engine/graph';
import { SimulationEngine } from './engine/simulation';
import dataSourceManager from './services/dataSourceManager';
import Landing from './pages/Landing';
import CommandCenter from './pages/CommandCenter';
import AlgorithmLab from './pages/AlgorithmLab';
import NetworkCenter from './pages/NetworkCenter';
import RescueMode from './pages/RescueMode';
import Reports from './pages/Reports';
import './App.css';

// Global context for graph and simulation
export const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [graph] = useState(() => createDefaultMesh());
  const [sim] = useState(() => new SimulationEngine(graph));
  const [, setTick] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [theme] = useState('dark');
  const bgCanvasRef = useRef(null);

  // Force re-render on simulation updates
  useEffect(() => {
    const unsub = sim.subscribe(() => setTick(t => t + 1));
    return () => unsub();
  }, [sim]);

  // Init data source manager — bridges hardware WebSocket ↔ existing graph/sim
  useEffect(() => {
    dataSourceManager.init(graph, sim, () => setTick(t => t + 1));
    return () => dataSourceManager.destroy();
  }, [graph, sim]);

  // Cleanup sim on unmount
  useEffect(() => () => sim.destroy(), [sim]);

  // Global background canvas animation loop
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let nodes = [];
    let packets = [];
    let traces = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Regenerate circuit traces spread across full canvas
      traces = [];
      for (let i = 0; i < 30; i++) {
        const isH = Math.random() > 0.5;
        traces.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          len: 60 + Math.random() * 140,
          isH,
          color: ['#c9ff00', '#00E5FF', '#c9ff00', '#448AFF'][Math.floor(Math.random() * 4)],
          baseAlpha: 0.15 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2,
          speed: 0.008 + Math.random() * 0.015,
        });
      }
    }
    resize();
    window.addEventListener('resize', resize);

    // Floating mesh nodes — 60 nodes, clearly visible
    for (let i = 0; i < 60; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: 2 + Math.random() * 3,
        pulse: Math.random() * Math.PI * 2,
        color: ['#c9ff00', '#c9ff00', '#00E5FF', '#ffffff'][Math.floor(Math.random() * 4)],
      });
    }

    function spawnPacket() {
      if (nodes.length < 2) return;
      const a = Math.floor(Math.random() * nodes.length);
      let b = a;
      while (b === a) b = Math.floor(Math.random() * nodes.length);
      const colors = ['#c9ff00', '#00E5FF', '#c9ff00'];
      packets.push({
        sx: nodes[a].x, sy: nodes[a].y,
        ex: nodes[b].x, ey: nodes[b].y,
        t: 0,
        speed: 0.006 + Math.random() * 0.008,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    let time = 0;
    function draw() {
      time += 0.016;
      const W = canvas.width, H = canvas.height;

      // Fill with dark base so elements render on solid background
      ctx.fillStyle = '#010718';
      ctx.fillRect(0, 0, W, H);

      // ── 1. GRID LINES ── (high opacity so they're actually visible)
      const GRID = 80;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(201,255,0,0.30)';
      for (let x = 0; x <= W; x += GRID) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,229,255,0.20)';
      for (let y = 0; y <= H; y += GRID) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // Glowing intersection dots
      ctx.fillStyle = 'rgba(201,255,0,0.55)';
      for (let x = 0; x <= W; x += GRID) {
        for (let y = 0; y <= H; y += GRID) {
          ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }

      // ── 2. CORNER BRACKETS ──
      const bS = 48;
      ctx.strokeStyle = '#c9ff00';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#c9ff00'; ctx.shadowBlur = 8;
      [[0,0,1,1],[W,0,-1,1],[0,H,1,-1],[W,H,-1,-1]].forEach(([bx,by,sx,sy]) => {
        ctx.beginPath();
        ctx.moveTo(bx + sx*bS, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + sy*bS);
        ctx.stroke();
      });
      ctx.shadowBlur = 0;

      // ── 3. NEBULA GLOWS ──
      [
        { x: W*0.15, y: H*0.25, r: 220, c: 'rgba(201,255,0,0.12)' },
        { x: W*0.88, y: H*0.70, r: 260, c: 'rgba(0,229,255,0.10)' },
        { x: W*0.50, y: H*0.50, r: 280, c: 'rgba(201,255,0,0.06)' },
        { x: W*0.75, y: H*0.18, r: 170, c: 'rgba(68,138,255,0.12)' },
        { x: W*0.22, y: H*0.82, r: 190, c: 'rgba(0,229,255,0.10)' },
        { x: W*0.92, y: H*0.35, r: 140, c: 'rgba(201,255,0,0.08)' },
      ].forEach(s => {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        g.addColorStop(0, s.c); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      });

      // ── 4. CIRCUIT TRACES — pulsing with glow ──
      for (const tr of traces) {
        tr.phase += tr.speed;
        const a = tr.baseAlpha * (0.5 + 0.5 * Math.sin(tr.phase));
        const hex = Math.round(Math.min(1, a) * 255).toString(16).padStart(2, '0');
        ctx.strokeStyle = tr.color + hex;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = tr.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        if (tr.isH) {
          ctx.moveTo(tr.x, tr.y); ctx.lineTo(tr.x + tr.len, tr.y);
          ctx.moveTo(tr.x + tr.len, tr.y); ctx.lineTo(tr.x + tr.len, tr.y + 14);
        } else {
          ctx.moveTo(tr.x, tr.y); ctx.lineTo(tr.x, tr.y + tr.len);
          ctx.moveTo(tr.x, tr.y + tr.len); ctx.lineTo(tr.x + 14, tr.y + tr.len);
        }
        ctx.stroke();
        // Bright end-cap dot
        ctx.fillStyle = tr.color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(tr.isH ? tr.x + tr.len : tr.x, tr.isH ? tr.y : tr.y + tr.len, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── 5. NODE CONNECTIONS ──
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 200) {
            const alpha = (1 - dist / 200) * 0.45;
            ctx.strokeStyle = `rgba(201,255,0,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // ── 6. FLOATING NODES — bright with halos ──
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
        n.pulse += 0.022;
        const scale = 1 + Math.sin(n.pulse) * 0.4;
        const r = n.r * scale;
        // Wide outer halo
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 6);
        g.addColorStop(0, n.color + '40'); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 6, 0, Math.PI * 2); ctx.fill();
        // Bright core with glow
        ctx.fillStyle = n.color;
        ctx.shadowColor = n.color; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── 7. DATA PACKETS ──
      if (Math.random() < 0.06) spawnPacket();
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.t += p.speed;
        if (p.t > 1) { packets.splice(i, 1); continue; }
        const px = p.sx + (p.ex - p.sx) * p.t;
        const py = p.sy + (p.ey - p.sy) * p.t;
        const tailT = Math.max(0, p.t - 0.15);
        const tx = p.sx + (p.ex - p.sx) * tailT;
        const ty = p.sy + (p.ey - p.sy) * tailT;
        const tailG = ctx.createLinearGradient(tx, ty, px, py);
        tailG.addColorStop(0, 'transparent');
        tailG.addColorStop(1, p.color + 'AA');
        ctx.strokeStyle = tailG; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, py); ctx.stroke();
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── 8. RADAR RINGS + SWEEP ──
      const cx = W / 2, cy = H / 2;
      const angle = time * 0.28;
      const maxR = Math.min(W, H) * 0.44;
      [1.0, 0.68, 0.42].forEach((frac, i) => {
        const rr = maxR * frac;
        ctx.strokeStyle = `rgba(201,255,0,${0.18 - i * 0.04})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        for (let t = 0; t < Math.PI * 2; t += Math.PI / 8) {
          const ox = cx + Math.cos(t)*rr, oy = cy + Math.sin(t)*rr;
          const ix = cx + Math.cos(t)*(rr-8), iy = cy + Math.sin(t)*(rr-8);
          ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ix, iy); ctx.stroke();
        }
      });
      // Sweep arm — bright with glow
      ctx.strokeStyle = 'rgba(201,255,0,0.7)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#c9ff00'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle)*maxR, cy + Math.sin(angle)*maxR);
      ctx.stroke(); ctx.shadowBlur = 0;
      // Trailing arc
      ctx.strokeStyle = 'rgba(201,255,0,0.12)';
      ctx.lineWidth = 18;
      ctx.beginPath(); ctx.arc(cx, cy, maxR * 0.55, angle - 0.8, angle); ctx.stroke();

      // ── 9. CENTER ORB ──
      const orb = 0.5 + 0.5 * Math.sin(time * 1.4);
      const orbG = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60 + orb*20);
      orbG.addColorStop(0, `rgba(201,255,0,${0.28*orb})`);
      orbG.addColorStop(1, 'transparent');
      ctx.fillStyle = orbG;
      ctx.beginPath(); ctx.arc(cx, cy, 80, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9ff00';
      ctx.shadowColor = '#c9ff00'; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Crosshair
      ctx.strokeStyle = 'rgba(201,255,0,0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 12]);
      ctx.beginPath(); ctx.moveTo(cx-maxR, cy); ctx.lineTo(cx+maxR, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy-maxR); ctx.lineTo(cx, cy+maxR); ctx.stroke();
      ctx.setLineDash([]);

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);



  const isLanding = location.pathname === '/';

  const ctx = { graph, sim, dataSourceManager, theme };

  return (
    <AppContext.Provider value={ctx}>
      {/* Global Dynamic Canvas Background */}
      <canvas ref={bgCanvasRef} className="global-bg-canvas" />
      <div className="global-grid-overlay" />
      
      {isLanding ? (
        <Landing />
      ) : (
        <div className="app-layout">
          <header className="app-header-cards">
            {/* Logo Text (Top Left) */}
            <div className="brand-label-text" onClick={() => { navigate('/'); setIsMobileMenuOpen(false); }}>
              ResQMesh
            </div>

            {/* Central Navigation Dock (Tighter cohesive cluster) */}
            <div className="desktop-nav-cards">
              <NavItemCard to="/command" label="Command" />
              <NavItemCard to="/algorithms" label="Algo Lab" />
              <NavItemCard to="/network" label="Network" />
              <NavItemCard to="/rescue" label="Rescue Map" />
              <NavItemCard to="/reports" label="Reports" />
            </div>

            {/* Right Group (Toggle Card & Mobile Menu Toggle) */}
            <div className="header-cards-right">
              {/* Toggle Card */}
              <div className="header-card mode-toggle-card glass-panel">
                <div 
                  className={`segmented-control ${dataSourceManager.isHardware ? 'hardware-active' : ''}`}
                  onClick={() => {
                    dataSourceManager.toggle();
                    setTick(t => t + 1);
                  }}
                  title="Toggle Simulation / Hardware mode"
                >
                  <div className="segmented-slider"></div>
                  <div className={`segmented-option ${!dataSourceManager.isHardware ? 'active' : ''}`}>
                    Simulation
                  </div>
                  <div className={`segmented-option ${dataSourceManager.isHardware ? 'active' : ''}`}>
                    Hardware
                  </div>
                </div>
              </div>

              {/* Mobile Menu Toggle Card */}
              <button 
                className="header-card mobile-menu-toggle-card glass-panel"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              >
                <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                  {isMobileMenuOpen ? 'CLOSE' : 'MENU'}
                </span>
              </button>
            </div>
          </header>

          {/* Mobile Dropdown Navigation Panel */}
          {isMobileMenuOpen && (
            <div className="mobile-nav-cards-dropdown glass-panel animate-slide-in">
              <Link to="/command" className={`mobile-nav-card-link ${location.pathname === '/command' ? 'active' : ''}`} onClick={() => setIsMobileMenuOpen(false)}>Command</Link>
              <Link to="/algorithms" className={`mobile-nav-card-link ${location.pathname === '/algorithms' ? 'active' : ''}`} onClick={() => setIsMobileMenuOpen(false)}>Algo Lab</Link>
              <Link to="/network" className={`mobile-nav-card-link ${location.pathname === '/network' ? 'active' : ''}`} onClick={() => setIsMobileMenuOpen(false)}>Network</Link>
              <Link to="/rescue" className={`mobile-nav-card-link ${location.pathname === '/rescue' ? 'active' : ''}`} onClick={() => setIsMobileMenuOpen(false)}>Rescue Map</Link>
              <Link to="/reports" className={`mobile-nav-card-link ${location.pathname === '/reports' ? 'active' : ''}`} onClick={() => setIsMobileMenuOpen(false)}>Reports</Link>
              
              {/* Mobile Mode Toggle */}
              <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px' }}>
                <div 
                  className={`segmented-control ${dataSourceManager.isHardware ? 'hardware-active' : ''}`}
                  onClick={() => {
                    dataSourceManager.toggle();
                    setTick(t => t + 1);
                  }}
                  style={{ width: '100%' }}
                >
                  <div className="segmented-slider"></div>
                  <div className={`segmented-option ${!dataSourceManager.isHardware ? 'active' : ''}`}>
                    Simulation
                  </div>
                  <div className={`segmented-option ${dataSourceManager.isHardware ? 'active' : ''}`}>
                    Hardware
                  </div>
                </div>
              </div>
            </div>
          )}

          <main className="app-main">
            <Routes>
                <Route path="/command" element={<CommandCenter />} />
                <Route path="/algorithms" element={<AlgorithmLab />} />
                <Route path="/network" element={<NetworkCenter />} />
                <Route path="/rescue" element={<RescueMode />} />
                <Route path="/reports" element={<Reports />} />
            </Routes>
          </main>
        </div>
      )}
    </AppContext.Provider>
  );
}

function NavItemCard({ to, label, onClick }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`nav-card-item ${isActive ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-label">{label}</span>
    </Link>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </HashRouter>
  );
}
