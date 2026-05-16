import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Landing() {
  const canvasRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let nodes = [];
    let packets = [];
    const COLORS = { orange: '#FF653F', yellow: '#FFC85C', cyan: '#00E5FF', purple: '#452E5A' };

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create floating mesh nodes
    for (let i = 0; i < 30; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: 3 + Math.random() * 4,
        pulse: Math.random() * Math.PI * 2,
        color: [COLORS.orange, COLORS.yellow, COLORS.cyan][Math.floor(Math.random() * 3)],
      });
    }

    function spawnPacket() {
      if (nodes.length < 2) return;
      const a = Math.floor(Math.random() * nodes.length);
      let b = a;
      while (b === a) b = Math.floor(Math.random() * nodes.length);
      packets.push({
        sx: nodes[a].x, sy: nodes[a].y,
        ex: nodes[b].x, ey: nodes[b].y,
        t: 0,
        color: [COLORS.orange, COLORS.cyan, COLORS.yellow][Math.floor(Math.random() * 3)],
      });
    }

    let time = 0;
    function draw() {
      time += 0.016;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw edges between nearby nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 200) {
            const alpha = (1 - dist / 200) * 0.15;
            ctx.strokeStyle = `rgba(255,101,63,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw and update nodes
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
        n.pulse += 0.02;
        const scale = 1 + Math.sin(n.pulse) * 0.3;

        // Glow
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4 * scale);
        grad.addColorStop(0, n.color + '40');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 4 * scale, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw packets
      if (Math.random() < 0.03) spawnPacket();
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.t += 0.012;
        if (p.t > 1) { packets.splice(i, 1); continue; }
        const x = p.sx + (p.ex - p.sx) * p.t;
        const y = p.sy + (p.ey - p.sy) * p.t;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Radar sweep
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const rr = Math.min(canvas.width, canvas.height) * 0.35;
      const angle = time * 0.5;
      const sweepGrad = ctx.createConicalGradient ? null : null;
      ctx.strokeStyle = `rgba(255,101,63,0.06)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
      // Sweep line
      ctx.strokeStyle = `rgba(255,101,63,0.15)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr);
      ctx.stroke();

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="landing-page">
      <canvas ref={canvasRef} className="landing-canvas" />
      <div className="landing-grid-overlay" />
      <div className="landing-scanline" />
      <div className="landing-content animate-fade-in">
        <div className="landing-subtitle">Intelligent Self-Healing Disaster Communication</div>
        <h1 className="landing-title">
          <span style={{ color: 'var(--neon-orange)' }}>ResQ</span>Mesh
        </h1>
        <div className="landing-subtitle" style={{ marginBottom: 12, fontSize: '0.85rem', letterSpacing: 3 }}>
          Rescue Routing System
        </div>
        <p className="landing-desc" style={{ fontSize: '1.1rem', maxWidth: '800px', lineHeight: '1.6' }}>
          An Interactive Graph-Theory, Networking, and IoT Disaster Intelligence Platform.
          Explore algorithms, visualize mesh networks, and simulate disaster rescue operations.
        </p>
        <div className="landing-buttons">
          <button className="btn btn-primary" onClick={() => navigate('/command')}>
            Launch Simulation
          </button>
          <button className="btn btn-yellow" onClick={() => navigate('/algorithms')}>
            Explore Algorithms
          </button>
          <button className="btn btn-cyan" onClick={() => navigate('/network')}>
            Network Center
          </button>
        </div>
      </div>
    </div>
  );
}
