import {
  ArrowRightAlt,
  AutoFixNormal,
  ClearAll,
  Close,
  Edit,
  Highlight,
  HorizontalRule,
  NearMeOutlined,
  RadioButtonUnchecked,
  Rectangle,
  Redo,
  TextFields,
  Undo,
} from "@mui/icons-material";
import { Box, Button, Dialog, Divider, IconButton, Slider, Stack, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from "react";
import type { ImageView, Shape, ShapeTool } from "../../api/contract";
import { ShapeView } from "../../components/AnnotationLayer";
import { bounds, hitTest, moveShape, simplify, type Pt } from "../../lib/annotation";
import { uuidv7 } from "../../lib/ids";
import { useFit } from "../../lib/useFit";

// §W2.4: non-destructive vector annotation. Keeps v0's tool set, palette, and shortcuts
// (P L R E A T H X), adds select/move (V) and redo; output is Shape[] (normalized coords).

type Tool = ShapeTool | "eraser" | "select";

const TOOLS: { key: Tool; label: string; kbd: string; Icon: ElementType }[] = [
  { key: "select", label: "Select / move", kbd: "V", Icon: NearMeOutlined },
  { key: "pen", label: "Pen", kbd: "P", Icon: Edit },
  { key: "line", label: "Line", kbd: "L", Icon: HorizontalRule },
  { key: "rect", label: "Rectangle", kbd: "R", Icon: Rectangle },
  { key: "ellipse", label: "Ellipse", kbd: "E", Icon: RadioButtonUnchecked },
  { key: "arrow", label: "Arrow", kbd: "A", Icon: ArrowRightAlt },
  { key: "text", label: "Text", kbd: "T", Icon: TextFields },
  { key: "highlight", label: "Highlighter", kbd: "H", Icon: Highlight },
  { key: "eraser", label: "Eraser", kbd: "X", Icon: AutoFixNormal },
];
const PALETTE = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#111827", "#ffffff"];
const SIZES = { min: 1, max: 12 };

interface Props {
  image: ImageView;
  open: boolean;
  onClose: () => void;
  onSave: (shapes: Shape[]) => void;
  saving?: boolean;
}

export function Annotator({ image, open, onClose, onSave, saving }: Props) {
  const initial = useMemo(() => image.annotation?.shapes ?? [], [image]);
  const [history, setHistory] = useState<Shape[][]>([initial]);
  const [cursor, setCursor] = useState(0);
  const shapes = history[cursor];
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(PALETTE[0]);
  const [size, setSize] = useState(3);
  const [opacity, setOpacity] = useState(1);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [textAt, setTextAt] = useState<Pt | null>(null);
  const [text, setText] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: Pt; last: Pt; erased: Set<string> } | null>(null);

  const W = image.asset.width;
  const H = image.asset.height;
  const aspect = W / H;
  const original = image.asset.variants.find((v) => v.name === "original") ?? image.asset.variants[0];
  const dirty = cursor !== 0 || history.length > 1;
  const fit = useFit<HTMLDivElement>(aspect);

  const commit = useCallback(
    (next: Shape[]) => {
      setHistory((h) => [...h.slice(0, cursor + 1), next].slice(-100));
      setCursor((c) => Math.min(c + 1, 99));
    },
    [cursor],
  );
  const undo = useCallback(() => setCursor((c) => Math.max(0, c - 1)), []);
  const redo = useCallback(() => setCursor((c) => Math.min(history.length - 1, c + 1)), [history.length]);

  // Stroke size is stored relative to image width so it looks the same at any resolution.
  const relSize = size / 1000;

  const toNorm = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const tol = () => 8 / (svgRef.current?.getBoundingClientRect().width ?? 800);
  const topHit = (p: Pt) => [...shapes].reverse().find((s) => hitTest(s, p, tol(), aspect));

  const onDown = (e: React.PointerEvent) => {
    if (textAt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toNorm(e);
    if (tool === "text") {
      setTextAt(p);
      setText("");
      return;
    }
    if (tool === "select") {
      const hit = topHit(p);
      setSelected(hit?.id ?? null);
      drag.current = hit ? { start: p, last: p, erased: new Set() } : null;
      return;
    }
    if (tool === "eraser") {
      drag.current = { start: p, last: p, erased: new Set() };
      const hit = topHit(p);
      if (hit) drag.current.erased.add(hit.id);
      return;
    }
    drag.current = { start: p, last: p, erased: new Set() };
    setDraft({ id: uuidv7(), tool, color, opacity, size: relSize, points: [p, p] });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toNorm(e);
    if (tool === "select" && selected) {
      const [dx, dy] = [p[0] - drag.current.last[0], p[1] - drag.current.last[1]];
      drag.current.last = p;
      // Live move without a history entry per pixel; committed on pointer up.
      setHistory((h) => h.map((snap, i) => (i === cursor ? snap.map((s) => (s.id === selected ? moveShape(s, dx, dy) : s)) : snap)));
      return;
    }
    if (tool === "eraser") {
      const hit = topHit(p);
      if (hit) drag.current.erased.add(hit.id);
      drag.current.last = p;
      return;
    }
    setDraft((d) => (d ? { ...d, points: d.tool === "pen" || d.tool === "highlight" ? [...d.points, p] : [d.points[0], p] } : d));
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (tool === "select" && selected && (d.last[0] !== d.start[0] || d.last[1] !== d.start[1])) {
      // Turn the live move into one undoable step.
      const moved = shapes;
      const before = moved.map((s) => (s.id === selected ? moveShape(s, d.start[0] - d.last[0], d.start[1] - d.last[1]) : s));
      setHistory((h) => [...h.slice(0, cursor), before, moved]);
      setCursor((c) => c + 1);
      return;
    }
    if (tool === "eraser") {
      if (d.erased.size) commit(shapes.filter((s) => !d.erased.has(s.id)));
      return;
    }
    if (draft) {
      const pts = draft.tool === "pen" || draft.tool === "highlight" ? simplify(draft.points as Pt[]) : draft.points;
      const tiny = pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 0.004;
      if (!tiny || draft.tool === "pen") commit([...shapes, { ...draft, points: pts }]);
      setDraft(null);
    }
  };

  const commitText = () => {
    if (textAt && text.trim()) commit([...shapes, { id: uuidv7(), tool: "text", color, opacity, size: relSize, points: [textAt], text: text.trim() }]);
    setTextAt(null);
    setText("");
  };

  // Restyle the selected shape when color/size change.
  const restyle = (patch: Partial<Shape>) => {
    if (tool === "select" && selected) commit(shapes.map((s) => (s.id === selected ? { ...s, ...patch } : s)));
  };

  useEffect(() => {
    if (!open) return;
    const map = Object.fromEntries(TOOLS.map((t) => [t.kbd.toLowerCase(), t.key]));
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        commit(shapes.filter((s) => s.id !== selected));
        setSelected(null);
        return;
      }
      if (mod || e.altKey) return;
      const t = map[e.key.toLowerCase()];
      if (t) {
        setTool(t);
        if (t !== "select") setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, undo, redo, selected, shapes, commit]);

  const cursorStyle = tool === "text" ? "text" : tool === "select" ? "default" : tool === "eraser" ? "cell" : "crosshair";
  const sel = shapes.find((s) => s.id === selected);
  const selBox = sel ? bounds(sel, aspect) : null;

  return (
    <Dialog open={open} onClose={onClose} fullScreen slotProps={{ paper: { "aria-label": "Annotate image", sx: { bgcolor: "#0d0f12", color: "#e6e8eb" } } as object }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid #262a31", flexWrap: "wrap", rowGap: 0.5 }}>
        <Typography variant="overline" sx={{ color: "#8ea2ff", mr: 1 }}>Annotate</Typography>
        <Stack direction="row" spacing={0.25} role="toolbar" aria-label="Tools">
          {TOOLS.map(({ key, label, kbd, Icon }) => (
            <Tooltip key={key} title={`${label} (${kbd})`}>
              <IconButton
                size="small"
                aria-pressed={tool === key}
                aria-label={label}
                onClick={() => (setTool(key), key !== "select" && setSelected(null))}
                sx={{ color: tool === key ? "#0d0f12" : "#c2c7cf", bgcolor: tool === key ? "#8ea2ff" : "transparent", borderRadius: 1, "&:hover": { bgcolor: tool === key ? "#a5b4ff" : "rgba(255,255,255,0.08)" } }}
              >
                <Icon fontSize="small" />
              </IconButton>
            </Tooltip>
          ))}
        </Stack>
        <Divider flexItem orientation="vertical" sx={{ borderColor: "#262a31" }} />
        <Stack direction="row" spacing={0.5} alignItems="center" role="radiogroup" aria-label="Color">
          {PALETTE.map((c) => (
            <Box
              key={c}
              component="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => (setColor(c), restyle({ color: c }))}
              sx={{ width: 18, height: 18, p: 0, borderRadius: "50%", bgcolor: c, cursor: "pointer", border: color === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.3)", outline: color === c ? `2px solid ${c}` : "none", outlineOffset: 1 }}
            />
          ))}
        </Stack>
        <Divider flexItem orientation="vertical" sx={{ borderColor: "#262a31" }} />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ width: 150 }}>
          <Typography variant="caption" sx={{ color: "#8a929c" }}>Size</Typography>
          <Slider size="small" min={SIZES.min} max={SIZES.max} value={size} onChange={(_, v) => setSize(v as number)} onChangeCommitted={(_, v) => restyle({ size: (v as number) / 1000 })} aria-label="Stroke size" />
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ width: 160 }}>
          <Typography variant="caption" sx={{ color: "#8a929c" }}>Opacity</Typography>
          <Slider size="small" min={0.1} max={1} step={0.05} value={opacity} onChange={(_, v) => setOpacity(v as number)} onChangeCommitted={(_, v) => restyle({ opacity: v as number })} aria-label="Opacity" />
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Undo (⌘Z)"><span><IconButton size="small" onClick={undo} disabled={cursor === 0} sx={{ color: "#c2c7cf" }} aria-label="Undo"><Undo fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Redo (⇧⌘Z)"><span><IconButton size="small" onClick={redo} disabled={cursor >= history.length - 1} sx={{ color: "#c2c7cf" }} aria-label="Redo"><Redo fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Clear all"><span><IconButton size="small" onClick={() => commit([])} disabled={!shapes.length} sx={{ color: "#c2c7cf" }} aria-label="Clear all"><ClearAll fontSize="small" /></IconButton></span></Tooltip>
        <Button size="small" onClick={onClose} sx={{ color: "#c2c7cf" }} startIcon={<Close />}>Cancel</Button>
        <Button size="small" variant="contained" disabled={!dirty || saving} onClick={() => onSave(shapes)}>
          Save
        </Button>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, p: 2, display: "flex" }}>
        <Box ref={fit.ref} sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "grid", placeItems: "center", overflow: "hidden" }}>
        <Box sx={{ position: "relative", width: fit.width, height: fit.height, touchAction: "none" }}>
          <Box component="img" src={original?.url} alt={image.altText ?? ""} draggable={false} sx={{ width: "100%", height: "100%", display: "block", userSelect: "none", bgcolor: image.asset.dominantColors[0] ?? "#222" }} />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: cursorStyle, touchAction: "none" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="img"
            aria-label={`Annotation canvas, ${shapes.length} shapes`}
          >
            {shapes.map((s) => (
              <ShapeView key={s.id} s={s} w={W} h={H} selected={s.id === selected} />
            ))}
            {draft && <ShapeView s={draft} w={W} h={H} />}
            {selBox && (
              <rect x={selBox.x0 * W - 6} y={selBox.y0 * H - 6} width={(selBox.x1 - selBox.x0) * W + 12} height={(selBox.y1 - selBox.y0) * H + 12} fill="none" stroke="#8ea2ff" strokeDasharray="6 4" strokeWidth={Math.max(1, W / 600)} />
            )}
          </svg>
          {textAt && (
            <Box sx={{ position: "absolute", left: `${textAt[0] * 100}%`, top: `${textAt[1] * 100}%`, transform: "translateY(-100%)" }}>
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText();
                  if (e.key === "Escape") setTextAt(null);
                }}
                onBlur={commitText}
                placeholder="Type, then Enter"
                aria-label="Annotation text"
                style={{ background: "rgba(0,0,0,0.8)", border: `2px solid ${color}`, borderRadius: 4, color, padding: "3px 8px", font: "600 15px 'IBM Plex Sans', sans-serif", outline: "none", minWidth: 160 }}
              />
            </Box>
          )}
        </Box>
        </Box>
      </Box>
      <Stack direction="row" spacing={2} sx={{ px: 2, py: 0.75, borderTop: "1px solid #262a31", color: "#8a929c", flexWrap: "wrap" }}>
        <Typography variant="caption">
          {W}×{H}px · {shapes.length} shape{shapes.length === 1 ? "" : "s"} · the original image is never modified
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption">V select · P L R E A T H draw · X erase · Delete removes selection · ⌘Z / ⇧⌘Z</Typography>
      </Stack>
    </Dialog>
  );
}
