import { useRef, useState, useEffect, useCallback } from "react";
import {
  Box,
  Stack,
  IconButton,
  Slider,
  Tooltip,
  Typography,
  Divider,
} from "@mui/material";
import {
  Close,
  Delete,
  Save,
  Undo,
  ClearAll,
  Edit,
  HorizontalRule,
  Rectangle,
  RadioButtonUnchecked,
  ArrowRightAlt,
  TextFields,
  Highlight,
  AutoFixNormal,
} from "@mui/icons-material";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ImageAnnotatorProps {
  imageSrc: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
  onDelete?: (() => void) | undefined;
}

interface TextPos {
  x: number;
  y: number;
}

interface CanvasSize {
  w: number;
  h: number;
}

interface ToolMeta {
  key: string;
  label: string;
  kbd: string;
  Icon: React.ElementType;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PALETTE: string[] = [
  "#f59e0b",
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#f472b6",
  "#a78bfa",
  "#5f5f5f",
  "#000000",
];

const TOOLS = {
  PEN: "pen",
  LINE: "line",
  RECT: "rect",
  ELLIPSE: "ellipse",
  ARROW: "arrow",
  TEXT: "text",
  HIGHLIGHT: "highlight",
  ERASER: "eraser",
} as const;

type ToolKey = (typeof TOOLS)[keyof typeof TOOLS];

const TOOL_META: ToolMeta[] = [
  { key: TOOLS.PEN, label: "Pen", kbd: "P", Icon: Edit },
  { key: TOOLS.LINE, label: "Line", kbd: "L", Icon: HorizontalRule },
  { key: TOOLS.RECT, label: "Rect", kbd: "R", Icon: Rectangle },
  {
    key: TOOLS.ELLIPSE,
    label: "Ellipse",
    kbd: "E",
    Icon: RadioButtonUnchecked,
  },
  { key: TOOLS.ARROW, label: "Arrow", kbd: "A", Icon: ArrowRightAlt },
  { key: TOOLS.TEXT, label: "Text", kbd: "T", Icon: TextFields },
  { key: TOOLS.HIGHLIGHT, label: "Highlight", kbd: "H", Icon: Highlight },
  { key: TOOLS.ERASER, label: "Eraser", kbd: "X", Icon: AutoFixNormal },
];

const FREEHAND_TOOLS: ToolKey[] = [TOOLS.PEN, TOOLS.HIGHLIGHT, TOOLS.ERASER];

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export const ImageAnnotator = ({
  imageSrc,
  onSave,
  onClose,
  onDelete,
}: ImageAnnotatorProps) => {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const [tool, setTool] = useState<ToolKey>(TOOLS.PEN);
  const [color, setColor] = useState<string>("#f59e0b");
  const [brushSize, setBrushSize] = useState<number>(3);
  const [opacity, setOpacity] = useState<number>(1);
  const [textInput, setTextInput] = useState<string>("");
  const [textPos, setTextPos] = useState<TextPos | null>(null);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ w: 700, h: 450 });

  const isDrawing = useRef<boolean>(false);
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Refs so canvas callbacks always read current values without stale closures
  const toolRef = useRef<ToolKey>(tool);
  const colorRef = useRef<string>(color);
  const opacityRef = useRef<number>(opacity);
  const brushSizeRef = useRef<number>(brushSize);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);
  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);

  // ── Load background ──────────────────────────────────────────────────────
  useEffect(() => {
    const bg = bgRef.current;
    if (!bg || !drawRef.current || !overlayRef.current) return;
    const ctx = bg.getContext("2d")!;

    const setSize = (w: number, h: number) => {
      bg.width = w;
      bg.height = h;
      drawRef.current!.width = w;
      drawRef.current!.height = h;
      overlayRef.current!.width = w;
      overlayRef.current!.height = h;
      setCanvasSize({ w, h });
    };

    if (imageSrc) {
      const img = new window.Image();
      img.onload = () => {
        const maxW = 700,
          maxH = 500;
        let w = img.naturalWidth,
          h = img.naturalHeight;
        if (w > maxW) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        }
        if (h > maxH) {
          w = Math.round((w * maxH) / h);
          h = maxH;
        }
        setSize(w, h);
        ctx.drawImage(img, 0, 0, w, h);
      };
      img.src = imageSrc;
    } else {
      setSize(canvasSize.w, canvasSize.h);
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
    }
  }, [canvasSize.h, canvasSize.w, imageSrc]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (!history.length) return;
    const ctx = drawRef.current!.getContext("2d")!;
    ctx.putImageData(history[history.length - 1], 0, 0);
    setHistory((h) => h.slice(0, -1));
  }, [history]);

  const clearAll = () => {
    snapshot();
    const ctx = drawRef.current!.getContext("2d")!;
    ctx.clearRect(0, 0, drawRef.current!.width, drawRef.current!.height);
  };

  useEffect(() => {
    const map = Object.fromEntries(
      TOOL_META.map((t) => [t.kbd.toLowerCase(), t.key as ToolKey]),
    );
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      const t = map[e.key.toLowerCase()];
      if (t) setTool(t);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [history, undo]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getPos = (
    e: React.MouseEvent | React.TouchEvent,
  ): { x: number; y: number } => {
    const canvas = drawRef.current!;
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    const src = (e as React.TouchEvent).touches?.[0] ?? (e as React.MouseEvent);
    return {
      x: ((src as Touch | MouseEvent).clientX - r.left) * sx,
      y: ((src as Touch | MouseEvent).clientY - r.top) * sy,
    };
  };

  const snapshot = () => {
    const ctx = drawRef.current!.getContext("2d")!;
    setHistory((h) => [
      ...h.slice(-30),
      ctx.getImageData(0, 0, drawRef.current!.width, drawRef.current!.height),
    ]);
  };

  // ── applyCtx — reads from refs, no stale closure risk ───────────────────
  const applyCtx = (ctx: CanvasRenderingContext2D) => {
    const t = toolRef.current;
    const c = colorRef.current;
    const o = opacityRef.current;
    const bs = brushSizeRef.current;

    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;

    if (t === TOOLS.ERASER) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = bs * 4;
    } else if (t === TOOLS.HIGHLIGHT) {
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = bs * 8;
      ctx.globalAlpha = o * 0.5;
      ctx.lineCap = "square";
      ctx.lineJoin = "miter";
    } else {
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = bs;
      ctx.globalAlpha = o;
    }
  };

  const resetCtx = (ctx: CanvasRenderingContext2D) => {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  // ── Shape drawing ────────────────────────────────────────────────────────
  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    const bs = brushSizeRef.current;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const hl = Math.max(12, bs * 5);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - hl * Math.cos(a - Math.PI / 7),
      y2 - hl * Math.sin(a - Math.PI / 7),
    );
    ctx.lineTo(
      x2 - hl * Math.cos(a + Math.PI / 7),
      y2 - hl * Math.sin(a + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fill();
  };

  const drawShape = (
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    applyCtx(ctx);
    const t = toolRef.current;
    ctx.beginPath();
    if (t === TOOLS.LINE) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    if (t === TOOLS.RECT) {
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    if (t === TOOLS.ELLIPSE) {
      ctx.ellipse(
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        Math.abs(x2 - x1) / 2,
        Math.abs(y2 - y1) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    if (t === TOOLS.ARROW) {
      drawArrow(ctx, x1, y1, x2, y2);
    }
    resetCtx(ctx);
  };

  // ── Pointer events ───────────────────────────────────────────────────────
  const onDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (toolRef.current === TOOLS.TEXT) {
      setTextPos(getPos(e));
      setTextInput("");
      return;
    }
    isDrawing.current = true;
    const p = getPos(e);
    startPos.current = p;
    lastPos.current = p;
    snapshot();

    if (FREEHAND_TOOLS.includes(toolRef.current)) {
      const ctx = drawRef.current!.getContext("2d")!;
      applyCtx(ctx);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  };

  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const p = getPos(e);

    if (FREEHAND_TOOLS.includes(toolRef.current)) {
      const ctx = drawRef.current!.getContext("2d")!;
      applyCtx(ctx);
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastPos.current = p;
    } else {
      const oCtx = overlayRef.current!.getContext("2d")!;
      oCtx.clearRect(
        0,
        0,
        overlayRef.current!.width,
        overlayRef.current!.height,
      );
      drawShape(oCtx, startPos.current.x, startPos.current.y, p.x, p.y);
    }
  };

  const onUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const p = getPos(e);

    if (!FREEHAND_TOOLS.includes(toolRef.current)) {
      drawShape(
        drawRef.current!.getContext("2d")!,
        startPos.current.x,
        startPos.current.y,
        p.x,
        p.y,
      );
      overlayRef
        .current!.getContext("2d")!
        .clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);
    }
    resetCtx(drawRef.current!.getContext("2d")!);
  };

  // ── Text ─────────────────────────────────────────────────────────────────
  const commitText = () => {
    if (!textInput.trim() || !textPos) return;
    snapshot();
    const ctx = drawRef.current!.getContext("2d")!;
    ctx.font = `${brushSizeRef.current * 6 + 10}px 'IBM Plex Sans', sans-serif`;
    ctx.fillStyle = colorRef.current;
    ctx.globalAlpha = opacityRef.current;
    ctx.fillText(textInput, textPos.x, textPos.y);
    resetCtx(ctx);
    setTextPos(null);
    setTextInput("");
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const out = document.createElement("canvas");
    out.width = bgRef.current!.width;
    out.height = bgRef.current!.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(bgRef.current!, 0, 0);
    ctx.drawImage(drawRef.current!, 0, 0);
    onSave(out.toDataURL("image/png"));
    onClose();
  };

  const cursor =
    tool === TOOLS.TEXT ? "text" : tool === TOOLS.ERASER ? "cell" : "crosshair";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        sx={{
          bgcolor: "background.paper",
          borderRadius: 2,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxWidth: "96vw",
          maxHeight: "96vh",
          boxShadow: 24,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}
        >
          <Typography
            variant="overline"
            sx={{ letterSpacing: 2, color: "primary.main", fontWeight: 700 }}
          >
            Annotate
          </Typography>
          <Stack direction="row" gap={0.5}>
            <Tooltip title="Undo (⌘Z)">
              <span>
                <IconButton
                  size="small"
                  onClick={undo}
                  disabled={!history.length}
                >
                  <Undo fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Clear all">
              <IconButton size="small" onClick={clearAll}>
                <ClearAll fontSize="small" />
              </IconButton>
            </Tooltip>
            {onDelete && (
              <Tooltip title="Delete image">
                <IconButton size="small" color="error" onClick={onDelete}>
                  <Delete fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Save">
              <IconButton size="small" color="primary" onClick={handleSave}>
                <Save fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Cancel">
              <IconButton size="small" onClick={onClose}>
                <Close fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {/* Toolbar */}
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          flexWrap="wrap"
          sx={{
            px: 1.5,
            py: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          <Stack direction="row" gap={0.25}>
            {TOOL_META.map(({ key, label, kbd, Icon }) => (
              <Tooltip key={key} title={`${label} (${kbd})`}>
                <IconButton
                  size="small"
                  onClick={() => setTool(key as ToolKey)}
                  sx={{
                    borderRadius: 1,
                    bgcolor: tool === key ? "primary.main" : "transparent",
                    color:
                      tool === key ? "primary.contrastText" : "text.secondary",
                    "&:hover": {
                      bgcolor: tool === key ? "primary.dark" : "action.hover",
                    },
                  }}
                >
                  <Icon fontSize="small" />
                </IconButton>
              </Tooltip>
            ))}
          </Stack>

          <Divider flexItem orientation="vertical" />

          <Stack direction="row" gap={0.5} alignItems="center">
            {PALETTE.map((c) => (
              <Box
                key={c}
                onClick={() => setColor(c)}
                sx={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  bgcolor: c,
                  cursor: "pointer",
                  margin: 1,
                  border:
                    color === c ? "2px solid white" : "2px solid transparent",
                  outline: color === c ? `2px solid ${c}` : "none",
                  transform: color === c ? "scale(1.25)" : "scale(1)",
                  transition: "transform .1s",
                }}
              />
            ))}
          </Stack>

          <Divider flexItem orientation="vertical" />

          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            sx={{ minWidth: 120 }}
          >
            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}
            >
              SIZE
            </Typography>
            <Slider
              size="small"
              min={1}
              max={20}
              value={brushSize}
              onChange={(_, v) => setBrushSize(v as number)}
              sx={{ width: 70, color: "primary.main" }}
            />
            <Typography
              variant="caption"
              color="primary.main"
              sx={{ fontFamily: "monospace", minWidth: 16 }}
            >
              {brushSize}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            sx={{ minWidth: 130 }}
          >
            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}
            >
              OPACITY
            </Typography>
            <Slider
              size="small"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(_, v) => setOpacity(v as number)}
              sx={{ width: 70, color: "primary.main" }}
            />
            <Typography
              variant="caption"
              color="primary.main"
              sx={{ fontFamily: "monospace", minWidth: 30 }}
            >
              {Math.round(opacity * 100)}%
            </Typography>
          </Stack>
        </Stack>

        {/* Canvas */}
        <Box
          sx={{
            overflow: "auto",
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 2,
            bgcolor: "grey.900",
          }}
        >
          <Box sx={{ position: "relative", display: "inline-block", cursor }}>
            <canvas ref={bgRef} style={{ display: "block", borderRadius: 6 }} />
            <canvas
              ref={drawRef}
              style={{ position: "absolute", inset: 0, borderRadius: 6 }}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onTouchStart={onDown}
              onTouchMove={onMove}
              onTouchEnd={onUp}
            />
            <canvas
              ref={overlayRef}
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                borderRadius: 6,
              }}
            />
            {textPos && (
              <Box
                sx={{
                  position: "absolute",
                  left: textPos.x,
                  top: textPos.y - 20,
                  zIndex: 10,
                }}
              >
                <input
                  autoFocus
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitText();
                    if (e.key === "Escape") setTextPos(null);
                  }}
                  placeholder="Type then Enter…"
                  style={{
                    background: "rgba(0,0,0,0.75)",
                    border: `2px solid ${color}`,
                    borderRadius: 4,
                    color,
                    padding: "3px 8px",
                    fontSize: `${brushSize * 6 + 10}px`,
                    fontFamily: "inherit",
                    outline: "none",
                    minWidth: 140,
                  }}
                />
              </Box>
            )}
          </Box>
        </Box>

        {/* Hint bar */}
        <Stack
          direction="row"
          gap={2}
          flexWrap="wrap"
          sx={{
            px: 2,
            py: 0.75,
            borderTop: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          {TOOL_META.map(({ kbd, label }) => (
            <Typography
              key={kbd}
              variant="caption"
              color="text.disabled"
              sx={{ fontFamily: "monospace" }}
            >
              <Box
                component="span"
                sx={{
                  bgcolor: "action.selected",
                  borderRadius: 0.5,
                  px: 0.5,
                  mr: 0.5,
                }}
              >
                {kbd}
              </Box>
              {label}
            </Typography>
          ))}
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ fontFamily: "monospace" }}
          >
            <Box
              component="span"
              sx={{
                bgcolor: "action.selected",
                borderRadius: 0.5,
                px: 0.5,
                mr: 0.5,
              }}
            >
              ⌘Z
            </Box>
            Undo
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
};
