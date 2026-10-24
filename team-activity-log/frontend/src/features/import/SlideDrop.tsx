import { SlideshowRounded } from "@mui/icons-material";
import { Box, Paper, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { can, useWs, wsPath } from "../../app/session";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const isPptxDrag = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file" && i.type === PPTX_MIME);

/**
 * Drop a PowerPoint anywhere in the workspace to start an import with it. Reacts only to .pptx
 * drags, so image drops in the editor and comments keep working; the import page has its own zone.
 */
export function SlideDrop() {
  const { org, ws, role } = useWs();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const enabled = can(role, "member") && !ws.archived && !pathname.endsWith("/import");

  useEffect(() => {
    if (!enabled) return;
    const enter = (e: DragEvent) => {
      if (!isPptxDrag(e)) return;
      depth.current += 1;
      setOver(true);
    };
    const overHandler = (e: DragEvent) => {
      if (!isPptxDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!isPptxDrag(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!isPptxDrag(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type === PPTX_MIME || /\.pptx$/i.test(f.name));
      if (file) navigate(wsPath(org, ws, "/import"), { state: { file } });
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overHandler);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", overHandler);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [enabled, navigate, org, ws]);

  if (!over) return null;
  return (
    <Box
      role="status"
      sx={{ position: "fixed", inset: 0, zIndex: 1500, display: "grid", placeItems: "center", pointerEvents: "none", bgcolor: (t) => alpha(t.palette.background.default, 0.85), backdropFilter: "blur(2px)" }}
    >
      <Paper variant="outlined" sx={{ px: 5, py: 4, textAlign: "center", border: 2, borderStyle: "dashed", borderColor: "primary.main", borderRadius: 3, maxWidth: 360 }}>
        <SlideshowRounded color="primary" sx={{ fontSize: 44, mb: 1 }} />
        <Typography variant="h3">Drop to import slides</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Every slide becomes a searchable post.</Typography>
      </Paper>
    </Box>
  );
}
