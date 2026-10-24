import type { Shape } from "../api/contract";
import { arrowHead, fontPx, smoothPath, strokePx } from "../lib/annotation";

// Renders vector annotations over an image. The SVG uses the image's pixel space as its
// viewBox, so it scales exactly with the image at any display size.

export function ShapeView({ s, w, h, selected }: { s: Shape; w: number; h: number; selected?: boolean }) {
  const sw = strokePx(s, w);
  const common = { stroke: s.color, strokeWidth: sw, strokeOpacity: s.opacity, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const [a, b = s.points[0]] = s.points;
  const glow = selected ? { filter: "drop-shadow(0 0 2px rgba(52,81,209,0.9))" } : undefined;
  switch (s.tool) {
    case "pen":
      return <path d={smoothPath(s.points, w, h)} {...common} style={glow} />;
    case "highlight":
      return <path d={smoothPath(s.points, w, h)} {...common} strokeOpacity={s.opacity * 0.4} strokeLinecap="square" style={{ ...glow, mixBlendMode: "multiply" }} />;
    case "line":
      return <line x1={a[0] * w} y1={a[1] * h} x2={b[0] * w} y2={b[1] * h} {...common} style={glow} />;
    case "arrow":
      return (
        <g style={glow}>
          <line x1={a[0] * w} y1={a[1] * h} x2={b[0] * w} y2={b[1] * h} {...common} />
          <polygon points={arrowHead(a, b, w, h, sw)} fill={s.color} fillOpacity={s.opacity} />
        </g>
      );
    case "rect":
      return <rect x={Math.min(a[0], b[0]) * w} y={Math.min(a[1], b[1]) * h} width={Math.abs(b[0] - a[0]) * w} height={Math.abs(b[1] - a[1]) * h} {...common} style={glow} />;
    case "ellipse":
      return <ellipse cx={((a[0] + b[0]) / 2) * w} cy={((a[1] + b[1]) / 2) * h} rx={(Math.abs(b[0] - a[0]) / 2) * w} ry={(Math.abs(b[1] - a[1]) / 2) * h} {...common} style={glow} />;
    case "text":
      return (
        <text
          x={a[0] * w}
          y={a[1] * h}
          fill={s.color}
          fillOpacity={s.opacity}
          fontSize={fontPx(s, w)}
          fontFamily="'IBM Plex Sans', sans-serif"
          fontWeight={600}
          paintOrder="stroke"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={fontPx(s, w) * 0.12}
          style={glow}
        >
          {s.text}
        </text>
      );
  }
}

export function AnnotationLayer({ shapes, width, height }: { shapes: Shape[]; width: number; height: number }) {
  if (!shapes.length) return null;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden>
      {shapes.map((s) => (
        <ShapeView key={s.id} s={s} w={width} h={height} />
      ))}
    </svg>
  );
}
