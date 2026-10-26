import { useState, type ReactNode } from "react";
import type { ChartType, SlideElement } from "../api/contract";
import { chartData, num, type ChartData } from "../lib/chartData";
import { RichText } from "./RichText";

// A chart on a designed slide, drawn from the data table in its doc: the header row names the
// series, the first column names the categories. Editing the table redraws the chart; the table is
// also what search indexes and what screen readers get.
//
// Marks follow the data-viz rules: bars capped at 24 pt with 4 pt rounded data-ends from one
// baseline and a 2 pt gap; 2 pt lines; markers r 4 with a 2 pt surface ring; hairline solid grid;
// labels in text colors, never series colors; a legend whenever there are 2+ series.

// Categorical palette (validated light/dark steps; fixed order, never cycled).
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const MAX_SERIES = 8;

/** Round, readable tick values covering [lo, hi]. */
function ticks(lo: number, hi: number, count = 5): number[] {
  if (lo === hi) hi = lo + 1;
  const step0 = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  // From the tick at or below the lowest value to the tick at or above the highest.
  const first = Math.floor(lo / step + 1e-9);
  const last = Math.ceil(hi / step - 1e-9);
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(v * 1000) / 1000));

/** A bar from the baseline to the value, its data-end rounded (4 pt), square at the baseline. */
function barPath(x: number, base: number, end: number, w: number, horizontal: boolean): string {
  const len = Math.abs(end - base);
  const r = Math.min(4, w / 2, len);
  if (!horizontal) {
    const up = end < base;
    const y0 = base;
    const y1 = end;
    const s = up ? 1 : -1;
    return `M${x},${y0} L${x},${y1 + s * r} Q${x},${y1} ${x + r},${y1} L${x + w - r},${y1} Q${x + w},${y1} ${x + w},${y1 + s * r} L${x + w},${y0} Z`;
  }
  const right = end > base;
  const s = right ? -1 : 1;
  return `M${base},${x} L${end + s * r},${x} Q${end},${x} ${end},${x + r} L${end},${x + w - r} Q${end},${x + w} ${end + s * r},${x + w} L${base},${x + w} Z`;
}

const luminance = (hex: string) => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

/** A chart on a designed slide: its data is the table in its doc. */
export function SlideChart({ e, background, interactive = true }: { e: Extract<SlideElement, { kind: "chart" }>; background?: string; interactive?: boolean }) {
  return (
    <ChartSvg data={chartData(e.doc)} chartType={e.chartType} w={e.w} h={e.h} fontSize={e.fontSize} colors={e.colors} background={background} interactive={interactive}>
      <RichText doc={e.doc} />
    </ChartSvg>
  );
}

/**
 * Any chart from categories × series (slides, and charts saved from Sheets), drawn at w×h.
 * `children` is the data for screen readers (a table), kept visually hidden.
 */
export function ChartSvg({ data, chartType, w, h, fontSize, colors, background, interactive = true, children }: { data: ChartData; chartType: ChartType; w: number; h: number; fontSize?: number; colors?: (string | null)[]; background?: string; interactive?: boolean; children?: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const dark = luminance(background ?? "#ffffff") < 0.4;
  const ink = { primary: dark ? "#f0efec" : "#0b0b0b", secondary: dark ? "#c3c2b7" : "#52514e", grid: dark ? "#3a3a38" : "#e4e3df", surface: background ?? (dark ? "#1a1a19" : "#ffffff") };
  const palette = dark ? DARK : LIGHT;
  const colorAt = (i: number) => colors?.[i] ?? palette[i % palette.length];
  const fs = fontSize ?? 12;
  const W = w;
  const H = h;
  const pie = chartType === "pie" || chartType === "doughnut";
  const series = data.series.slice(0, MAX_SERIES);
  const hidden = data.series.length - series.length;
  const legendItems = pie ? data.categories.slice(0, MAX_SERIES) : series.length > 1 ? series.map((s) => s.name) : [];
  const titleH = data.title ? fs * 1.7 : 0;
  const legendH = legendItems.length ? fs * 1.7 : 0;
  const top = titleH + legendH + 4;
  const marks: ReactNode[] = [];
  const hover = (x: number, y: number, lines: string[]) => (interactive ? { onMouseEnter: () => setTip({ x, y, lines }), onMouseLeave: () => setTip(null) } : {});

  if (pie) {
    const vals = (series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
    const shown = vals.slice(0, MAX_SERIES - 1);
    const other = vals.slice(MAX_SERIES - 1).reduce((a, b) => a + b, 0);
    const slices = other > 0 ? [...shown, other] : vals.slice(0, MAX_SERIES);
    const labels = other > 0 ? [...data.categories.slice(0, MAX_SERIES - 1), "Other"] : data.categories;
    const total = slices.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2;
    const cy = top + (H - top) / 2;
    const r = Math.max(4, Math.min(W, H - top) / 2 - 6);
    const r0 = chartType === "doughnut" ? r * 0.6 : 0;
    let a0 = -Math.PI / 2;
    slices.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      const d = r0 ? `M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, r0)} A${r0},${r0} 0 ${large} 0 ${p(a0, r0)} Z` : `M${cx},${cy} L${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} Z`;
      const mid = (a0 + a1) / 2;
      if (v > 0) marks.push(<path key={i} d={d} fill={colorAt(i)} stroke={ink.surface} strokeWidth={2} {...hover(cx + (r * 0.7) * Math.cos(mid), cy + (r * 0.7) * Math.sin(mid), [labels[i], `${fmt(v)} (${Math.round((v / total) * 100)}%)`])} />);
      a0 = a1;
    });
  } else {
    const horizontal = chartType === "bar";
    const scatter = chartType === "scatter";
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    // Bars and areas start at zero (their length is the value). Lines and dots may leave zero out
    // when every value sits far from it, as Excel does (smallest above 5/6 of the largest).
    const [mn, mx] = [Math.min(...all), Math.max(...all)];
    const floating = (chartType === "line" || scatter) && all.length > 0 && (mn > 0 ? mn > (mx * 5) / 6 : mx < 0 && mx < (mn * 5) / 6);
    const ys = floating ? ticks(mn, mx) : ticks(Math.min(0, ...all), Math.max(0, ...all));
    const lo = ys[0];
    const hi = ys[ys.length - 1];
    const labelW = Math.max(...ys.map((v) => fmt(v).length)) * fs * 0.6 + 6;
    const catW = Math.min(W * 0.35, Math.max(...data.categories.map((c) => c.length), 1) * fs * 0.6 + 6);
    const left = horizontal ? catW : labelW;
    const bottom = fs * 1.8;
    const pw = Math.max(10, W - left - 6);
    const ph = Math.max(10, H - top - bottom);
    const n = Math.max(1, data.categories.length);
    const xsNum = data.categories.map(num);
    const scatterX = scatter && xsNum.every((v) => v !== null) ? (xsNum as number[]) : data.categories.map((_, i) => i);
    const xt = scatter ? ticks(Math.min(...scatterX), Math.max(...scatterX)) : [];
    const valuePos = (v: number) => (horizontal ? left + ((v - lo) / (hi - lo)) * pw : top + ph - ((v - lo) / (hi - lo)) * ph);
    const band = (horizontal ? ph : pw) / n;
    const catPos = (i: number) => (horizontal ? top + band * i : left + band * i);
    const xPos = (i: number) => (scatter ? left + ((scatterX[i] - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * pw : catPos(i) + band / 2);
    // Grid and value axis (hairline, solid, recessive).
    ys.forEach((v, i) => {
      const p = valuePos(v);
      marks.push(horizontal ? <line key={`g${i}`} x1={p} x2={p} y1={top} y2={top + ph} stroke={v === 0 ? ink.secondary : ink.grid} strokeWidth={1} /> : <line key={`g${i}`} x1={left} x2={left + pw} y1={p} y2={p} stroke={v === 0 ? ink.secondary : ink.grid} strokeWidth={1} />);
      marks.push(
        horizontal ? (
          <text key={`t${i}`} x={p} y={top + ph + fs * 1.3} fontSize={fs} fill={ink.secondary} textAnchor="middle">{fmt(v)}</text>
        ) : (
          <text key={`t${i}`} x={left - 6} y={p + fs * 0.35} fontSize={fs} fill={ink.secondary} textAnchor="end">{fmt(v)}</text>
        ),
      );
    });
    // Category labels (thinned when crowded).
    const every = Math.max(1, Math.ceil((n * fs * 0.6 * Math.max(...data.categories.map((c) => Math.min(c.length, 14)), 1)) / (horizontal ? ph * 4 : pw)));
    if (scatter)
      xt.forEach((v, i) => marks.push(<text key={`x${i}`} x={left + ((v - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * pw} y={top + ph + fs * 1.3} fontSize={fs} fill={ink.secondary} textAnchor="middle">{fmt(v)}</text>));
    else
      data.categories.forEach((c, i) => {
        if (i % every) return;
        const label = c.length > 16 ? `${c.slice(0, 15)}…` : c;
        marks.push(
          horizontal ? (
            <text key={`c${i}`} x={left - 6} y={catPos(i) + band / 2 + fs * 0.35} fontSize={fs} fill={ink.secondary} textAnchor="end">{label}</text>
          ) : (
            <text key={`c${i}`} x={catPos(i) + band / 2} y={top + ph + fs * 1.3} fontSize={fs} fill={ink.secondary} textAnchor="middle">{label}</text>
          ),
        );
      });
    const base = valuePos(Math.max(lo, Math.min(0, hi)));
    if (chartType === "column" || horizontal) {
      const gap = 2;
      const k = series.length;
      const w = Math.max(1, Math.min(24, (band * 0.8 - gap * (k - 1)) / k));
      const group = k * w + (k - 1) * gap;
      series.forEach((s, si) =>
        s.values.forEach((v, i) => {
          if (v === null) return;
          const x = catPos(i) + (band - group) / 2 + si * (w + gap);
          const end = valuePos(v);
          const tipAt = horizontal ? [end, x] : [x + w / 2, end];
          marks.push(<path key={`b${si}-${i}`} d={barPath(x, base, end, w, horizontal)} fill={colorAt(si)} {...hover(tipAt[0], tipAt[1], [data.categories[i], `${s.name}: ${fmt(v)}`])} />);
        }),
      );
    } else {
      series.forEach((s, si) => {
        const pts = s.values.map((v, i) => (v === null ? null : ([xPos(i), valuePos(v)] as const)));
        if (!scatter) {
          const path = pts.reduce((d, p, i) => (p ? `${d}${d && pts[i - 1] ? "L" : "M"}${p[0]},${p[1]}` : d), "");
          if (chartType === "area") {
            const valid = pts.filter((p): p is readonly [number, number] => !!p);
            if (valid.length) marks.push(<path key={`a${si}`} d={`${path} L${valid[valid.length - 1][0]},${base} L${valid[0][0]},${base} Z`} fill={colorAt(si)} opacity={0.16} />);
          }
          marks.push(<path key={`l${si}`} d={path} fill="none" stroke={colorAt(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />);
        }
        pts.forEach((p, i) => {
          if (!p || (!scatter && pts.length > 30 && i !== pts.length - 1)) return;
          marks.push(<circle key={`m${si}-${i}`} cx={p[0]} cy={p[1]} r={4} fill={colorAt(si)} stroke={ink.surface} strokeWidth={2} {...hover(p[0], p[1], [scatter ? `x = ${fmt(scatterX[i])}` : data.categories[i], `${s.name}: ${fmt(s.values[i]!)}`])} />);
        });
      });
      // Crosshair targets for line/area: one band per category, bigger than the marks.
      if (!scatter && interactive)
        data.categories.forEach((c, i) =>
          marks.push(
            <rect key={`h${i}`} x={catPos(i)} y={top} width={band} height={ph} fill="transparent" onMouseEnter={() => setTip({ x: xPos(i), y: top + 4, lines: [c, ...series.map((s) => `${s.name}: ${s.values[i] === null ? "—" : fmt(s.values[i]!)}`)] })} onMouseLeave={() => setTip(null)} />,
          ),
        );
      if (tip && !scatter) marks.push(<line key="cross" x1={tip.x} x2={tip.x} y1={top} y2={top + ph} stroke={ink.secondary} strokeWidth={1} pointerEvents="none" />);
    }
  }

  // Legend: swatch + name in text color; one row, items flow.
  let lx = 0;
  const legend = legendItems.map((name, i) => {
    const x = lx;
    lx += fs * 1.6 + Math.min(name.length, 18) * fs * 0.6 + fs;
    return (
      <g key={i} transform={`translate(${x},${titleH + fs * 0.4})`}>
        <rect width={fs * 0.9} height={fs * 0.9} rx={2} fill={colorAt(i)} />
        <text x={fs * 1.3} y={fs * 0.8} fontSize={fs} fill={ink.primary}>{name.length > 18 ? `${name.slice(0, 17)}…` : name}</text>
      </g>
    );
  });

  const tipW = tip ? Math.max(...tip.lines.map((l) => l.length)) * fs * 0.58 + 12 : 0;
  const tipH = tip ? tip.lines.length * fs * 1.3 + 8 : 0;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${data.title || "Chart"}: ${chartType} chart${series.length ? ` of ${series.map((s) => s.name).join(", ")}` : ""}`} style={{ overflow: "visible", fontFamily: "inherit" }}>
        {data.title && <text x={0} y={fs * 1.1} fontSize={fs * 1.15} fontWeight={700} fill={ink.primary}>{data.title}</text>}
        {legend}
        {hidden > 0 && <text x={W} y={fs * 1.1} fontSize={fs * 0.9} fill={ink.secondary} textAnchor="end">+{hidden} more series in the data</text>}
        {marks}
        {tip && (
          <g transform={`translate(${Math.min(Math.max(0, tip.x - tipW / 2), W - tipW)},${Math.max(0, tip.y - tipH - 8)})`} pointerEvents="none">
            <rect width={tipW} height={tipH} rx={4} fill={dark ? "#2a2a28" : "#ffffff"} stroke={ink.grid} />
            {tip.lines.map((l, i) => (
              <text key={i} x={6} y={fs * 1.1 + i * fs * 1.3} fontSize={fs} fill={i ? ink.secondary : ink.primary} fontWeight={i ? 400 : 700}>{l}</text>
            ))}
          </g>
        )}
      </svg>
      {/* The numbers, for screen readers (the visual table view is "edit the chart"). */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {children}
      </div>
    </div>
  );
}
