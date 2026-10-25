import type { Theme } from "@mui/material";
import type { SystemStyleObject } from "@mui/system";

/** Shared typography for rendered and edited rich text, so the composer looks like the result. */
export const proseSx: SystemStyleObject<Theme> = {
  fontSize: "0.95rem",
  lineHeight: 1.65,
  wordBreak: "break-word",
  "& p": { my: 0.75 },
  "& h2": { fontSize: "1.15rem", fontWeight: 600, mt: 2, mb: 0.75 },
  "& h3": { fontSize: "1.02rem", fontWeight: 600, mt: 1.5, mb: 0.5 },
  "& h4": { fontSize: "0.95rem", fontWeight: 600, mt: 1.5, mb: 0.5 },
  "& ul, & ol": { pl: 3, my: 0.75 },
  "& li > p": { my: 0.25 },
  "& blockquote": { borderLeft: 3, borderColor: "divider", pl: 1.5, ml: 0, color: "text.secondary" },
  "& code": { fontSize: "0.85em", bgcolor: "action.hover", px: 0.5, py: 0.1, borderRadius: 0.5 },
  "& pre": { bgcolor: "surface.sunken", p: 1.5, borderRadius: 1, overflowX: "auto", "& code": { bgcolor: "transparent", p: 0 } },
  "& table": { borderCollapse: "collapse", my: 1, fontSize: "0.88rem", minWidth: "50%" },
  "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.5, verticalAlign: "top", textAlign: "left", "& p": { m: 0 } },
  "& th": { bgcolor: "action.hover", fontWeight: 600 },
  "& hr": { border: 0, borderTop: 1, borderColor: "divider", my: 2 },
  "& .mention": { color: "primary.main", fontWeight: 500 },
  // Text color and highlight (see features/posts/editor/formatting.tsx). Dark mode lightens
  // stored colors so a deck's navy or maroon stays readable; highlights keep dark text.
  "& [data-tc]": { color: (t) => (t.palette.mode === "dark" ? "color-mix(in oklab, var(--tc) 62%, white)" : "var(--tc)") },
  "& mark[data-hl]": { bgcolor: "var(--hl, #fff176)", color: "#1f2328", borderRadius: "2px", px: "1px", "& [data-tc]": { color: "var(--tc)" } },
  "& > :first-of-type": { mt: 0 },
  "& > :last-child": { mb: 0 },
};
