import type { SxProps, Theme } from "@mui/material";
import type { SlideDesign, SlideElement } from "../api/contract";

// Type and color rules for designed slides, shared by the renderer and the slide editor.

import { fontStack } from "../lib/slideFonts";

const HEX = /^#[0-9a-f]{6}$/i;
const HEX_ALPHA = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
export { fontStack };
export const hex = (c?: string) => (c && HEX.test(c) ? c : undefined);
/** A fill or outline color, which may be see-through (#rrggbbaa). */
export const hexA = (c?: string) => (c && HEX_ALPHA.test(c) ? c : undefined);

/** Text inside a slide: sizes relative to the box's font size, tight PowerPoint-like spacing. */
export const slideProseSx: SxProps<Theme> = {
  fontSize: "inherit",
  lineHeight: 1.2,
  wordBreak: "break-word",
  "& p": { m: 0, mb: "0.15em" },
  "& h2, & h3, & h4": { fontSize: "1.15em", fontWeight: 700, m: 0, mb: "0.2em" },
  "& ul, & ol": { pl: "1.2em", my: 0 },
  "& li": { my: "0.12em" },
  "& li > p": { m: 0 },
  "& [data-tc]": { color: "var(--tc)" }, // exact colors: no dark-mode lightening on a slide
  "& table": { borderCollapse: "collapse", fontSize: "0.8em", width: "100%" },
  "& table[data-widths]": { fontSize: "1em" }, // sized like PowerPoint: the deck's own widths and font size
  "& .table-wrap": { overflow: "visible" }, // a table sized by its columns may be wider than its frame, as in PowerPoint
  "& th, & td": { border: "1px solid var(--tb, #9aa1ab)", px: "0.4em", py: "0.2em", verticalAlign: "top", textAlign: "left", "& p": { m: 0 } },
  "& th": { bgcolor: "rgba(0,0,0,0.06)", fontWeight: 700 },
  "& a": { color: "inherit" },
  "& code": { bgcolor: "rgba(0,0,0,0.06)" },
};

/** Layout and type of a text box (shared with the slide editor's in-place text editor). */
export function boxTextSx(e: Extract<SlideElement, { kind: "text" | "shape" | "chart" }>, fonts: SlideDesign["fonts"]): SxProps<Theme> {
  const justify = e.valign === "middle" ? "center" : e.valign === "bottom" ? "flex-end" : "flex-start";
  return { position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: justify, px: "7.2px", py: "3.6px", color: hex(e.color) ?? "#000000", fontSize: `${e.fontSize ?? 18}px`, fontFamily: fontStack(e.role === "title" ? (fonts?.heading ?? fonts?.body) : fonts?.body) };
}

