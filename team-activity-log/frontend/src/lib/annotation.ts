import type { Shape } from "../api/contract";

// Annotations are vectors in normalized image coordinates (0..1), so they're non-destructive,
// re-editable, resolution-independent, and searchable (text shapes) — §W2.4.

export type Pt = [number, number];

/** Stroke width in image pixels for a shape on an image `w` pixels wide. */
export const strokePx = (s: Shape, w: number) => Math.max(1, s.size * w) * (s.tool === "highlight" ? 6 : 1);
export const fontPx = (s: Shape, w: number) => Math.max(10, s.size * w * 7);

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Bounds in normalized coordinates (text gets an approximate box). */
export function bounds(s: Shape, aspect = 1): { x0: number; y0: number; x1: number; y1: number } {
  if (s.tool === "text") {
    const [x, y] = s.points[0];
    const h = s.size * 7 * aspect;
    const w = (s.text?.length ?? 1) * s.size * 7 * 0.55;
    return { x0: x, y0: y - h, x1: x + w, y1: y + h * 0.25 };
  }
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Is point `p` on shape `s`? `tol` is in normalized units. `aspect` = width / height, used to
 * measure distances in a space where x and y have the same scale.
 */
export function hitTest(s: Shape, p: Pt, tol: number, aspect = 1): boolean {
  const sc = (q: Pt): Pt => [q[0] * aspect, q[1]];
  const P = sc(p);
  const pts = s.points.map(sc);
  const t = tol * aspect + (s.size * aspect * (s.tool === "highlight" ? 6 : 1)) / 2;
  switch (s.tool) {
    case "pen":
    case "highlight":
      return pts.some((q, i) => i > 0 && segDist(P, pts[i - 1], q) <= t) || (pts.length === 1 && dist(P, pts[0]) <= t);
    case "line":
    case "arrow":
      return segDist(P, pts[0], pts[1] ?? pts[0]) <= t;
    case "rect": {
      const [a, b] = [pts[0], pts[1] ?? pts[0]];
      const c: Pt[] = [a, [b[0], a[1]], b, [a[0], b[1]]];
      return c.some((q, i) => segDist(P, q, c[(i + 1) % 4]) <= t);
    }
    case "ellipse": {
      const [a, b] = [pts[0], pts[1] ?? pts[0]];
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(b[0] - a[0]) / 2 || 1e-6;
      const ry = Math.abs(b[1] - a[1]) / 2 || 1e-6;
      const k = Math.hypot((P[0] - cx) / rx, (P[1] - cy) / ry);
      return Math.abs(k - 1) * Math.min(rx, ry) <= t;
    }
    case "text": {
      const b = bounds(s, aspect);
      return p[0] >= b.x0 - tol && p[0] <= b.x1 + tol && p[1] >= b.y0 - tol && p[1] <= b.y1 + tol;
    }
  }
}

export const moveShape = (s: Shape, dx: number, dy: number): Shape => ({
  ...s,
  points: s.points.map(([x, y]) => [x + dx, y + dy] as Pt),
});

/** Drop near-duplicate points from a freehand stroke (keeps stored annotations small). */
export function simplify(points: Pt[], minStep = 0.002): Pt[] {
  if (points.length < 3) return points;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (dist(points[i], out[out.length - 1]) >= minStep) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}

/** SVG path for a freehand stroke, smoothed with quadratic curves through midpoints. */
export function smoothPath(pts: Pt[], w: number, h: number): string {
  if (!pts.length) return "";
  const P = pts.map(([x, y]) => [x * w, y * h]);
  if (P.length < 3) return `M${P[0][0]},${P[0][1]} ${P.map((p) => `L${p[0]},${p[1]}`).join(" ")}`;
  let d = `M${P[0][0]},${P[0][1]}`;
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2;
    const my = (P[i][1] + P[i + 1][1]) / 2;
    d += ` Q${P[i][0]},${P[i][1]} ${mx},${my}`;
  }
  const last = P[P.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

/** Arrow head triangle points at the end of a→b. */
export function arrowHead(a: Pt, b: Pt, w: number, h: number, stroke: number): string {
  const ax = a[0] * w,
    ay = a[1] * h,
    bx = b[0] * w,
    by = b[1] * h;
  const ang = Math.atan2(by - ay, bx - ax);
  const len = Math.max(10, stroke * 4.5);
  const p1 = [bx - len * Math.cos(ang - Math.PI / 7), by - len * Math.sin(ang - Math.PI / 7)];
  const p2 = [bx - len * Math.cos(ang + Math.PI / 7), by - len * Math.sin(ang + Math.PI / 7)];
  return `${bx},${by} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`;
}

export const annotationText = (shapes: Shape[]) => shapes.map((s) => s.text ?? "").filter(Boolean).join(" ");
