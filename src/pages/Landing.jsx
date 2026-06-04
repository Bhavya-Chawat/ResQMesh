import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dataSourceManager from '../services/dataSourceManager';

export default function Landing() {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [, setTick] = useState(0);

  return (
    <div className="landing-page">
      <div className="landing-scanline" />
      
      {/* Top Floating Header Cards */}
      <header className="app-header-cards" style={{ position: 'absolute', top: '20px', left: '24px', right: '24px' }}>
        {/* Logo Text (Top Left) */}
        <div className="brand-label-text" onClick={() => { navigate('/'); setIsMobileMenuOpen(false); }}>
          ResQMesh
        </div>

        {/* Central Navigation Dock (Tighter cohesive cluster) */}
        <div className="desktop-nav-cards">
          <span className="nav-card-item" onClick={() => navigate('/command')}>Command</span>
          <span className="nav-card-item" onClick={() => navigate('/algorithms')}>Algo Lab</span>
          <span className="nav-card-item" onClick={() => navigate('/network')}>Network</span>
          <span className="nav-card-item" onClick={() => navigate('/rescue')}>Rescue Map</span>
          <span className="nav-card-item" onClick={() => navigate('/reports')}>Reports</span>
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
        <div className="mobile-nav-cards-dropdown glass-panel animate-slide-in" style={{ position: 'absolute', top: '72px', right: '24px' }}>
          <span className="mobile-nav-card-link" onClick={() => { navigate('/command'); setIsMobileMenuOpen(false); }}>Command</span>
          <span className="mobile-nav-card-link" onClick={() => { navigate('/algorithms'); setIsMobileMenuOpen(false); }}>Algo Lab</span>
          <span className="mobile-nav-card-link" onClick={() => { navigate('/network'); setIsMobileMenuOpen(false); }}>Network</span>
          <span className="mobile-nav-card-link" onClick={() => { navigate('/rescue'); setIsMobileMenuOpen(false); }}>Rescue Map</span>
          <span className="mobile-nav-card-link" onClick={() => { navigate('/reports'); setIsMobileMenuOpen(false); }}>Reports</span>
          
          {/* Mobile Mode Toggle */}
          <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px', width: '100%' }}>
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

      <div className="landing-content animate-fade-in" style={{ 
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '100%', maxWidth: '1200px', padding: '0 20px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center'
      }}>
        <h1 className="landing-title" style={{ 
          fontSize: '6rem', 
          marginBottom: '32px', 
          fontWeight: '900', 
          letterSpacing: '-1.5px', 
          textTransform: 'none',
          color: 'transparent',
          filter: 'drop-shadow(0 0 25px rgba(201, 255, 0, 0.25))',
          background: 'linear-gradient(180deg, #ffffff 0%, #c9ff00 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          animation: 'none'
        }}>
          ResQMesh
        </h1>
        
        <button 
          className="btn-landing-enter" 
          onClick={() => navigate('/command')}
        >
          ENTER
        </button>
      </div>
    </div>
  );
}
