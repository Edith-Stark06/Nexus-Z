/**
 * Cursor physics for the landing-page illustration (pure functions, no DOM).
 *
 * Every node has a rest position. The cursor pulls nearby nodes toward it, a spring brings them home
 * and damping stops them swinging. Smaller nodes move more than larger ones. Displacement is capped,
 * so the picture can never be dragged apart.
 */
export const DEFAULTS = { radius: 120, pull: 0.5, spring: 0.09, damping: 0.8, maxShift: 26 };

export function makeNodes(points) {
  return points.map((p) => ({ ...p, rx: p.x, ry: p.y, x: p.x, y: p.y, vx: 0, vy: 0 }));
}

/** Advance every node one step. `pointer` is {x, y} in the picture's coordinates, or null when the cursor is away. */
export function stepNodes(nodes, pointer, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  for (const n of nodes) {
    let fx = (n.rx - n.x) * o.spring;
    let fy = (n.ry - n.y) * o.spring;
    if (pointer) {
      const dx = pointer.x - n.x;
      const dy = pointer.y - n.y;
      const d = Math.hypot(dx, dy);
      if (d < o.radius && d > 0.001) {
        const strength = (1 - d / o.radius) ** 2 * o.pull * (10 / (n.r || 8));
        fx += (dx / d) * strength * 4;
        fy += (dy / d) * strength * 4;
      }
    }
    n.vx = (n.vx + fx) * o.damping;
    n.vy = (n.vy + fy) * o.damping;
    n.x += n.vx;
    n.y += n.vy;
    const sx = n.x - n.rx;
    const sy = n.y - n.ry;
    const shift = Math.hypot(sx, sy);
    if (shift > o.maxShift) {
      n.x = n.rx + (sx / shift) * o.maxShift;
      n.y = n.ry + (sy / shift) * o.maxShift;
    }
  }
  return nodes;
}

/** True when every node is at rest (used to stop the animation loop while nothing moves). */
export function settled(nodes, eps = 0.02) {
  return nodes.every((n) => Math.hypot(n.x - n.rx, n.y - n.ry) < eps && Math.hypot(n.vx, n.vy) < eps);
}

/** Position of a travelling dot a fraction t of the way from node a to node b. */
export function along(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
