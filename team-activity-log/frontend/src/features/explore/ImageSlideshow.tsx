import { ChevronLeftRounded, ChevronRightRounded, CloseRounded, OpenInNewRounded, PauseRounded, PlayArrowRounded } from "@mui/icons-material";
import { Box, Button, Dialog, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { FilterSpec } from "../../api/contract";
import { useImage, useSearch } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { AnnotationLayer } from "../../components/AnnotationLayer";
import { useFit } from "../../lib/useFit";

const AUTOPLAY_MS = 5000;

/**
 * Full-screen carousel over every image matching a FilterSpec (owner request: "Instagram-style
 * slideshow of all images of posts with the same tag"). Reused by presenting selections (UI-5).
 */
export function ImageSlideshow({ title, spec, onClose }: { title: string; spec: FilterSpec; onClose: () => void }) {
  const { org, ws, me } = useWs();
  const q = useSearch(org.id, ws.id, { ...spec, view: "gallery", limit: 60 });
  const images = useMemo(() => q.data?.pages.flatMap((p) => p.images ?? []) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total ?? 0;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const cur = images[i];
  const { data: detail } = useImage(org.id, cur?.imageInstanceId);
  const fit = useFit<HTMLDivElement>(cur ? cur.width / cur.height : 4 / 3);
  const reduced = me.preferences.reducedMotion;
  const strip = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (d: number) => {
      setI((x) => {
        const n = Math.max(0, Math.min(images.length - 1, x + d));
        if (n >= images.length - 5 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        return n;
      });
    },
    [images.length, q],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const actions: Record<string, () => void> = {
        ArrowRight: () => go(1),
        PageDown: () => go(1),
        j: () => go(1),
        ArrowLeft: () => go(-1),
        PageUp: () => go(-1),
        k: () => go(-1),
        " ": () => setPlaying((p) => !p),
      };
      const act = actions[e.key];
      if (act) {
        e.preventDefault();
        act();
      } else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(images.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, images.length]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => (i >= images.length - 1 && !q.hasNextPage ? setPlaying(false) : go(1)), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [playing, i, images.length, go, q.hasNextPage]);

  // Keep the active thumbnail in view; preload the next image.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
    const next = images[i + 1];
    if (next) new Image().src = next.thumbUrl;
  }, [i, images, reduced]);

  const touch = useRef<number | null>(null);
  const original = detail?.asset.variants.find((v) => v.name === "original")?.url ?? cur?.thumbUrl;

  return (
    <Dialog open fullScreen onClose={onClose} slotProps={{ paper: { "aria-label": `${title} slideshow`, sx: { bgcolor: "#0b0c0f", color: "#e6e8eb" } } as object }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>{title}</Typography>
          <Typography variant="caption" sx={{ color: "#9aa3ad" }} aria-live="polite">
            {images.length ? `${i + 1} of ${total.toLocaleString()} images` : q.isPending ? "Loading…" : "No images"}
          </Typography>
        </Box>
        <Tooltip title={playing ? "Pause (Space)" : "Play (Space)"}>
          <IconButton onClick={() => setPlaying(!playing)} sx={{ color: "#c2c7cf" }} aria-label={playing ? "Pause slideshow" : "Play slideshow"} disabled={images.length < 2}>
            {playing ? <PauseRounded /> : <PlayArrowRounded />}
          </IconButton>
        </Tooltip>
        {cur && (
          <Button component={RouterLink} to={wsPath(org, ws, `/p/${cur.postId}`)} startIcon={<OpenInNewRounded />} sx={{ color: "#c2c7cf" }}>
            Open post
          </Button>
        )}
        <IconButton onClick={onClose} sx={{ color: "#c2c7cf" }} aria-label="Close slideshow"><CloseRounded /></IconButton>
      </Stack>

      <Box
        sx={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current === null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          touch.current = null;
        }}
      >
        <IconButton onClick={() => go(-1)} disabled={i === 0} aria-label="Previous image" sx={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", zIndex: 2, color: "#fff", bgcolor: "rgba(0,0,0,0.35)", "&:hover": { bgcolor: "rgba(0,0,0,0.55)" } }}>
          <ChevronLeftRounded fontSize="large" />
        </IconButton>
        <Box ref={fit.ref} sx={{ flex: 1, mx: 8, my: 1, display: "grid", placeItems: "center", minWidth: 0 }}>
          {cur && (
            <Box key={cur.imageInstanceId} sx={{ position: "relative", width: fit.width, height: fit.height, bgcolor: cur.dominantColor ?? "#222", animation: reduced ? "none" : "tal-fade 160ms ease-out", "@keyframes tal-fade": { from: { opacity: 0 }, to: { opacity: 1 } } }}>
              <Box component="img" src={original} alt={detail?.altText ?? cur.caption ?? ""} sx={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />
              {detail && <AnnotationLayer shapes={detail.annotation?.shapes ?? []} width={detail.asset.width} height={detail.asset.height} />}
            </Box>
          )}
        </Box>
        <IconButton onClick={() => go(1)} disabled={i >= images.length - 1} aria-label="Next image" sx={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", zIndex: 2, color: "#fff", bgcolor: "rgba(0,0,0,0.35)", "&:hover": { bgcolor: "rgba(0,0,0,0.55)" } }}>
          <ChevronRightRounded fontSize="large" />
        </IconButton>
      </Box>

      {cur && (
        <Box sx={{ px: 2, py: 1, textAlign: "center" }}>
          <Typography variant="body2">
            {cur.figureLabel && <b>{cur.figureLabel}. </b>}
            {cur.caption ?? ""}
          </Typography>
          <Typography variant="caption" sx={{ color: "#9aa3ad" }}>From “{cur.postTitle}”</Typography>
        </Box>
      )}
      <Box ref={strip} role="tablist" aria-label="Images" sx={{ display: "flex", gap: 0.75, overflowX: "auto", px: 2, pb: 1.5, pt: 0.5 }}>
        {images.map((img, k) => (
          <Box
            key={img.imageInstanceId}
            component="button"
            role="tab"
            aria-selected={k === i}
            aria-label={`Image ${k + 1}: ${img.caption ?? img.postTitle}`}
            data-i={k}
            onClick={() => setI(k)}
            sx={{ p: 0, flexShrink: 0, width: 72, height: 48, borderRadius: 0.5, overflow: "hidden", cursor: "pointer", border: 2, borderColor: k === i ? "#8ea2ff" : "transparent", opacity: k === i ? 1 : 0.55, bgcolor: img.dominantColor ?? "#222", "&:hover": { opacity: 1 } }}
          >
            <Box component="img" src={img.thumbUrl} alt="" loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
