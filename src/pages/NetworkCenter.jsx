import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

const QOS_INFO = [
  { level: 0, name: 'QoS 0 — At Most Once', desc: 'Fire and forget. No acknowledgment. Fastest but unreliable. Like UDP.', color: '#00E5FF' },
  { level: 1, name: 'QoS 1 — At Least Once', desc: 'Message acknowledged by receiver. May deliver duplicates. Balanced reliability.', color: '#FFC85C' },
  { level: 2, name: 'QoS 2 — Exactly Once', desc: 'Four-step handshake guarantees exactly one delivery. Slowest but most reliable.', color: '#FF653F' },
];

const NETWORK_CONCEPTS = [
  { title: 'ESP-NOW Protocol', icon: '📡', desc: 'Peer-to-peer WiFi protocol by Espressif. No router needed. Low latency (~1ms), 250-byte payload. Perfect for mesh networks.' },
  { title: 'Mesh Topology', icon: '🕸️', desc: 'Every node can communicate with multiple peers. Self-healing: if one path fails, data routes through alternatives. High redundancy.' },
  { title: 'Distance Vector Routing', icon: '🧭', desc: 'Each node maintains a table of distances to all destinations. Nodes share tables with neighbors. Bellman-Ford equation: Dx(y) = min{c(x,v) + Dv(y)}' },
  { title: 'TCP vs UDP', icon: '⚡', desc: 'TCP: Connection-oriented, reliable, ordered. UDP: Connectionless, fast, no guarantees. Mesh uses UDP-like (ESP-NOW) for speed + application-level reliability.' },
  { title: 'MQTT Protocol', icon: '📨', desc: 'Publish/Subscribe messaging for IoT. Lightweight, supports QoS levels 0-2. Broker-based architecture. Used for sensor data aggregation.' },
  { title: 'Packet Flooding', icon: '🌊', desc: 'Broadcast a packet to all neighbors. Each node rebroadcasts once. Guarantees delivery but generates O(E) messages. TTL limits propagation.' },
  { title: 'TTL (Time To Live)', icon: '⏳', desc: 'Counter decremented at each hop. Packet dropped when TTL=0. Prevents infinite loops. Recurrence: TTL(n+1) = TTL(n) - 1, base case: drop when 0.' },
  { title: 'Heartbeat Mechanism', icon: '💓', desc: 'Periodic "alive" messages between nodes. If missed for N intervals, node marked as failed. Triggers self-healing rerouting.' },
];

function nPos(node, w, h, pad = 60) {
  return {
    x: pad + node.nx * (w - 2 * pad),
    y: pad + node.ny * (h - 2 * pad),
  };
}

// Actual hex colors — CSS vars don't work in Canvas2D context
const C = {
  chartreuse: '#c9ff00',
  cyan: '#00E5FF',
  yellow: '#FFC85C',
  red: '#FF1744',
  blue: '#448AFF',
  orange: '#FF653F',
};

export default function NetworkCenter() {
  const { graph, sim } = useApp();
  const [selectedNode, setSelectedNode] = useState('A');
  const [hoveredNode, setHoveredNode] = useState(null);
  const [, setTick] = useState(0);
  const [viewTab, setViewTab] = useState('routing');
  const [activeAnatomyIndex, setActiveAnatomyIndex] = useState(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // Refs so the canvas animation loop always reads fresh values without stale closure
  const selectedNodeRef = useRef(selectedNode);
  const hoveredNodeRef = useRef(hoveredNode);

  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);
  useEffect(() => { hoveredNodeRef.current = hoveredNode; }, [hoveredNode]);

  useEffect(() => {
    const unsub = sim.subscribe(() => setTick(t => t + 1));
    return unsub;
  }, [sim]);

  const nodeIds = Array.from(graph.nodes.keys());
  const routingTable = graph.getRoutingTable(selectedNode);
  const { matrix, nodeIds: matrixIds } = graph.getAdjacencyMatrix();
  const recentPackets = sim.packets.slice(-20).reverse();

  // Create a sample packet for anatomy display
  const samplePacket = {
    header: 'ESP-NOW Frame Structure',
    fields: [
      { name: 'Source MAC', value: 'AA:BB:CC:DD:EE:' + selectedNode.charCodeAt(0).toString(16).toUpperCase(), bytes: 6, color: '#FF653F', desc: 'Hardware address of the transmitting node. Used for hop-by-hop tracking.' },
      { name: 'Dest MAC', value: 'FF:FF:FF:FF:FF:FF', bytes: 6, color: '#FFC85C', desc: 'Hardware address of the next-hop receiver. Broad/Multicast addresses trigger flooding.' },
      { name: 'Msg Type', value: '0x01 (DATA)', bytes: 1, color: '#00E5FF', desc: 'Flags indicating data types: Sensor Telemetry, Command Broadcast, or Heartbeats.' },
      { name: 'TTL', value: '10', bytes: 1, color: '#c9ff00', desc: 'Time To Live. Decremented at each hop node. Prevents routing loops; drops at 0.' },
      { name: 'QoS', value: '1', bytes: 1, color: '#FFC85C', desc: 'Quality of Service priority level (0 = best effort, 1 = acknowledged, 2 = transactional).' },
      { name: 'Seq Number', value: '0x002A', bytes: 2, color: '#448AFF', desc: 'Sequence number incremented per packet to detect duplicates at the destination.' },
      { name: 'Payload', value: '{"temp":42.5,"gas":320}', bytes: 32, color: '#a89cc8', desc: 'JSON encoded sensor data or command strings encrypted for local decryption.' },
      { name: 'Checksum', value: '0xF7E2', bytes: 2, color: '#FF653F', desc: 'CRC16 parity check sequence ensuring transmission frame integrity.' },
    ],
  };

  // Canvas loop — runs ONCE on mount, reads state via refs to avoid stale closures
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
      const w = canvas.width, h = canvas.height, PAD = 60;

      for (const [id, node] of graph.nodes) {
        const { x, y } = nPos(node, w, h, PAD);
        const dx = mx - x, dy = my - y;
        if (dx * dx + dy * dy < 576) { // 24px radius
          setSelectedNode(id);
          return;
        }
      }
    };

    const handleCanvasMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = canvas.width, h = canvas.height, PAD = 60;
      let found = null;

      for (const [id, node] of graph.nodes) {
        const { x, y } = nPos(node, w, h, PAD);
        const dx = mx - x, dy = my - y;
        if (dx * dx + dy * dy < 576) {
          found = id;
          break;
        }
      }
      setHoveredNode(found);
    };

    canvas.addEventListener('mousedown', handleCanvasClick);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);

    let time = 0;
    function draw() {
      time += 0.016;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // ── Canvas tactical grid ──
      const GRID = 65;
      // Vertical lines
      ctx.strokeStyle = 'rgba(201,255,0,0.18)';
      ctx.lineWidth = 0.8;
      for (let gx = 0; gx < w; gx += GRID) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      // Horizontal lines
      ctx.strokeStyle = 'rgba(0,229,255,0.13)';
      for (let gy = 0; gy < h; gy += GRID) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
      // Grid intersection dots
      ctx.fillStyle = 'rgba(201,255,0,0.32)';
      for (let gx = 0; gx < w; gx += GRID) {
        for (let gy = 0; gy < h; gy += GRID) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Corner bracket accents
      const bS = 24;
      ctx.strokeStyle = 'rgba(201,255,0,0.45)';
      ctx.lineWidth = 1.5;
      [[0,0,1,1],[w,0,-1,1],[0,h,1,-1],[w,h,-1,-1]].forEach(([bx,by,sx,sy]) => {
        ctx.beginPath();
        ctx.moveTo(bx + sx*bS, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + sy*bS);
        ctx.stroke();
      });
      // Center crosshair
      ctx.strokeStyle = 'rgba(0,229,255,0.1)';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
      ctx.setLineDash([]);

      // Tactical grid marks (distance rulers on edges)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.font = '7px "Geist Mono", monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      for (let offset = 50; offset < w; offset += 100) {
        ctx.beginPath();
        ctx.moveTo(offset, 0); ctx.lineTo(offset, 5);
        ctx.moveTo(offset, h); ctx.lineTo(offset, h - 5);
        ctx.stroke();
        ctx.fillText(`${offset}m`, offset - 10, 12);
      }
      for (let offset = 50; offset < h; offset += 100) {
        ctx.beginPath();
        ctx.moveTo(0, offset); ctx.lineTo(5, offset);
        ctx.moveTo(w, offset); ctx.lineTo(w - 5, offset);
        ctx.stroke();
        ctx.fillText(`${offset}m`, 8, offset + 3);
      }

      const PAD = 60;
      // Read fresh values from refs (avoids stale closure)
      const curSelected = selectedNodeRef.current;
      const curHovered = hoveredNodeRef.current;
      const curRoutingTable = graph.getRoutingTable(curSelected);
      const hoveredRoute = curRoutingTable.find(r => r.destination === curHovered);
      const highlightPath = hoveredRoute ? hoveredRoute.path : null;

      // Draw edges / links
      for (const edge of graph.edges) {
        const src = graph.nodes.get(edge.source);
        const tgt = graph.nodes.get(edge.target);
        if (!src || !tgt) continue;

        const sp = nPos(src, w, h, PAD);
        const tp = nPos(tgt, w, h, PAD);
        const isFailed = src.data.status === 'failed' || tgt.data.status === 'failed';

        // Check if edge is in active hovered path
        let isPathHighlighted = false;
        if (highlightPath) {
          for (let i = 0; i < highlightPath.length - 1; i++) {
            if ((highlightPath[i] === edge.source && highlightPath[i+1] === edge.target) ||
                (highlightPath[i] === edge.target && highlightPath[i+1] === edge.source)) {
              isPathHighlighted = true;
              break;
            }
          }
        }

        // Check if edge is in any routing path from selectedNode
        let isAnyPath = false;
        if (!isPathHighlighted && curSelected) {
          for (const route of curRoutingTable) {
            if (route.path) {
              for (let i = 0; i < route.path.length - 1; i++) {
                if ((route.path[i] === edge.source && route.path[i+1] === edge.target) ||
                    (route.path[i] === edge.target && route.path[i+1] === edge.source)) {
                  isAnyPath = true;
                  break;
                }
              }
            }
            if (isAnyPath) break;
          }
        }

        if (isFailed) {
          ctx.strokeStyle = 'rgba(255, 23, 68, 0.15)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
        } else if (isPathHighlighted) {
          ctx.strokeStyle = C.yellow;
          ctx.lineWidth = 4;
          ctx.setLineDash([]);
          ctx.shadowColor = C.yellow;
          ctx.shadowBlur = 10;
        } else if (isAnyPath) {
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);

        // Weight text
        if (!isFailed) {
          ctx.font = 'bold 10px "Geist Mono", monospace';
          ctx.fillStyle = isPathHighlighted ? C.yellow : isAnyPath ? C.cyan : 'rgba(255, 255, 255, 0.3)';
          ctx.textAlign = 'center';
          ctx.fillText(`${edge.weight.toString()}ms`, (sp.x + tp.x) / 2, (sp.y + tp.y) / 2 - 6);
        }
      }

      // Draw packet flow animations
      const flowSpeed = 0.55;
      curRoutingTable.forEach(route => {
        if (route.path && route.path.length > 1 && route.destination !== curSelected) {
          const path = route.path;
          const totalHops = path.length - 1;
          const progress = (time * flowSpeed) % totalHops;
          const segmentIdx = Math.floor(progress);
          const segmentT = progress - segmentIdx;

          const n1 = graph.nodes.get(path[segmentIdx]);
          const n2 = graph.nodes.get(path[segmentIdx + 1]);

          if (n1 && n2 && n1.data.status !== 'failed' && n2.data.status !== 'failed') {
            const p1 = nPos(n1, w, h, PAD);
            const p2 = nPos(n2, w, h, PAD);
            const px = p1.x + (p2.x - p1.x) * segmentT;
            const py = p1.y + (p2.y - p1.y) * segmentT;

            const isHoveredPath = highlightPath && highlightPath.includes(n1.id) && highlightPath.includes(n2.id);

            ctx.fillStyle = isHoveredPath ? C.yellow : C.cyan;
            ctx.shadowColor = isHoveredPath ? C.yellow : C.cyan;
            ctx.shadowBlur = isHoveredPath ? 12 : 8;
            ctx.beginPath();
            ctx.arc(px, py, isHoveredPath ? 5.5 : 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      });

      // Draw nodes — all colors use hex (CSS vars don't work in Canvas2D)
      for (const [id, node] of graph.nodes) {
        const isSelected = id === curSelected;
        const isHovered = id === curHovered;
        const isFailed = node.data.status === 'failed';
        const isCritical = node.data.status === 'critical';
        const isWarning = node.data.status === 'warning';

        let isPathNode = false;
        if (highlightPath) {
          isPathNode = highlightPath.includes(id);
        }

        const { x, y } = nPos(node, w, h, PAD);
        node.x = x; node.y = y;

        const r = isSelected ? 16 : isHovered ? 14 : isPathNode ? 12 : 10;

        let color = C.cyan;
        if (isFailed) color = C.red;
        else if (isCritical) color = C.red;
        else if (isWarning) color = C.yellow;
        else if (isSelected) color = C.chartreuse;
        else if (isHovered) color = C.yellow;
        else if (isPathNode) color = C.cyan;

        // Selected node pulse ring
        if (isSelected && !isFailed) {
          const pulseR = r + (time * 12) % 24;
          const pulseAlpha = 1 - ((time * 12) % 24) / 24;
          ctx.strokeStyle = `rgba(201, 255, 0, ${pulseAlpha})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, pulseR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Radar ring for hovered node path destinations
        if (isHovered && !isFailed) {
          const pulseR = r + (time * 10) % 18;
          const pulseAlpha = 1 - ((time * 10) % 18) / 18;
          ctx.strokeStyle = `rgba(255, 200, 92, ${pulseAlpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, pulseR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Radial glow
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
        grad.addColorStop(0, color + '30');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Node core
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = (isSelected || isHovered) ? 14 : 6;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.font = 'bold 11px "Geist Mono", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, x, y - r - 8);

        // Status or info
        if (isSelected || isHovered) {
          ctx.font = '9px "Geist Mono", monospace';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          const text = isFailed ? 'OFFLINE' : `RSSI: ${node.data.rssi.toFixed(0)} dBm`;
          ctx.fillText(text, x, y + r + 12);
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      canvas.removeEventListener('mousedown', handleCanvasClick);
      canvas.removeEventListener('mousemove', handleCanvasMouseMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]); // Run once — state accessed via refs

  return (
    <div className="page-container animate-fade-in" style={{ padding: '24px 40px', width: '100%', boxSizing: 'border-box' }}>
      <div className="page-header" style={{ marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
        <h2 className="page-title" style={{ fontSize: '1.7rem', fontWeight: '800', letterSpacing: '-0.5px', textTransform: 'none' }}>Network Routing Center</h2>
        <div className="page-controls" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>Inspect Node:</span>
          <select
            value={selectedNode}
            onChange={e => setSelectedNode(e.target.value)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.85rem', background: 'rgba(10,6,24,0.6)',
              color: 'var(--neon-cyan)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '6px 14px',
              cursor: 'pointer', boxShadow: '0 0 10px rgba(0, 229, 255, 0.1)'
            }}
          >
            {nodeIds.map(id => (
              <option key={id} value={id}>{graph.nodes.get(id)?.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="network-layout" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px', width: '100%' }}>
        {/* Column 1: Interactive Routing Diagram */}
        <div className="panel glass-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: '680px', padding: '20px', marginBottom: 0 }}>
          <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span>Routing Topology View</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Selected Source: <span style={{ color: 'var(--nash-chartreuse)', fontWeight: 'bold' }}>{graph.nodes.get(selectedNode)?.label}</span>
            </span>
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Hover over a node to draw its path from <strong style={{ color: 'var(--nash-chartreuse)' }}>{graph.nodes.get(selectedNode)?.label}</strong>. Pulse dots represent routing packets forwarding in real-time.
          </p>
          <div ref={containerRef} style={{ flex: 1, position: 'relative', marginTop: 4, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.03)' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        </div>

        {/* Column 2: Dashboard Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* View Tabs */}
          <div className="algo-tabs" style={{ marginBottom: 4 }}>
            {[
              { key: 'routing', label: 'Routing Tables' },
              { key: 'packets', label: 'Packet Flow' },
              { key: 'anatomy', label: 'Packet Anatomy' },
              { key: 'matrix', label: 'Adjacency Matrix' },
              { key: 'qos', label: 'QoS & MQTT' },
              { key: 'concepts', label: 'CN Concepts' },
            ].map(t => (
              <button key={t.key} className={`algo-tab ${viewTab === t.key ? 'active' : ''}`} onClick={() => setViewTab(t.key)} style={{ padding: '10px 16px', fontSize: '0.72rem', fontWeight: 'bold' }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ROUTING TABLES */}
          {viewTab === 'routing' && (
            <div className="panel glass-panel animate-slide-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <div className="section-header" style={{ marginBottom: '6px' }}>Dijkstra Shortest Routing Table</div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Computed dynamically. Lists the next hop, hop count, and cumulative latency path from <strong style={{ color: 'var(--neon-cyan)' }}>Node {selectedNode}</strong>.
              </p>
              <div className="panel-scroll" style={{ flex: 1 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ padding: '12px 10px' }}>Destination</th>
                      <th style={{ padding: '12px 10px' }}>Next Hop</th>
                      <th style={{ padding: '12px 10px' }}>Cost</th>
                      <th style={{ padding: '12px 10px' }}>Hops</th>
                      <th style={{ padding: '12px 10px' }}>Path Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routingTable.map(r => {
                      const pathQuality = Math.max(10, Math.min(100, 100 - (r.distance * 2) - (r.hopCount * 6)));
                      return (
                        <tr key={r.destination} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ color: 'var(--neon-cyan)', fontWeight: 'bold', padding: '14px 10px' }}>{r.destLabel}</td>
                          <td style={{ color: 'var(--warm-yellow)', padding: '14px 10px' }}>{r.nextHopLabel}</td>
                          <td style={{ padding: '14px 10px' }}>{r.distance === Infinity ? '∞' : `${r.distance.toFixed(1)}ms`}</td>
                          <td style={{ padding: '14px 10px' }}>{r.hopCount}</td>
                          <td style={{ padding: '14px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
                                <div style={{
                                  width: `${pathQuality}%`,
                                  height: '100%',
                                  background: pathQuality > 80 ? 'var(--neon-green)' : pathQuality > 55 ? 'var(--warm-yellow)' : 'var(--neon-red)',
                                  boxShadow: `0 0 6px ${pathQuality > 80 ? 'var(--neon-green)' : pathQuality > 55 ? 'var(--warm-yellow)' : 'var(--neon-red)'}40`
                                }} />
                              </div>
                              <span style={{ fontSize: '0.72rem', color: pathQuality > 80 ? 'var(--neon-green)' : pathQuality > 55 ? 'var(--warm-yellow)' : 'var(--neon-red)', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>
                                {pathQuality.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PACKET FLOW */}
          {viewTab === 'packets' && (
            <div className="panel glass-panel animate-slide-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <div className="section-header" style={{ marginBottom: '12px' }}>Live Packet Stream</div>
              
              {/* Massive KPIs */}
              <div className="stat-strip" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div className="stat-card glass-panel" style={{ padding: '16px' }}>
                  <div className="stat-label" style={{ fontSize: '0.7rem' }}>Total Sent</div>
                  <div className="stat-value cyan" style={{ fontSize: '2.6rem', fontWeight: '900' }}>{sim.stats.totalPacketsSent}</div>
                </div>
                <div className="stat-card glass-panel" style={{ padding: '16px' }}>
                  <div className="stat-label" style={{ fontSize: '0.7rem' }}>Delivered</div>
                  <div className="stat-value green" style={{ fontSize: '2.6rem', fontWeight: '900' }}>{sim.stats.totalPacketsDelivered}</div>
                </div>
                <div className="stat-card glass-panel" style={{ padding: '16px' }}>
                  <div className="stat-label" style={{ fontSize: '0.7rem' }}>Dropped</div>
                  <div className="stat-value" style={{ fontSize: '2.6rem', fontWeight: '900', color: 'var(--neon-red)' }}>{sim.stats.totalPacketsDropped}</div>
                </div>
              </div>

              <div className="panel-scroll" style={{ flex: 1, maxHeight: 420 }}>
                {recentPackets.map(pkt => (
                  <div key={pkt.id} className="packet-item animate-slide-in" style={{ padding: '12px 14px', marginBottom: '8px', fontSize: '0.78rem' }}>
                    <span className="packet-dot" style={{ background: pkt.getPriorityColor(), width: '10px', height: '10px' }} />
                    <span style={{ fontSize: '0.9rem' }}>{pkt.getTypeIcon()}</span>
                    <span style={{ color: 'var(--neon-cyan)', fontWeight: 'bold' }}>#{pkt.id}</span>
                    <span style={{ color: 'var(--warm-yellow)', fontFamily: 'var(--font-mono)' }}>{pkt.type}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>QoS:{pkt.qos}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>TTL:{pkt.ttl}</span>
                    <span style={{ fontWeight: '600' }}>{graph.nodes.get(pkt.source)?.label} → {graph.nodes.get(pkt.destination)?.label}</span>
                    <span className={`badge ${pkt.status === 'delivered' ? 'badge-green' : pkt.status === 'dropped' ? 'badge-red' : 'badge-cyan'}`} style={{ padding: '4px 8px' }}>
                      {pkt.status.toUpperCase()}
                    </span>
                  </div>
                ))}
                {recentPackets.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', textAlign: 'center', padding: 40 }}>
                    No packet activity detected. Start the mesh simulation on the Command Center tab to stream logs.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PACKET ANATOMY */}
          {viewTab === 'anatomy' && (
            <div className="panel glass-panel animate-slide-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <div className="section-header" style={{ marginBottom: '6px' }}>Packet Frame Construction</div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Interactive ESP-NOW packet structure. Hover or click a segment to inspect the bytes allocation.
              </p>

              {/* Horizontal segmented frame visualization */}
              <div style={{ display: 'flex', height: '38px', borderRadius: '6px', overflow: 'hidden', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                {samplePacket.fields.map((f, i) => {
                  const totalBytes = samplePacket.fields.reduce((s, x) => s + x.bytes, 0);
                  const pct = (f.bytes / totalBytes) * 100;
                  const isActive = activeAnatomyIndex === i;
                  return (
                    <div
                      key={i}
                      style={{
                        width: `${pct}%`,
                        background: f.color,
                        opacity: isActive ? 1 : 0.85,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#000',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.62rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: isActive ? `inset 0 0 10px rgba(0,0,0,0.5), 0 0 10px ${f.color}` : 'none',
                      }}
                      title={`${f.name}: ${f.bytes} Bytes`}
                      onMouseEnter={() => setActiveAnatomyIndex(i)}
                      onClick={() => setActiveAnatomyIndex(i)}
                    >
                      {f.bytes > 1 ? `${f.name.split(' ')[0]}` : ''}
                    </div>
                  );
                })}
              </div>

              {/* Field details */}
              <div className="panel-scroll" style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {samplePacket.fields.map((f, i) => {
                    const isActive = activeAnatomyIndex === i;
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex', flexDirection: 'column', padding: '12px 16px',
                          background: isActive ? `${f.color}15` : 'rgba(10,6,24,0.3)',
                          borderLeft: `4px solid ${f.color}`, borderRadius: 4,
                          transition: 'all 0.2s',
                          border: isActive ? `1px solid ${f.color}40` : '1px solid transparent',
                          borderLeftWidth: '4px'
                        }}
                        onMouseEnter={() => setActiveAnatomyIndex(i)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.75rem', color: f.color, fontWeight: 'bold', letterSpacing: 1 }}>
                            {f.name.toUpperCase()}
                          </span>
                          <span className="badge" style={{ background: `${f.color}20`, color: f.color, border: `1px solid ${f.color}40` }}>
                            {f.bytes} Bytes
                          </span>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#ffffff', marginBottom: 4 }}>
                          Value: <code style={{ color: 'var(--warm-yellow)' }}>{f.value}</code>
                        </div>
                        {isActive && (
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4, marginTop: 4 }}>
                            {f.desc}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ADJACENCY MATRIX */}
          {viewTab === 'matrix' && (
            <div className="panel glass-panel animate-slide-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <div className="section-header" style={{ marginBottom: '6px' }}>Adjacency Matrix & Neighbors</div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Discrete weights matrix between nodes. High-intensity cell background reflects higher signal link quality.
              </p>
              
              <div className="panel-scroll" style={{ flex: 1 }}>
                <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
                  <table className="data-table" style={{ textAlign: 'center', width: '100%' }}>
                    <thead>
                      <tr>
                        <th></th>
                        {matrixIds.map(id => <th key={id} style={{ color: 'var(--neon-cyan)', padding: '10px' }}>{graph.nodes.get(id)?.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.map((row, i) => (
                        <tr key={i}>
                          <td style={{ color: 'var(--neon-cyan)', fontFamily: 'var(--font-display)', fontWeight: 'bold', padding: '10px' }}>
                            {graph.nodes.get(matrixIds[i])?.label}
                          </td>
                          {row.map((val, j) => {
                            const isSelf = i === j;
                            const isConnected = val !== 0 && val !== Infinity;
                            let bg = 'transparent';
                            let fg = 'var(--text-muted)';
                            if (isSelf) {
                              bg = 'rgba(255, 255, 255, 0.03)';
                              fg = 'rgba(255, 255, 255, 0.2)';
                            } else if (isConnected) {
                              const intensity = Math.max(0.1, Math.min(0.8, 1 - (val / 15)));
                              bg = `rgba(0, 229, 255, ${intensity * 0.22})`;
                              fg = 'var(--nash-chartreuse)';
                            }
                            return (
                              <td key={j} style={{
                                background: bg,
                                color: fg,
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.85rem',
                                fontWeight: isConnected ? 'bold' : 'normal',
                                padding: '10px',
                                border: '1px solid rgba(255,255,255,0.03)',
                              }}>
                                {val === 0 ? '0' : val === Infinity ? '∞' : val.toFixed(1)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="section-header" style={{ marginBottom: '8px', fontSize: '0.85rem' }}>Adjacency List (Linked Neighbors)</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {nodeIds.map(id => (
                    <div key={id} style={{ padding: '6px 12px', background: 'rgba(10,6,24,0.4)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.02)' }}>
                      <span style={{ color: 'var(--neon-cyan)', fontWeight: 'bold' }}>{graph.nodes.get(id)?.label}</span>
                      {' ➔ '}
                      {graph.getNeighbors(id).map(n => (
                        <span key={n.nodeId} style={{ marginRight: '12px', display: 'inline-block' }}>
                          <span style={{ color: 'var(--warm-yellow)' }}>{graph.nodes.get(n.nodeId)?.label}</span>
                          (<span style={{ color: 'var(--nash-chartreuse)' }}>{n.weight.toFixed(1)}</span>)
                        </span>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Graph stats */}
                <div style={{ marginTop: 20, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 20, flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                  <span>Vertices (|V|): <strong>{graph.nodes.size}</strong></span>
                  <span>Edges (|E|): <strong>{graph.edges.length}</strong></span>
                  <span>Density: <strong>{(graph.getStats().density * 100).toFixed(1)}%</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* QoS & MQTT */}
          {viewTab === 'qos' && (
            <div className="panel glass-panel animate-slide-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <div className="section-header" style={{ marginBottom: '12px' }}>QoS Levels & Message Broker Logic</div>
              <div className="panel-scroll" style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {QOS_INFO.map(q => (
                    <div key={q.level} style={{
                      padding: 16, borderRadius: 'var(--radius-sm)',
                      background: `${q.color}06`, borderLeft: `4px solid ${q.color}`,
                      border: `1px solid ${q.color}15`, borderLeftWidth: '4px'
                    }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: q.color, marginBottom: 6, letterSpacing: 1, fontWeight: 'bold' }}>
                        {q.name}
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {q.desc}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="section-header" style={{ marginTop: 24, marginBottom: 8, fontSize: '0.9rem' }}>Priority Scheduling Queues</div>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  The routing priority schedule prioritizes urgent rescue packets. Packets with <strong style={{ color: '#FF653F' }}>QoS 2 (High)</strong> and SOS flags bypass routing queues instantly, followed by QoS 1, while QoS 0 packets are processed when channels clear.
                </p>
              </div>
            </div>
          )}

          {/* CN CONCEPTS */}
          {viewTab === 'concepts' && (
            <div className="panel glass-panel animate-slide-in" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <div className="section-header" style={{ marginBottom: '12px' }}>Core Computer Networks Syllabus Concepts</div>
              <div className="panel-scroll" style={{ flex: 1 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
                  {NETWORK_CONCEPTS.map((c, i) => (
                    <div key={i} style={{
                      padding: 16, borderRadius: 'var(--radius-sm)',
                      background: 'rgba(10,6,24,0.3)', border: '1px solid rgba(201, 255, 0, 0.1)',
                      boxShadow: 'inset 0 0 10px rgba(255,255,255,0.01)',
                      transition: 'all 0.3s'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--nash-chartreuse)', marginBottom: 8, letterSpacing: 1, fontWeight: 'bold' }}>
                        <span style={{ fontSize: '1.2rem' }}>{c.icon}</span> {c.title}
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {c.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

