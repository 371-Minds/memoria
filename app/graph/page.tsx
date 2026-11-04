'use client';

/**
 * Memory graph.
 *
 * The previous attempt at this went badly for a reason worth writing down: it
 * asked a force layout to draw the whole graph. A force layout is O(n²) per tick
 * and the browser has one thread, so past a few hundred nodes the page stops
 * responding instead of getting slower.
 *
 * So this page asks the server for a *neighbourhood* (`/graph?center=…&depth=1`),
 * caps it at 200 nodes, and runs a small simulation on canvas with no
 * dependencies. Click a node to re-centre the graph on it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type Node = { id: string; mref: string; label: string; createdAt: number; current: boolean; version: number };
type Edge = { from: string; to: string; kind: string; weight: number };

const WIDTH = 900;
const HEIGHT = 560;

export default function GraphPage() {
  const [userId, setUserId] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const pos = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);

  const load = useCallback(
    async (id: string, center?: string) => {
      if (!id.trim()) return;
      try {
        const q = new URLSearchParams({ limit: '200', depth: '1' });
        if (center) q.set('center', center);
        const res = await fetch(`/api/memory/${encodeURIComponent(id)}/graph?${q}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setNodes(body.nodes || []);
        setEdges(body.edges || []);
        setTruncated(!!body.truncated);
        setError(null);
        // seed positions in a circle; the simulation takes it from there
        const map = new Map<string, { x: number; y: number; vx: number; vy: number }>();
        (body.nodes || []).forEach((n: Node, i: number, all: Node[]) => {
          const a = (i / Math.max(1, all.length)) * Math.PI * 2;
          map.set(n.id, { x: WIDTH / 2 + Math.cos(a) * 180, y: HEIGHT / 2 + Math.sin(a) * 180, vx: 0, vy: 0 });
        });
        pos.current = map;
      } catch (e: any) {
        setError(e.message);
      }
    },
    []
  );

  // Simulation + draw. Runs only when the data changes; a tick loop that redraws
  // forever is the other way these pages melt a laptop.
  useEffect(() => {
    const c = canvas.current;
    if (!c || nodes.length === 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const p = pos.current;
    const index = new Map(nodes.map((n) => [n.id, n]));
    let frames = 0;

    const step = () => {
      // repulsion (bounded: 200 nodes = 20k pairs, fine at 60fps for a few ticks)
      const ids = nodes.map((n) => n.id);
      for (let i = 0; i < ids.length; i++) {
        const a = p.get(ids[i])!;
        for (let j = i + 1; j < ids.length; j++) {
          const b = p.get(ids[j])!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy || 0.01;
          if (d2 > 90_000) continue;
          const f = 900 / d2;
          a.vx -= dx * f;
          a.vy -= dy * f;
          b.vx += dx * f;
          b.vy += dy * f;
        }
      }
      // edges act as springs
      for (const e of edges) {
        const a = p.get(e.from);
        const b = p.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const target = 120;
        const f = (d - target) * 0.0015 * (e.kind === 'supersedes' ? 1.6 : 1);
        a.vx += (dx / d) * f * 10;
        a.vy += (dy / d) * f * 10;
        b.vx -= (dx / d) * f * 10;
        b.vy -= (dy / d) * f * 10;
      }
      for (const n of nodes) {
        const a = p.get(n.id)!;
        if (drag.current?.id === n.id) continue;
        a.vx += (WIDTH / 2 - a.x) * 0.002;
        a.vy += (HEIGHT / 2 - a.y) * 0.002;
        a.vx *= 0.85;
        a.vy *= 0.85;
        a.x = Math.max(30, Math.min(WIDTH - 30, a.x + a.vx));
        a.y = Math.max(24, Math.min(HEIGHT - 24, a.y + a.vy));
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      for (const e of edges) {
        const a = p.get(e.from);
        const b = p.get(e.to);
        if (!a || !b) continue;
        ctx.strokeStyle =
          e.kind === 'contradicts'
            ? 'rgba(220,80,80,0.7)'
            : e.kind === 'supersedes'
              ? 'rgba(220,120,60,0.55)'
              : `rgba(120,150,210,${0.15 + e.weight * 0.4})`;
        ctx.lineWidth = e.kind === 'similar' ? 1 : 1.6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const n of nodes) {
        const a = p.get(n.id);
        if (!a) continue;
        ctx.beginPath();
        ctx.arc(a.x, a.y, selected === n.id ? 9 : 6, 0, Math.PI * 2);
        ctx.fillStyle = n.current ? '#4f7cff' : '#8a8f9c';
        ctx.fill();
        ctx.fillStyle = '#c9cfdb';
        ctx.font = '11px ui-sans-serif, system-ui';
        const label = n.label.length > 42 ? n.label.slice(0, 42) + '…' : n.label;
        ctx.fillText(label, a.x + 10, a.y + 4);
      }
      void index;
    };

    const loop = () => {
      step();
      draw();
      frames++;
      if (frames < 240) requestAnimationFrame(loop); // settle, then stop
    };
    requestAnimationFrame(loop);
  }, [nodes, edges, selected]);

  const hit = (x: number, y: number) => {
    for (const n of nodes) {
      const a = pos.current.get(n.id);
      if (a && Math.hypot(a.x - x, a.y - y) < 14) return n.id;
    }
    return null;
  };

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui', color: '#e7eaf0', background: '#0f1115', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Memory graph</h1>
      <p style={{ color: '#8a8f9c', fontSize: 13, marginTop: 0 }}>
        A neighbourhood, not the whole graph. Click a node to re-centre on it. Blue is current, grey is superseded history;
        orange edges are supersessions, red are contradictions.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(userId);
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="userId"
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#171a21', color: '#e7eaf0', width: 220 }}
        />
        <button type="submit" style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1d2330', color: '#e7eaf0', cursor: 'pointer' }}>
          Load
        </button>
        {selected && (
          <button type="button" onClick={() => load(userId, selected)} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1d2330', color: '#e7eaf0', cursor: 'pointer' }}>
            Centre on selection
          </button>
        )}
      </form>
      {error && <p style={{ color: '#ff8a8a' }}>{error}</p>}
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: '1px solid #232833', borderRadius: 10, background: '#12151b', cursor: 'pointer', maxWidth: '100%' }}
        onMouseDown={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const id = hit(e.clientX - r.left, e.clientY - r.top);
          if (id) {
            setSelected(id);
            drag.current = { id, x: e.clientX, y: e.clientY };
          }
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const a = pos.current.get(d.id);
          if (a) {
            a.x = e.clientX - r.left;
            a.y = e.clientY - r.top;
          }
        }}
        onMouseUp={() => (drag.current = null)}
      />
      <p style={{ color: '#8a8f9c', fontSize: 12 }}>
        {nodes.length} nodes, {edges.length} edges{truncated ? ' — node cap reached, centre on a node to see further' : ''}
      </p>
    </main>
  );
}
