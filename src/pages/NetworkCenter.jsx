import { useState, useEffect } from 'react';
import { useApp } from '../App';

const QOS_INFO = [
  { level: 0, name: 'QoS 0 — At Most Once', desc: 'Fire and forget. No acknowledgment. Fastest but unreliable. Like UDP.', color: '#00E5FF' },
  { level: 1, name: 'QoS 1 — At Least Once', desc: 'Message acknowledged by receiver. May deliver duplicates. Balanced reliability.', color: '#FFC85C' },
  { level: 2, name: 'QoS 2 — Exactly Once', desc: 'Four-step handshake guarantees exactly one delivery. Slowest but most reliable.', color: '#FF653F' },
];

const NETWORK_CONCEPTS = [
  { title: 'ESP-NOW Protocol', icon: '', desc: 'Peer-to-peer WiFi protocol by Espressif. No router needed. Low latency (~1ms), 250-byte payload. Perfect for mesh networks.' },
  { title: 'Mesh Topology', icon: '', desc: 'Every node can communicate with multiple peers. Self-healing: if one path fails, data routes through alternatives. High redundancy.' },
  { title: 'Distance Vector Routing', icon: '', desc: 'Each node maintains a table of distances to all destinations. Nodes share tables with neighbors. Bellman-Ford equation: Dx(y) = min{c(x,v) + Dv(y)}' },
  { title: 'TCP vs UDP', icon: '', desc: 'TCP: Connection-oriented, reliable, ordered. UDP: Connectionless, fast, no guarantees. Mesh uses UDP-like (ESP-NOW) for speed + application-level reliability.' },
  { title: 'MQTT Protocol', icon: '', desc: 'Publish/Subscribe messaging for IoT. Lightweight, supports QoS levels 0-2. Broker-based architecture. Used for sensor data aggregation.' },
  { title: 'Packet Flooding', icon: '', desc: 'Broadcast a packet to all neighbors. Each node rebroadcasts once. Guarantees delivery but generates O(E) messages. TTL limits propagation.' },
  { title: 'TTL (Time To Live)', icon: '', desc: 'Counter decremented at each hop. Packet dropped when TTL=0. Prevents infinite loops. Recurrence: TTL(n+1) = TTL(n) - 1, base case: drop when 0.' },
  { title: 'Heartbeat Mechanism', icon: '', desc: 'Periodic "alive" messages between nodes. If missed for N intervals, node marked as failed. Triggers self-healing rerouting.' },
];

export default function NetworkCenter() {
  const { graph, sim } = useApp();
  const [selectedNode, setSelectedNode] = useState('A');
  const [, setTick] = useState(0);
  const [packetHistory] = useState(() => []);
  const [viewTab, setViewTab] = useState('routing');

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
    header: 'ESP-NOW Frame',
    fields: [
      { name: 'Source MAC', value: 'AA:BB:CC:DD:EE:' + selectedNode.charCodeAt(0).toString(16).toUpperCase(), bytes: 6, color: '#FF653F' },
      { name: 'Dest MAC', value: 'FF:FF:FF:FF:FF:FF', bytes: 6, color: '#FFC85C' },
      { name: 'Msg Type', value: '0x01 (DATA)', bytes: 1, color: '#00E5FF' },
      { name: 'TTL', value: '10', bytes: 1, color: '#39FF14' },
      { name: 'QoS', value: '1', bytes: 1, color: '#FFC85C' },
      { name: 'Seq Number', value: '0x002A', bytes: 2, color: '#448AFF' },
      { name: 'Payload', value: '{"temp":42.5,"gas":320}', bytes: 32, color: '#a89cc8' },
      { name: 'Checksum', value: '0xF7E2', bytes: 2, color: '#FF653F' },
    ],
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title glow-text-cyan">Network Intelligence Center</h1>
        <div className="page-controls">
          <select
            value={selectedNode}
            onChange={e => setSelectedNode(e.target.value)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.75rem', background: 'rgba(10,6,24,0.6)',
              color: 'var(--neon-cyan)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '4px 8px',
            }}
          >
            {nodeIds.map(id => (
              <option key={id} value={id}>{graph.nodes.get(id)?.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* View Tabs */}
      <div className="algo-tabs" style={{ marginBottom: 12 }}>
        {[
          { key: 'routing', label: 'Routing Tables' },
          { key: 'packets', label: 'Packet Flow' },
          { key: 'anatomy', label: 'Packet Anatomy' },
          { key: 'matrix', label: 'Adjacency Matrix' },
          { key: 'qos', label: 'QoS & MQTT' },
          { key: 'concepts', label: 'CN Concepts' },
        ].map(t => (
          <button key={t.key} className={`algo-tab ${viewTab === t.key ? 'active' : ''}`} onClick={() => setViewTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="network-layout" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
        {/* ROUTING TABLES */}
        {viewTab === 'routing' && (
          <div className="panel glass-panel animate-slide-in">
            <div className="section-header">Distance Vector Routing Table — {graph.nodes.get(selectedNode)?.label}</div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12 }}>
              Computed using <strong style={{ color: 'var(--neon-orange)' }}>Dijkstra's Algorithm</strong>. Each node maintains this table and shares it with neighbors (Distance Vector protocol).
            </p>
            <table className="data-table">
              <thead>
                <tr><th>Destination</th><th>Next Hop</th><th>Cost (Latency)</th><th>Hops</th><th>Full Path</th></tr>
              </thead>
              <tbody>
                {routingTable.map(r => (
                  <tr key={r.destination}>
                    <td style={{ color: 'var(--neon-cyan)' }}>{r.destLabel}</td>
                    <td style={{ color: 'var(--warm-yellow)' }}>{r.nextHopLabel}</td>
                    <td>{r.distance === Infinity ? '∞' : r.distance.toFixed(1)}</td>
                    <td>{r.hopCount}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.path.map(id => graph.nodes.get(id)?.label).join(' → ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PACKET FLOW */}
        {viewTab === 'packets' && (
          <div className="panel glass-panel animate-slide-in">
            <div className="section-header">Live Packet Stream</div>
            <div className="stat-strip" style={{ marginBottom: 12 }}>
              <div className="stat-card glass-panel"><div className="stat-label">Total Sent</div><div className="stat-value cyan">{sim.stats.totalPacketsSent}</div></div>
              <div className="stat-card glass-panel"><div className="stat-label">Delivered</div><div className="stat-value green">{sim.stats.totalPacketsDelivered}</div></div>
              <div className="stat-card glass-panel"><div className="stat-label">Dropped</div><div className="stat-value" style={{ color: 'var(--neon-red)' }}>{sim.stats.totalPacketsDropped}</div></div>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {recentPackets.map(pkt => (
                <div key={pkt.id} className="packet-item animate-slide-in">
                  <span className="packet-dot" style={{ background: pkt.getPriorityColor() }} />
                  <span>{pkt.getTypeIcon()}</span>
                  <span style={{ color: 'var(--neon-cyan)' }}>#{pkt.id}</span>
                  <span style={{ color: 'var(--warm-yellow)' }}>{pkt.type}</span>
                  <span>QoS:{pkt.qos}</span>
                  <span style={{ color: 'var(--text-muted)' }}>TTL:{pkt.ttl}</span>
                  <span>{graph.nodes.get(pkt.source)?.label} → {graph.nodes.get(pkt.destination)?.label}</span>
                  <span className={`badge ${pkt.status === 'delivered' ? 'badge-green' : pkt.status === 'dropped' ? 'badge-red' : 'badge-cyan'}`}>
                    {pkt.status}
                  </span>
                </div>
              ))}
              {recentPackets.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', textAlign: 'center', padding: 30 }}>
                  No packets yet. Start the simulation from Command Center.
                </div>
              )}
            </div>
          </div>
        )}

        {/* PACKET ANATOMY */}
        {viewTab === 'anatomy' && (
          <div className="panel glass-panel animate-slide-in">
            <div className="section-header">Packet Structure — {samplePacket.header}</div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Each packet in the mesh network contains these fields. Click to understand each field's role.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {samplePacket.fields.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  background: `${f.color}10`, borderLeft: `3px solid ${f.color}`, borderRadius: 4,
                }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.6rem', color: f.color, minWidth: 100, letterSpacing: 1 }}>
                    {f.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-primary)', flex: 1 }}>
                    {f.value}
                  </span>
                  <span className="badge" style={{ background: `${f.color}20`, color: f.color, border: `1px solid ${f.color}40` }}>
                    {f.bytes}B
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Total Frame Size: {samplePacket.fields.reduce((s, f) => s + f.bytes, 0)} bytes | Max ESP-NOW payload: 250 bytes
            </div>
          </div>
        )}

        {/* ADJACENCY MATRIX */}
        {viewTab === 'matrix' && (
          <div className="panel glass-panel animate-slide-in">
            <div className="section-header">Adjacency Matrix (Weighted)</div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12 }}>
              <strong style={{ color: 'var(--warm-yellow)' }}>Discrete Mathematics</strong>: The adjacency matrix A[i][j] stores edge weights. ∞ means no direct connection. Used for matrix-based graph algorithms.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ textAlign: 'center' }}>
                <thead>
                  <tr><th></th>{matrixIds.map(id => <th key={id} style={{ color: 'var(--neon-cyan)' }}>{graph.nodes.get(id)?.label}</th>)}</tr>
                </thead>
                <tbody>
                  {matrix.map((row, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--neon-cyan)', fontFamily: 'var(--font-display)' }}>{graph.nodes.get(matrixIds[i])?.label}</td>
                      {row.map((val, j) => (
                        <td key={j} style={{
                          color: val === 0 ? 'var(--text-muted)' : val === Infinity ? 'var(--text-muted)' : 'var(--neon-orange)',
                          fontFamily: 'var(--font-mono)',
                        }}>
                          {val === 0 ? '0' : val === Infinity ? '∞' : val}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Adjacency List */}
            <div className="section-header" style={{ marginTop: 20 }}>Adjacency List</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
              {nodeIds.map(id => (
                <div key={id} style={{ marginBottom: 4, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--neon-cyan)' }}>{graph.nodes.get(id)?.label}</span>
                  {' → '}
                  {graph.getNeighbors(id).map(n => (
                    <span key={n.nodeId}>
                      <span style={{ color: 'var(--warm-yellow)' }}>{graph.nodes.get(n.nodeId)?.label}</span>
                      (<span style={{ color: 'var(--neon-orange)' }}>{n.weight}</span>){' '}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            {/* Graph stats */}
            <div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <span>|V| = {graph.nodes.size}</span>
              <span>|E| = {graph.edges.length}</span>
              <span>Density = {(graph.getStats().density * 100).toFixed(1)}%</span>
              <span>Avg Degree = {graph.nodes.size > 0 ? ((2 * graph.edges.length) / graph.nodes.size).toFixed(1) : 0}</span>
            </div>
          </div>
        )}

        {/* QoS & MQTT */}
        {viewTab === 'qos' && (
          <div className="panel glass-panel animate-slide-in">
            <div className="section-header">QoS Levels and MQTT</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {QOS_INFO.map(q => (
                <div key={q.level} style={{
                  padding: 14, borderRadius: 'var(--radius-sm)',
                  background: `${q.color}08`, borderLeft: `3px solid ${q.color}`,
                }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.75rem', color: q.color, marginBottom: 4, letterSpacing: 1 }}>
                    {q.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {q.desc}
                  </div>
                </div>
              ))}
            </div>
            <div className="section-header" style={{ marginTop: 20 }}>Priority Queue Behavior</div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Packets with <strong style={{ color: '#FF653F' }}>QoS 2 (High)</strong> are dequeued first, then <strong style={{ color: '#FFC85C' }}>QoS 1 (Medium)</strong>, then <strong style={{ color: '#00E5FF' }}>QoS 0 (Low)</strong>. SOS messages always get highest priority.
            </p>
          </div>
        )}

        {/* CN CONCEPTS */}
        {viewTab === 'concepts' && (
          <div className="panel glass-panel animate-slide-in">
            <div className="section-header">Computer Networks — Core Concepts</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
              {NETWORK_CONCEPTS.map((c, i) => (
                <div key={i} style={{
                  padding: 14, borderRadius: 'var(--radius-sm)',
                  background: 'rgba(10,6,24,0.4)', border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.7rem', color: 'var(--neon-orange)', marginBottom: 6, letterSpacing: 1 }}>
                    {c.icon} {c.title}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {c.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
