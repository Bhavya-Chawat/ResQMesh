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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

  const isLanding = location.pathname === '/';

  const ctx = { graph, sim, dataSourceManager };

  return (
    <AppContext.Provider value={ctx}>
      {isLanding ? (
        <Landing />
      ) : (
        <div className={`app-layout ${isSidebarOpen ? 'sidebar-open' : ''}`}>
          <header className="mobile-header glass-panel">
            <button className="menu-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
              <span className="bar"></span>
              <span className="bar"></span>
              <span className="bar"></span>
            </button>
            <div className="mobile-brand" onClick={() => navigate('/')}>
              <span style={{ color: 'var(--neon-orange)' }}>ResQ</span>Mesh
            </div>
          </header>

          <nav className={`app-sidebar glass-panel ${isSidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-brand" onClick={() => { navigate('/'); setIsSidebarOpen(false); }}>
              <span className="brand-logo-res">ResQ</span>
              <span className="brand-logo-text">Mesh</span>
            </div>
            <div className="sidebar-nav">
              <NavItem to="/command" label="Command" onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/algorithms" label="Algo Lab" onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/network" label="Network" onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/rescue" label="Rescue" onClick={() => setIsSidebarOpen(false)} />
            </div>
            <div className="sidebar-footer">
              <div className="sim-status">
                <span className={`status-dot ${sim.isRunning ? 'active' : 'paused'}`}></span>
                <span className="status-label">{sim.isRunning ? 'LIVE' : 'OFF'}</span>
              </div>
              <div
                className="sim-status"
                style={{ marginTop: 6, cursor: 'pointer', opacity: 0.8 }}
                onClick={() => dataSourceManager.toggle()}
                title="Click to toggle Simulation / Hardware mode"
              >
                <span className={`status-dot ${dataSourceManager.isHardware ? 'active' : 'paused'}`}
                  style={{ background: dataSourceManager.isHardware ? 'var(--neon-green)' : 'var(--neon-orange)' }}
                />
                <span className="status-label" style={{ fontSize: '0.6rem' }}>
                  {dataSourceManager.isHardware
                    ? (dataSourceManager.connectionStatus === 'connected' ? 'HW:LIVE' : 'HW:...')
                    : 'SIM'}
                </span>
              </div>
            </div>
          </nav>
          <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
          <main className="app-main">
            <Routes>
              <Route path="/command" element={<CommandCenter />} />
              <Route path="/algorithms" element={<AlgorithmLab />} />
              <Route path="/network" element={<NetworkCenter />} />
              <Route path="/rescue" element={<RescueMode />} />
            </Routes>
          </main>
        </div>
      )}
    </AppContext.Provider>
  );
}

function NavItem({ to, label, onClick }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`nav-item ${isActive ? 'active' : ''}`} onClick={onClick}>
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
