import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

function nPos(node, w, h, pad = 55) {
  return {
    x: pad + node.nx * (w - 2 * pad),
    y: pad + node.ny * (h - 2 * pad),
  };
}

export default function RescueMode() {
  const { graph, sim, dataSourceManager, tick } = useApp();
  const mapRef = useRef(null);
  const mapDivRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef(new Map());
  const polylinesRef = useRef([]);
  const weightLabelsRef = useRef([]);
  const pathPolylineRef = useRef(null);
  const vehicleMarkerRef = useRef(null);
  const [radarLayer, setRadarLayer] = useState(null);

  const [selectedAlerts, setSelectedAlerts] = useState(new Set());
  const [rescueResult, setRescueResult] = useState(null);
  const [isComputing, setIsComputing] = useState(false);
  const [rescueStepIdx, setRescueStepIdx] = useState(-1);
  const resultsRef = useRef(null);
  // Global tick handles updates for both simulation and hardware modes

  // Refs so callbacks/events always have fresh values
  const selectedAlertsRef = useRef(selectedAlerts);
  const rescueResultRef = useRef(rescueResult);
  const toggleAlertRef = useRef(null);

  useEffect(() => { selectedAlertsRef.current = selectedAlerts; }, [selectedAlerts]);
  useEffect(() => { rescueResultRef.current = rescueResult; }, [rescueResult]);

  // Global tick updates are handled at the context level

  const isNodeOnline = useCallback((n) => {
    if (dataSourceManager?.mode === 'hardware' || dataSourceManager?.mode === 'online') {
      return n.data.status !== 'failed';
    }
    return true;
  }, [dataSourceManager?.mode]);

  const nodeIds = Array.from(graph.nodes.keys()).filter(id => isNodeOnline(graph.nodes.get(id)));

  // Clear selected alerts if nodes go offline in hardware mode
  useEffect(() => {
    if (dataSourceManager?.mode === 'hardware' || dataSourceManager?.mode === 'online') {
      setSelectedAlerts(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const id of next) {
          const node = graph.nodes.get(id);
          if (!node || node.data.status === 'failed') {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [graph, dataSourceManager?.mode, tick]);

  const toggleAlert = (id) => {
    setSelectedAlerts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setRescueResult(null);
    setRescueStepIdx(-1);
  };
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
      const unit = dataSourceManager?.mode === 'simulation' ? 'ms' : 'km';
      sim.eventLog.add('success', `Rescue route computed! Cost: ${result.bestCost.toFixed(1)} ${unit}`);
      
      // Auto-scroll to results on mobile
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }, 800);
  }, [selectedAlerts, graph, sim, dataSourceManager?.mode]);

  // Fetch RainViewer radar layer timestamp
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') return;
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(res => res.json())
      .then(data => {
        if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
          const latest = data.radar.past[data.radar.past.length - 1].time;
          setRadarLayer(`https://tilecache.rainviewer.com/v2/radar/${latest}/256/{z}/{x}/{y}/2/1_1.png`);
        }
      })
      .catch(err => console.error("Error fetching radar timestamp:", err));
  }, [dataSourceManager?.mode]);

  // Initialize Map
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }
    if (!mapDivRef.current || mapRef.current) return;

    const L = window.L;
    if (!L) return;

    const map = L.map(mapDivRef.current, {
      zoomControl: true,
      attributionControl: false
    }).setView([12.9716, 77.5946], 12); // Centered on Bangalore

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [dataSourceManager?.mode]);

  // Sync radar layer
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') return;
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L || !radarLayer) return;

    const layer = L.tileLayer(radarLayer, {
      opacity: 0.45,
      zIndex: 10,
      maxNativeZoom: 7
    }).addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [radarLayer, dataSourceManager?.mode]);

  // Sync nodes and links on Leaflet Map
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') return;
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L) return;

    // 1. Remove old polylines and weight labels
    for (const pl of polylinesRef.current) {
      map.removeLayer(pl);
    }
    polylinesRef.current = [];

    for (const lbl of weightLabelsRef.current) {
      map.removeLayer(lbl);
    }
    weightLabelsRef.current = [];

    if (pathPolylineRef.current) {
      map.removeLayer(pathPolylineRef.current);
      pathPolylineRef.current = null;
    }

    // 2. Render standard links
    for (const edge of graph.edges) {
      const src = graph.nodes.get(edge.source);
      const tgt = graph.nodes.get(edge.target);
      if (!src || !tgt) continue;
      if (!isNodeOnline(src) || !isNodeOnline(tgt)) continue;

      const isFailed = src.data.status === 'failed' || tgt.data.status === 'failed';
      const color = isFailed ? '#ff1744' : 'rgba(11, 18, 32, 0.2)';
      const polyline = L.polyline([[src.lat, src.lon], [tgt.lat, tgt.lon]], {
        color: color,
        weight: isFailed ? 1.5 : 2,
        dashArray: isFailed ? '5, 5' : null,
        opacity: isFailed ? 0.3 : 0.6
      }).addTo(map);
      polylinesRef.current.push(polyline);

      if (!isFailed) {
        const midLat = (src.lat + tgt.lat) / 2;
        const midLon = (src.lon + tgt.lon) / 2;
        const labelMarker = L.marker([midLat, midLon], {
          icon: L.divIcon({
            html: `<div style="font-family: var(--font-mono); font-size: 0.65rem; color: rgba(11,18,32,0.6); text-align: center; white-space: nowrap;">${edge.weight.toFixed(1)} km</div>`,
            className: 'edge-weight-label',
            iconSize: [40, 12],
            iconAnchor: [20, 6]
          }),
          interactive: false
        }).addTo(map);
        weightLabelsRef.current.push(labelMarker);
      }
    }

    // 3. Render active rescue path
    if (rescueResult?.bestPath && rescueResult.bestPath.length > 1) {
      const path = rescueResult.bestPath;
      const pathCoords = [];
      let pathValid = true;
      for (const id of path) {
        const n = graph.nodes.get(id);
        if (!n || !isNodeOnline(n)) {
          pathValid = false;
          break;
        }
        pathCoords.push([n.lat, n.lon]);
      }
      if (pathValid) {
        // Add start node to complete the cycle
        const first = graph.nodes.get(path[0]);
        if (first && isNodeOnline(first)) pathCoords.push([first.lat, first.lon]);

        const activePolyline = L.polyline(pathCoords, {
          color: '#FF653F',
          weight: 4.5,
          dashArray: '10, 6',
          opacity: 0.9,
          zIndexOffset: 100
        }).addTo(map);
        pathPolylineRef.current = activePolyline;
      }
    }

    // 4. Render/Update nodes
    const currentIds = new Set(
      Array.from(graph.nodes.keys()).filter(id => isNodeOnline(graph.nodes.get(id)))
    );
    for (const [id, marker] of markersRef.current.entries()) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
      }
    }

    for (const [id, node] of graph.nodes.entries()) {
      if (!isNodeOnline(node)) continue;
      let marker = markersRef.current.get(id);
      const isAlert = selectedAlerts.has(id);
      const isFailed = node.data.status === 'failed';
      const color = isFailed ? '#ff1744' : (isAlert ? '#FF1744' : '#448AFF');
      const size = isAlert ? 16 : 12;

      const pathIdx = rescueResult?.bestPath ? rescueResult.bestPath.indexOf(id) : -1;
      const seqBadge = pathIdx !== -1 ? `<span style="color:#FF653F;font-weight:bold;margin-left:4px;">#${pathIdx + 1}</span>` : '';

      const markerHtml = `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
          <!-- Node Label -->
          <div style="
            font-family: var(--font-mono);
            font-size: 0.65rem;
            font-weight: bold;
            color: #ffffff;
            background: rgba(0,0,0,0.65);
            padding: 2px 6px;
            border-radius: 3px;
            margin-bottom: 4px;
            white-space: nowrap;
            border: 1px solid ${isAlert ? '#FF1744' : 'rgba(255,255,255,0.1)'};
          ">
            ${node.label}${seqBadge}
          </div>
          <!-- Node Circle & Pulse -->
          <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
            ${isAlert && !isFailed ? '<div class="sonar-pulse-ring"></div>' : ''}
            <div style="
              width: ${size}px;
              height: ${size}px;
              background-color: ${color};
              border-radius: 50%;
              border: 2px solid #ffffff;
              box-shadow: 0 0 10px ${color};
            "></div>
          </div>
          ${isAlert && !isFailed ? `
            <div style="
              font-family: var(--font-mono);
              font-size: 0.55rem;
              color: #FF1744;
              font-weight: bold;
              text-shadow: 0 0 4px rgba(0,0,0,0.8);
              margin-top: 2px;
              white-space: nowrap;
            ">
              DISASTER AREA
            </div>
          ` : ''}
        </div>
      `;

      const markerOptions = {
        icon: L.divIcon({
          html: markerHtml,
          className: 'rescue-node-icon',
          iconSize: [80, 80],
          iconAnchor: [40, 50]
        }),
        zIndexOffset: isAlert ? 500 : 0
      };

      if (!marker) {
        marker = L.marker([node.lat, node.lon], markerOptions).addTo(map);
        marker.on('click', () => {
          toggleAlertRef.current(id);
        });
        markersRef.current.set(id, marker);
      } else {
        marker.setLatLng([node.lat, node.lon]);
        marker.setIcon(markerOptions.icon);
        if (!map.hasLayer(marker)) {
          marker.addTo(map);
        }
      }
    }
  }, [graph, selectedAlerts, rescueResult, dataSourceManager?.mode, tick]);

  // Handle moving rescue vehicle animation
  useEffect(() => {
    if (dataSourceManager?.mode === 'simulation') return;
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L) return;

    if (vehicleMarkerRef.current) {
      map.removeLayer(vehicleMarkerRef.current);
      vehicleMarkerRef.current = null;
    }

    if (!rescueResult?.bestPath || rescueResult.bestPath.length < 2) return;

    const path = rescueResult.bestPath;
    const firstNode = graph.nodes.get(path[0]);
    if (!firstNode || !isNodeOnline(firstNode)) return;

    const vehicleHtml = `
      <div style="
        width: 32px; height: 32px;
        background: rgba(255, 101, 63, 0.2);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 20px rgba(255, 101, 63, 0.4);
      ">
        <div style="
          width: 18px; height: 18px;
          background: #FF653F;
          border: 2px solid #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-family: var(--font-mono);
          font-weight: bold;
          font-size: 9px;
        ">R</div>
      </div>
    `;

    const vehicleIcon = L.divIcon({
      html: vehicleHtml,
      className: 'rescue-vehicle-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const vehicleMarker = L.marker([firstNode.lat, firstNode.lon], {
      icon: vehicleIcon,
      zIndexOffset: 1000
    }).addTo(map);

    vehicleMarkerRef.current = vehicleMarker;

    let animId;
    let startTime = performance.now();

    function animate() {
      const time = (performance.now() - startTime) / 1000;
      const vehicleProgress = (time * 0.12) % 1;
      const totalSegs = path.length;
      const segFloat = vehicleProgress * totalSegs;
      const seg = Math.floor(segFloat) % totalSegs;
      const segT = segFloat - Math.floor(segFloat);

      const sn = graph.nodes.get(path[seg]);
      const en = graph.nodes.get(path[(seg + 1) % path.length]);

      if (sn && en && isNodeOnline(sn) && isNodeOnline(en)) {
        const vLat = sn.lat + (en.lat - sn.lat) * segT;
        const vLon = sn.lon + (en.lon - sn.lon) * segT;
        vehicleMarker.setLatLng([vLat, vLon]);
      }

      animId = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animId);
      if (vehicleMarkerRef.current) {
        map.removeLayer(vehicleMarkerRef.current);
        vehicleMarkerRef.current = null;
      }
    };
  }, [rescueResult, graph, dataSourceManager?.mode]);

  // Canvas rendering effect for Simulation Mode
  useEffect(() => {
    if (dataSourceManager?.mode !== 'simulation') return;
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
      const w = canvas.width, h = canvas.height, PAD = 55;

      for (const [id, node] of graph.nodes) {
        const { x, y } = nPos(node, w, h, PAD);
        const dx = mx - x, dy = my - y;
        if (dx * dx + dy * dy < 400) { // 20px radius
          toggleAlert(id);
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

      // Grid
      ctx.strokeStyle = 'rgba(255,23,68,0.03)';
      for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      const PAD = 55;
      // Edges
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;
        const sp = nPos(src, w, h, PAD);
        const tp = nPos(tgt, w, h, PAD);
        ctx.strokeStyle = 'rgba(255,200,92,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();

        ctx.font = '9px "Share Tech Mono"';
        ctx.fillStyle = 'rgba(255,200,92,0.3)';
        ctx.textAlign = 'center';
        ctx.fillText(edge.weight.toString(), (sp.x + tp.x) / 2, (sp.y + tp.y) / 2 - 4);
      }

      // Rescue path
      if (rescueResult?.bestPath && rescueResult.bestPath.length > 1) {
        const path = rescueResult.bestPath;
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
        const vehicleProgress = (time * 0.15) % 1;
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
          const vGrad = ctx.createRadialGradient(vx, vy, 0, vx, vy, 22);
          vGrad.addColorStop(0, 'rgba(255,101,63,0.5)');
          vGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = vGrad;
          ctx.beginPath(); ctx.arc(vx, vy, 22, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#FF653F'; ctx.shadowColor = '#FF653F'; ctx.shadowBlur = 16;
          ctx.beginPath(); ctx.arc(vx, vy, 7, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('V', vx, vy - 14);
        }

        for (let i = 0; i < path.length; i++) {
          const n = graph.nodes.get(path[i]);
          if (!n) continue;
          const p = nPos(n, w, h, PAD);
          ctx.font = 'bold 12px "Orbitron"';
          ctx.fillStyle = '#FF653F';
          ctx.textAlign = 'center';
          ctx.fillText(`#${i + 1}`, p.x + 20, p.y - 20);
        }
      }

      // Nodes
      for (const [id, node] of graph.nodes) {
        const isAlert = selectedAlerts.has(id);
        const { x, y } = nPos(node, w, h, PAD);
        node.x = x; node.y = y;
        const r = isAlert ? 14 : 10;
        const color = isAlert ? '#FF1744' : '#448AFF';

        if (isAlert) {
          const pulseR = 28 + Math.sin(time * 4) * 8;
          ctx.strokeStyle = `rgba(255,23,68,${0.3 + Math.sin(time * 4) * 0.2})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, pulseR, 0, Math.PI * 2);
          ctx.stroke();
        }

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
        grad.addColorStop(0, color + '40');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = isAlert ? 18 : 7;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        ctx.font = 'bold 10px "Orbitron", monospace';
        ctx.fillStyle = '#f0eaf8';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, x, y - r - 8);

        if (isAlert) {
          ctx.font = '14px sans-serif';
          ctx.fillText('ALERT', x, y + r + 18);
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
  }, [graph, selectedAlerts, rescueResult, dataSourceManager?.mode]);

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
                {isAlert ? '🚨 ' : ''}{graph.nodes.get(id)?.label}
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
        {/* Map Container */}
        <div className="panel glass-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: '700px', padding: '20px', marginBottom: 0 }}>
          <div className="section-header" style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Tactical Response Live Map</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--neon-red)', fontFamily: 'var(--font-mono)', animation: 'pulse 2s infinite' }}>
              ● DISASTER MODE ACTIVE
            </span>
          </div>
          <div ref={containerRef} style={{ flex: 1, position: 'relative', marginTop: 12, background: 'rgba(5, 2, 15, 0.45)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.03)', overflow: 'hidden' }}>
            {dataSourceManager?.mode === 'simulation' ? (
              <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', background: '#05020f' }} />
            ) : (
              <div ref={mapDivRef} style={{ width: '100%', height: '100%', minHeight: '600px', background: '#05020f' }} />
            )}
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
                    {rescueResult.bestCost.toFixed(1)}
                    <span style={{ fontSize: '1rem', fontWeight: '500' }}>
                      {dataSourceManager?.mode === 'simulation' ? ' ms' : ' km'}
                    </span>
                  </div>
                </div>
                <div className="stat-card glass-panel" style={{ padding: '16px', borderLeft: '4px solid var(--neon-cyan)' }}>
                  <div className="stat-label" style={{ fontSize: '0.75rem' }}>
                    {dataSourceManager?.mode === 'simulation' ? 'Est. Mission Time' : 'Est. Travel Time (14 km/h avg, Bangalore)'}
                  </div>
                  <div className="stat-value cyan" style={{ fontSize: '2.4rem', fontWeight: '900' }}>
                    {dataSourceManager?.mode === 'simulation'
                      ? (rescueResult.bestCost * 2.5).toFixed(0)
                      : (rescueResult.bestCost / 14 * 60).toFixed(0)}
                    <span style={{ fontSize: '1rem', fontWeight: '500' }}>
                      {dataSourceManager?.mode === 'simulation' ? ' s' : ' mins'}
                    </span>
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
