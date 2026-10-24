import { Box, Stack, Typography, useTheme } from "@mui/material";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HistogramBucket, ID, SearchResponse, Tag } from "../../api/contract";
import { bucketsToRange, formatBucket, type FixedInterval } from "../../lib/dates";
import { TagDot } from "../../components/ui";

// §W4.2 date histogram. Dataviz rules applied: one series (no legend box), bars ≤ 24px with a
// 4px rounded data-end and square baseline, 2px surface gap, solid hairline grid, the whole
// column band is the hover/focus target, tooltip leads with the value, "view as table" twin,
// refetch holds the previous frame dimmed. Colors are validated theme tokens (palette.chart).

type Hist = NonNullable<SearchResponse["histogram"]>;

const PLOT_H = 64;
const AXIS_H = 18;
const TOP_PAD = 6;

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

interface Props {
  hist: Hist;
  tags: Map<ID, Tag>;
  dimmed?: boolean;
  reducedMotion?: boolean;
  onSelect: (range: { from: string; to: string }) => void;
  onClear: () => void;
  onZoomBy?: (factor: number, centerIndex: number) => void;
}

export function Histogram({ hist, tags, dimmed, reducedMotion, onSelect, onClear, onZoomBy }: Props) {
  const theme = useTheme();
  const c = theme.palette.chart;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const b = hist.buckets;
  const n = b.length;
  const band = n ? width / n : width;
  const gap = band >= 6 ? 2 : band >= 3 ? 1 : 0;
  const barW = Math.max(1, Math.min(24, band - gap));
  const max = Math.max(1, ...b.map((x) => x.count));
  const yScale = (v: number) => (v / max) * (PLOT_H - TOP_PAD);
  const interval = hist.interval as FixedInterval;

  const sel = hist.selectedRange;
  const inSel = (x: HistogramBucket) => !sel || (x.end > sel.from && x.start < sel.to);
  const selIdx = useMemo(() => {
    if (!sel) return null;
    const idx = b.map((x, i) => (x.end > sel.from && x.start < sel.to ? i : -1)).filter((i) => i >= 0);
    return idx.length ? { lo: idx[0], hi: idx[idx.length - 1] } : null;
  }, [b, sel]);

  const indexAt = useCallback(
    (clientX: number) => {
      const r = wrap.current!.getBoundingClientRect();
      return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
    },
    [n],
  );

  // Pointer: click = select bucket, drag = brush a range, shift-click = extend, dblclick = clear.
  const onDown = (e: React.PointerEvent) => {
    if (!n || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const i = indexAt(e.clientX);
    if (e.shiftKey && selIdx) {
      const a = Math.abs(i - selIdx.lo) > Math.abs(i - selIdx.hi) ? selIdx.lo : selIdx.hi;
      onSelect(bucketsToRange(b, a, i));
      return;
    }
    dragging.current = true;
    setBrush({ a: i, b: i });
  };
  const onMove = (e: React.PointerEvent) => {
    const i = indexAt(e.clientX);
    setHover(i);
    if (dragging.current) setBrush((br) => (br ? { ...br, b: i } : br));
  };
  const onUp = () => {
    if (!dragging.current || !brush) return;
    dragging.current = false;
    onSelect(bucketsToRange(b, brush.a, brush.b));
    setBrush(null);
  };

  // Keyboard: ←/→ move, Enter select, Shift+←/→ extend, Esc clear (§W4.2 A11y).
  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return;
    const cur = focusIdx ?? (selIdx ? selIdx.hi : n - 1);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowLeft" ? -1 : 1)));
      setFocusIdx(next);
      if (e.shiftKey) {
        if (anchor.current === null) anchor.current = cur;
        onSelect(bucketsToRange(b, anchor.current, next));
      } else anchor.current = null;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      anchor.current = cur;
      onSelect(bucketsToRange(b, cur, cur));
    } else if (e.key === "Escape" && sel) {
      e.preventDefault();
      e.stopPropagation();
      anchor.current = null;
      onClear();
    } else if ((e.key === "+" || e.key === "=") && onZoomBy) onZoomBy(0.5, cur);
    else if (e.key === "-" && onZoomBy) onZoomBy(2, cur);
  };

  // ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !onZoomBy) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoomBy(e.deltaY < 0 ? 0.5 : 2, indexAt(e.clientX));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoomBy, indexAt]);

  // Axis ticks: about one per 90px, labeled with the bucket start; show the year when it changes.
  const ticks = useMemo(() => {
    if (!n) return [];
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 90))));
    const out: { i: number; label: string }[] = [];
    let lastYear = "";
    for (let i = 0; i < n; i += every) {
      const year = b[i].start.slice(0, 4);
      let label = formatBucket(b[i].start, interval);
      if ((interval === "day" || interval === "week" || interval === "month") && year !== lastYear) label = `${label} ’${year.slice(2)}`;
      lastYear = year;
      out.push({ i, label });
    }
    return out;
  }, [b, n, width, interval]);

  const tipIdx = brush ? brush.b : hover ?? focusIdx;
  const tip = tipIdx !== null && b[tipIdx] ? b[tipIdx] : null;
  const brushLo = brush ? Math.min(brush.a, brush.b) : 0;
  const brushHi = brush ? Math.max(brush.a, brush.b) : 0;
  const transition = reducedMotion ? "none" : "height 180ms ease-out, y 180ms ease-out, fill 120ms";

  return (
    <Box sx={{ position: "relative", opacity: dimmed ? 0.55 : 1, transition: "opacity 120ms" }}>
      <Box
        ref={wrap}
        tabIndex={0}
        role="group"
        aria-label={`Posts over time by ${interval}. ${n} bars. Arrow keys move, Enter selects, Shift+arrows extend, Escape clears.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => !dragging.current && setHover(null)}
        onDoubleClick={() => sel && onClear()}
        onKeyDown={onKey}
        onBlur={() => setFocusIdx(null)}
        sx={{ position: "relative", height: PLOT_H + AXIS_H, cursor: "crosshair", touchAction: "pan-y", userSelect: "none", outline: "none", borderRadius: 1, "&:focus-visible": { boxShadow: `0 0 0 2px ${theme.palette.primary.main}` } }}
      >
        <svg width={width} height={PLOT_H + AXIS_H} style={{ display: "block", overflow: "visible" }} aria-hidden>
          {/* recessive hairlines: top gridline + baseline */}
          <line x1={0} x2={width} y1={TOP_PAD + 0.5} y2={TOP_PAD + 0.5} stroke={c.grid} strokeWidth={1} />
          <line x1={0} x2={width} y1={PLOT_H + 0.5} y2={PLOT_H + 0.5} stroke={c.grid} strokeWidth={1} />
          {selIdx && !brush && <rect x={selIdx.lo * band} width={(selIdx.hi - selIdx.lo + 1) * band} y={0} height={PLOT_H} fill={c.wash} />}
          {brush && <rect x={brushLo * band} width={(brushHi - brushLo + 1) * band} y={0} height={PLOT_H} fill={c.wash} />}
          {b.map((x, i) => {
            const h = x.count ? Math.max(2, yScale(x.count)) : 0;
            const bx = i * band + (band - barW) / 2;
            const active = brush ? i >= brushLo && i <= brushHi : inSel(x);
            const fill = active ? c.bar : c.barMuted;
            const r = Math.min(4, barW / 2, h);
            const lifted = i === tipIdx;
            return (
              <g key={x.start} opacity={lifted ? 0.8 : 1}>
                {h === 0 ? (
                  // zero buckets still render: a baseline tick keeps the axis continuous
                  <rect x={bx} width={barW} y={PLOT_H - 1} height={1} fill={c.grid} />
                ) : (
                  <>
                    <rect x={bx} width={barW} y={PLOT_H - h} height={h} rx={r} fill={fill} style={{ transition }} />
                    {/* square the baseline end: rounded data-end only */}
                    <rect x={bx} width={barW} y={PLOT_H - Math.min(h, r)} height={Math.min(h, r)} fill={fill} style={{ transition }} />
                  </>
                )}
              </g>
            );
          })}
          {ticks.map((t) => (
            <text key={t.i} x={t.i * band + 1} y={PLOT_H + 13} fontSize={10.5} fill={theme.palette.text.secondary} style={{ fontVariantNumeric: "tabular-nums" }}>
              {t.label}
            </text>
          ))}
          <text x={width - 2} y={TOP_PAD - 1} fontSize={10} textAnchor="end" fill={theme.palette.text.disabled}>
            {compact(max)}
          </text>
        </svg>
        {tip && (
          <Box
            role="status"
            sx={{
              position: "absolute",
              bottom: PLOT_H + AXIS_H - (PLOT_H - yScale(tip.count)) + 8,
              left: Math.min(Math.max(0, (tipIdx ?? 0) * band + band / 2 - 90), Math.max(0, width - 180)),
              width: 180,
              pointerEvents: "none",
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              boxShadow: 3,
              px: 1.25,
              py: 0.75,
              zIndex: 5,
            }}
          >
            <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>
              {tip.count.toLocaleString()} post{tip.count === 1 ? "" : "s"}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              {formatBucket(tip.start, interval, true)}
            </Typography>
            {tip.topTags?.slice(0, 3).map((t) => {
              const tag = tags.get(t.tagId);
              return tag ? (
                <Stack key={t.tagId} direction="row" spacing={0.75} alignItems="center">
                  <TagDot color={tag.color} size={6} />
                  <Typography variant="caption" sx={{ flex: 1 }} noWrap>{tag.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>{t.count}</Typography>
                </Stack>
              ) : null;
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** The histogram's table-view twin (every value reachable without hovering). */
export function HistogramTable({ hist, tags }: { hist: Hist; tags: Map<ID, Tag> }) {
  const rows = hist.buckets.filter((b) => b.count > 0);
  return (
    <Box sx={{ maxHeight: 220, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1, mt: 1 }}>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", "& th, & td": { px: 1, py: 0.4, borderBottom: 1, borderColor: "divider", textAlign: "left" }, "& td.n": { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}>
        <caption style={{ position: "absolute", left: -9999 }}>Posts per {hist.interval}</caption>
        <thead>
          <tr>
            <th scope="col">{hist.interval[0].toUpperCase() + hist.interval.slice(1)}</th>
            <th scope="col" style={{ textAlign: "right" }}>Posts</th>
            <th scope="col">Top tags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.start}>
              <td>{formatBucket(b.start, hist.interval as FixedInterval, true)}</td>
              <td className="n">{b.count}</td>
              <td>{b.topTags?.map((t) => tags.get(t.tagId)?.name).filter(Boolean).join(", ")}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={3}>No posts in this range</td>
            </tr>
          )}
        </tbody>
      </Box>
    </Box>
  );
}
