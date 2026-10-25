import { Box, type SxProps, type Theme } from "@mui/material";
import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ID, ImageView, SlideDesign, SlideElement } from "../api/contract";
import { AnnotationLayer } from "./AnnotationLayer";
import { RichText } from "./RichText";
import { SlideChart } from "./SlideChart";
import { designFonts, ensureWebFonts } from "../lib/slideFonts";
import { boxTextSx, fontStack, hex, hexA, slideProseSx } from "./slideStyles";

// A designed slide (contract.ts SlideDesign): elements placed on a fixed canvas in points, drawn
// at the design size and scaled to whatever width it gets, so a slide looks the same in a post
// column, on a phone, and full-screen. Slides keep their own colors in dark mode, like a picture.

/** Measure the width we're given (callback ref, so it works in portals). */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, width };
}

function ShapeSvg({ e }: { e: Extract<SlideElement, { kind: "shape" }> }) {
  const stroke = hexA(e.line);
  const fill = hexA(e.fill) ?? "none";
  const sw = stroke ? Math.max(0.5, e.lineWidth ?? 1) : 0;
  const { w, h } = e;
  const common = { fill, stroke: stroke ?? "none", strokeWidth: sw, vectorEffect: "non-scaling-stroke" as const };
  let shape: ReactNode;
  if (e.shape === "ellipse") shape = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - sw / 2)} ry={Math.max(0, h / 2 - sw / 2)} {...common} />;
  else if (e.shape === "triangle") shape = <polygon points={`${w / 2},${sw} ${w - sw},${h - sw} ${sw},${h - sw}`} {...common} />;
  else if (e.shape === "line" || e.shape === "arrow") {
    const id = `arrow-${e.id}`;
    shape = (
      <>
        {e.shape === "arrow" && (
          <defs>
            <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={stroke ?? "#000"} />
            </marker>
          </defs>
        )}
        <line x1={0} y1={0} x2={w} y2={h} stroke={stroke ?? "#000"} strokeWidth={Math.max(1, sw)} markerEnd={e.shape === "arrow" ? `url(#${id})` : undefined} />
      </>
    );
  } else shape = <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={e.shape === "roundRect" ? Math.min(w, h) * 0.1667 : 0} {...common} />;
  // Padded so straight lines (zero height or width) and thick outlines still get drawn.
  const pad = 12;
  return (
    <svg width={w + 2 * pad} height={h + 2 * pad} viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} style={{ position: "absolute", left: -pad, top: -pad, overflow: "visible" }} aria-hidden>
      {shape}
    </svg>
  );
}

function TextBox({ e, fonts }: { e: Extract<SlideElement, { kind: "text" | "shape" }>; fonts: SlideDesign["fonts"] }) {
  if (!e.doc) return null;
  return (
    <Box sx={boxTextSx(e, fonts)}>
      <RichText doc={e.doc} sx={slideProseSx} />
    </Box>
  );
}

function Element({ e, fonts, images, quality, editing, background }: { e: SlideElement; fonts: SlideDesign["fonts"]; images: Map<ID, ImageView>; quality: "medium" | "original"; editing: boolean; background?: string }) {
  const transform = [e.rotation ? `rotate(${e.rotation}deg)` : "", e.kind === "shape" && e.flipH ? "scaleX(-1)" : "", e.kind === "shape" && e.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ");
  const box: CSSProperties = { position: "absolute", left: e.x, top: e.y, width: e.w, height: e.h, transform: transform || undefined };
  if (e.kind === "image") {
    const img = images.get(e.imageInstanceId);
    if (!img) return null;
    const a = img.asset;
    const src = (a.variants.find((v) => v.name === quality) ?? a.variants.find((v) => v.name === "original") ?? a.variants[0])?.url;
    return (
      <div style={box} data-slide-element="image">
        <img src={src} alt={e.decorative ? "" : (img.altText ?? img.caption ?? "")} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        <AnnotationLayer shapes={img.annotation?.shapes ?? []} width={a.width} height={a.height} />
      </div>
    );
  }
  if (e.kind === "chart")
    return (
      <div style={{ ...box, fontSize: e.fontSize ?? 12 }} data-slide-element="chart">
        {!editing && <SlideChart e={e} background={background} />}
      </div>
    );
  const fill = e.kind === "text" ? hexA(e.fill) : undefined;
  const line = e.kind === "text" ? hexA(e.line) : undefined;
  return (
    <div style={{ ...box, background: fill, outline: line ? `1px solid ${line}` : undefined }} data-slide-element={e.kind}>
      {e.kind === "shape" && <ShapeSvg e={e} />}
      {/* text in a flipped shape is drawn unflipped, as in PowerPoint */}
      <div style={{ position: "absolute", inset: 0, transform: e.kind === "shape" && (e.flipH || e.flipV) ? `${e.flipH ? "scaleX(-1)" : ""} ${e.flipV ? "scaleY(-1)" : ""}` : undefined }}>
        {!editing && <TextBox e={e} fonts={fonts} />}
      </div>
    </div>
  );
}

interface Props {
  design: SlideDesign;
  images: Map<ID, ImageView>;
  /** Fit inside this height as well as the width (full-screen presenting). */
  fitHeight?: number;
  quality?: "medium" | "original";
  label?: string;
  sx?: SxProps<Theme>;
  /** Drawn on top of the canvas, in canvas coordinates (the slide editor's selection layer). */
  overlay?: (scale: number) => ReactNode;
  /** The element whose text the editor is showing instead. */
  editingId?: string | null;
  /** Show what sticks out past the slide's edges (editing: so it can still be grabbed). */
  unclipped?: boolean;
}

export function SlideCanvas({ design, images, fitHeight, quality = "medium", label = "Slide", sx, overlay, editingId, unclipped }: Props) {
  const { ref, width: avail } = useWidth<HTMLDivElement>();
  const fontKey = designFonts(design).join("|");
  useEffect(() => ensureWebFonts(fontKey ? fontKey.split("|") : []), [fontKey]);
  const { w, h } = design.size;
  const width = fitHeight ? Math.min(avail, (fitHeight * w) / h) : avail;
  const scale = width / w;
  return (
    <Box ref={ref} role="group" aria-label={label} data-slide-design sx={[{ width: "100%" }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box sx={{ width: width || "100%", aspectRatio: `${w} / ${h}`, mx: "auto", position: "relative", overflow: unclipped ? "visible" : "hidden", bgcolor: hex(design.background) ?? "#ffffff", color: "#000", borderRadius: 1, boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.12)" }}>
        {width > 0 && (
          <Box sx={{ position: "absolute", top: 0, left: 0, width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0", fontFamily: fontStack(design.fonts?.body) }}>
            {design.elements.map((e) => (
              <Element key={e.id} e={e} fonts={design.fonts} images={images} quality={quality} editing={e.id === editingId} background={design.background} />
            ))}
            {overlay?.(scale)}
          </Box>
        )}
      </Box>
    </Box>
  );
}
