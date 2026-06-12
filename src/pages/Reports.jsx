import { useState, useEffect } from 'react';
import { useApp } from '../App';
import dataSourceManager from '../services/dataSourceManager';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export default function Reports() {
  const { graph } = useApp();
  const [selectedNode, setSelectedNode] = useState('all');
  const [limit, setLimit] = useState(100);
  const [history, setHistory] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isHardwareMode = dataSourceManager.isHardware;

  // Fetch report data
  const generateReport = async () => {
    if (!isHardwareMode) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch history logs
      const historyUrl = `${BACKEND_URL}/api/reports/history?node_id=${selectedNode}&limit=${limit}`;
      const historyRes = await fetch(historyUrl);
      if (!historyRes.ok) throw new Error('Failed to fetch historical telemetry logs');
      const historyData = await historyRes.json();
      setHistory(historyData);

      // 2. Fetch analytics summary
      const analyticsUrl = `${BACKEND_URL}/api/reports/analytics`;
      const analyticsRes = await fetch(analyticsUrl);
      if (!analyticsRes.ok) throw new Error('Failed to fetch analytics summary');
      const analyticsData = await analyticsRes.json();
      setAnalytics(analyticsData);
    } catch (err) {
      console.error(err);
      setError(err.message || 'An error occurred while generating the report.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch automatically on mount if in Hardware mode
  useEffect(() => {
    if (isHardwareMode) {
      generateReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHardwareMode, selectedNode]);

  // Export data array to CSV file download
  const handleExportCSV = () => {
    if (!history || history.length === 0) return;
    
    const headers = ['Record ID', 'Timestamp', 'Node ID', 'Temperature (°C)', 'Humidity (%)', 'Gas Level (ppm)'];
    const rows = history.map(r => [
      r.id,
      r.timestamp,
      r.node_id,
      r.temperature !== null ? r.temperature : 'N/A',
      r.humidity !== null ? r.humidity : 'N/A',
      r.gas_level !== null ? r.gas_level : 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(e => e.map(val => `"${val}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `resqmesh_telemetry_report_${selectedNode}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Trigger PDF print dialog
  const handleExportPDF = () => {
    window.print();
  };

  // Gather active analytics for display card based on selection
  const getActiveAnalytics = () => {
    if (selectedNode !== 'all') {
      return analytics[selectedNode] || null;
    }
    
    // Average overall nodes
    const keys = Object.keys(analytics);
    if (keys.length === 0) return null;
    
    let totalTemp = 0, totalHum = 0, totalGas = 0, totalAnomalies = 0, maxGas = 0;
    keys.forEach(k => {
      totalTemp += analytics[k].avg_temp;
      totalHum += analytics[k].avg_hum;
      totalGas += analytics[k].avg_gas;
      totalAnomalies += analytics[k].anomalies_detected;
      if (analytics[k].peak_gas > maxGas) maxGas = analytics[k].peak_gas;
    });

    return {
      avg_temp: (totalTemp / keys.length).toFixed(1),
      avg_hum: (totalHum / keys.length).toFixed(1),
      avg_gas: (totalGas / keys.length).toFixed(1),
      peak_gas: maxGas.toFixed(1),
      anomalies_detected: totalAnomalies
    };
  };

  const activeStats = getActiveAnalytics();
  const nodeOptions = ['A', 'B', 'C', 'D', 'E']; // Node list helper

  if (!isHardwareMode) {
    return (
      <div className="page-container animate-fade-in" style={{ padding: '24px 40px', width: '100%', boxSizing: 'border-box' }}>
        <div className="page-header" style={{ marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 className="page-title" style={{ fontSize: '2.2rem', fontWeight: '850', letterSpacing: '-0.5px', textTransform: 'none' }}>Mission Reports & Analytics</h2>
        </div>

        <div className="reports-locked-container glass-panel" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '60px 40px', margin: '40px auto', maxWidth: '600px', textAlign: 'center',
          borderRadius: '12px', border: '1px solid rgba(255, 23, 68, 0.2)',
          boxShadow: '0 8px 32px rgba(255, 23, 68, 0.05)'
        }}>
          <div className="locked-icon" style={{ fontSize: '3rem', marginBottom: '20px' }}>🔒</div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '12px', fontFamily: 'var(--font-display)' }}>
            Hardware Telemetry Logs Locked
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '16px' }}>
            Database history logging, trend analytics, and report downloads (CSV/PDF) are active in <strong>Hardware Mode</strong> only.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.5', padding: '10px 20px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
            To begin logging real hardware sensor values and running analytical reports, toggle the mode switch in the header from <strong>SIM</strong> to <strong>HW</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in reports-page-layout" style={{ padding: '24px 40px', width: '100%', boxSizing: 'border-box' }}>
      {/* Title block hides during standard browser printing */}
      <div className="page-header no-print" style={{ marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="page-title" style={{ fontSize: '2.2rem', fontWeight: '850', letterSpacing: '-0.5px', textTransform: 'none' }}>Mission Reports & Analytics</h2>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          DB Source: <strong style={{ color: 'var(--nash-chartreuse)' }}>SUPABASE CLOUD</strong>
        </div>
      </div>

      {/* Printable Report Header (Only visible on paper / PDF printout) */}
      <div className="print-only-header">
        <h1>ResQMesh Mission Telemetry Report</h1>
        <p>Generated on: {new Date().toLocaleString()}</p>
        <p>Source Node Filter: {selectedNode === 'all' ? 'All Active Mesh Nodes' : `Node ${selectedNode}`}</p>
        <hr />
      </div>

      <div className="reports-grid">
        
        {/* Left Column: Report Controls & Analytics Summary */}
        <div className="reports-left-col no-print">
          <div className="panel glass-panel reports-control-card" style={{ padding: '20px', marginBottom: '20px' }}>
            <h3 className="section-title" style={{ fontSize: '1.05rem', fontWeight: 'bold', marginBottom: '16px', color: '#ffffff' }}>Report Options</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px', fontFamily: 'var(--font-mono)' }}>NODE FILTER</label>
                <select
                  value={selectedNode}
                  onChange={e => setSelectedNode(e.target.value)}
                  style={{
                    width: '100%', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: 'rgba(10,6,24,0.6)',
                    color: 'var(--neon-cyan)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '8px 12px',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">All Active Nodes</option>
                  {nodeOptions.map(opt => (
                    <option key={opt} value={opt}>Node {opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px', fontFamily: 'var(--font-mono)' }}>LOG LIMIT</label>
                <select
                  value={limit}
                  onChange={e => setLimit(Number(e.target.value))}
                  style={{
                    width: '100%', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: 'rgba(10,6,24,0.6)',
                    color: 'var(--neon-cyan)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '8px 12px',
                    cursor: 'pointer'
                  }}
                >
                  <option value={50}>Last 50 Entries</option>
                  <option value={100}>Last 100 Entries</option>
                  <option value={250}>Last 250 Entries</option>
                  <option value={500}>Last 500 Entries</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button 
                  className="btn btn-primary" 
                  style={{ flex: 1, padding: '12px', fontSize: '0.8rem' }}
                  onClick={generateReport}
                  disabled={loading}
                >
                  {loading ? 'GENERATING...' : 'GENERATE REPORT'}
                </button>
              </div>
            </div>
          </div>

          {/* Quick Analytics Summary Panel */}
          {activeStats && (
            <div className="panel glass-panel reports-stats-card" style={{ padding: '20px' }}>
              <h3 className="section-title" style={{ fontSize: '1.05rem', fontWeight: 'bold', marginBottom: '16px', color: '#ffffff' }}>Analytics Summary</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>AVG TEMP</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '750', color: 'var(--text-primary)', marginTop: '4px' }}>{activeStats.avg_temp}°C</div>
                </div>

                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>AVG HUMIDITY</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '750', color: 'var(--text-primary)', marginTop: '4px' }}>{activeStats.avg_hum}%</div>
                </div>

                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>AVG GAS LEVEL</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '750', color: 'var(--text-primary)', marginTop: '4px' }}>{activeStats.avg_gas} ppm</div>
                </div>

                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>PEAK GAS</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '750', color: activeStats.peak_gas > 250 ? 'var(--neon-red)' : 'var(--text-primary)', marginTop: '4px' }}>{activeStats.peak_gas} ppm</div>
                </div>
              </div>

              <div style={{ marginTop: '16px', padding: '12px', background: activeStats.anomalies_detected > 0 ? 'rgba(255,23,68,0.08)' : 'rgba(57,255,20,0.05)', borderRadius: '6px', border: activeStats.anomalies_detected > 0 ? '1px solid rgba(255,23,68,0.2)' : '1px solid rgba(57,255,20,0.15)', display: 'flex', alignItems: 'center', justifyBetween: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Threshold Anomalies</div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '2px' }}>High Temp (&gt;45°C) or Gas (&gt;250 ppm)</div>
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: '900', color: activeStats.anomalies_detected > 0 ? 'var(--neon-red)' : '#39FF14', marginLeft: 'auto' }}>
                  {activeStats.anomalies_detected}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Telemetry Log Table */}
        <div className="reports-right-col">
          <div className="panel glass-panel reports-table-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: '520px' }}>
            <div className="reports-table-header no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 className="section-title" style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#ffffff' }}>Sensor History Logs</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className="btn btn-sm" 
                  style={{ borderColor: 'rgba(255,255,255,0.1)', fontSize: '0.7rem' }}
                  onClick={handleExportCSV}
                  disabled={history.length === 0}
                >
                  📥 EXPORT CSV
                </button>
                <button 
                  className="btn btn-sm btn-primary" 
                  style={{ fontSize: '0.7rem' }}
                  onClick={handleExportPDF}
                  disabled={history.length === 0}
                >
                  🖨️ EXPORT PDF
                </button>
              </div>
            </div>

            {error && (
              <div style={{ padding: '12px', background: 'rgba(255,23,68,0.1)', border: '1px solid var(--neon-red)', borderRadius: '6px', color: 'var(--neon-red)', fontSize: '0.8rem', marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {/* Scrollable table container */}
            <div className="reports-table-wrap" style={{ flex: 1, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', background: 'rgba(5,2,15,0.45)' }}>
              {history.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {loading ? 'Retrieving database logs...' : 'No telemetry logs found. Generate a report or trigger telemetry events on your nodes.'}
                </div>
              ) : (
                <table className="reports-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>TIMESTAMP</th>
                      <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>NODE</th>
                      <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>TEMPERATURE</th>
                      <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>HUMIDITY</th>
                      <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>GAS LEVEL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row, idx) => (
                      <tr 
                        key={row.id || idx} 
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}
                      >
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{row.timestamp}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 'bold', color: 'var(--nash-chartreuse)' }}>Node {row.node_id}</td>
                        <td style={{ padding: '10px 14px', color: row.temperature > 45 ? 'var(--neon-red)' : 'var(--text-primary)' }}>
                          {row.temperature !== null ? `${row.temperature.toFixed(1)}°C` : 'N/A'}
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--text-primary)' }}>
                          {row.humidity !== null ? `${row.humidity.toFixed(1)}%` : 'N/A'}
                        </td>
                        <td style={{ padding: '10px 14px', color: row.gas_level > 250 ? 'var(--neon-red)' : 'var(--text-primary)' }}>
                          {row.gas_level !== null ? `${row.gas_level.toFixed(1)} ppm` : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
