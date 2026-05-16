import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { MeshGraph, GraphNode, createDefaultMesh } from './engine/graph';
import { SimulationEngine } from './engine/simulation';
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

  // Force re-render on simulation updates
  useEffect(() => {
    const unsub = sim.subscribe(() => setTick(t => t + 1));
    return () => unsub();
  }, [sim]);

  // Cleanup
  useEffect(() => () => sim.destroy(), [sim]);

  const isLanding = location.pathname === '/';

  const ctx = { graph, sim };

  return (
    <AppContext.Provider value={ctx}>
      {isLanding ? (
        <Landing />
      ) : (
        <div className="app-layout">
          <nav className="app-sidebar glass-panel">
            <div className="sidebar-brand" onClick={() => navigate('/')}>
              <span className="brand-icon">◈</span>
              <span className="brand-text">RQM</span>
            </div>
            <div className="sidebar-nav">
              <NavItem to="/command" icon="⬡" label="Command" />
              <NavItem to="/algorithms" icon="◇" label="Algo Lab" />
              <NavItem to="/network" icon="◎" label="Network" />
              <NavItem to="/rescue" icon="⊕" label="Rescue" />
            </div>
            <div className="sidebar-footer">
              <div className="sim-status">
                <span className={`status-dot ${sim.isRunning ? 'active' : 'paused'}`}></span>
                <span className="status-label">{sim.isRunning ? 'LIVE' : 'OFF'}</span>
              </div>
            </div>
          </nav>
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

function NavItem({ to, icon, label }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`nav-item ${isActive ? 'active' : ''}`}>
      <span className="nav-icon">{icon}</span>
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
