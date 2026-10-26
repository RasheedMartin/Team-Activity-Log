import { ChevronLeftRounded, ChevronRightRounded } from "@mui/icons-material";
import { Box, ButtonBase, IconButton, Stack, Typography, useMediaQuery } from "@mui/material";
import { useEffect, useState } from "react";
import type { GalleryImage } from "../../api/contract";
import { AnnotationLayer } from "../../components/AnnotationLayer";

/**
 * A picture with its annotations, fitted to a box the way CSS object-fit would ("cover" crops to
 * fill, "contain" letterboxes). The annotation layer is sized and cropped exactly like the image,
 * so shapes land where they were drawn.
 */
export function FittedImage({ img, ratio, fit, large }: { img: GalleryImage; ratio: number; fit: "cover" | "contain"; large?: boolean }) {
  const own = img.width / img.height;
  const wider = own > ratio;
  // Size of the image inside a ratio-shaped box, as a % of the box.
  const [w, h] = fit === "cover" ? (wider ? [(own / ratio) * 100, 100] : [100, (ratio / own) * 100]) : wider ? [100, (ratio / own) * 100] : [(own / ratio) * 100, 100];
  return (
    <Box sx={{ position: "relative", width: "100%", aspectRatio: `${ratio}`, overflow: "hidden", bgcolor: img.dominantColor ?? "action.hover" }}>
      <Box sx={{ position: "absolute", left: "50%", top: "50%", width: `${w}%`, height: `${h}%`, transform: "translate(-50%, -50%)" }}>
        <Box component="img" src={(large && img.imageUrl) || img.thumbUrl} alt="" loading="lazy" sx={{ width: "100%", height: "100%", display: "block" }} />
        <AnnotationLayer shapes={img.annotation?.shapes ?? []} width={img.width} height={img.height} />
      </Box>
    </Box>
  );
}

const label = (img: GalleryImage) => `${img.figureLabel ? `${img.figureLabel} ` : ""}${img.caption ?? "Image"} from ${img.postTitle}`;

/** Owner request: step through the matching images large, above the grid, in the grid's order
 *  (the current sort). Reaching the end of what's loaded loads more. */
export function ImageCarousel({ images, total, onOpen, onNeedMore }: { images: GalleryImage[]; total?: number; onOpen: (img: GalleryImage) => void; onNeedMore?: () => void }) {
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const n = images.length;
  const go = (d: number) => setAt((i) => (i + d + n) % n);
  useEffect(() => {
    if (reduced || paused || n < 2) return;
    const t = setTimeout(() => setAt((i) => (i + 1) % n), 6000);
    return () => clearTimeout(t);
  }, [at, paused, reduced, n]);
  useEffect(() => {
    if (at >= n - 2 && n < (total ?? n)) onNeedMore?.();
  }, [at, n, total, onNeedMore]);
  if (n < 2) return null;
  const img = images[Math.min(at, n - 1)];
  const of = Math.max(total ?? n, n);
  return (
    <Box
      role="region"
      aria-roledescription="carousel"
      aria-label="Highlighted images"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onKeyDown={(e) => (e.key === "ArrowRight" ? go(1) : e.key === "ArrowLeft" ? go(-1) : null)}
      sx={{ position: "relative", mb: 3, borderRadius: 2, overflow: "hidden", bgcolor: "background.paper", border: 1, borderColor: "divider" }}
    >
      <ButtonBase key={img.imageInstanceId} onClick={() => onOpen(img)} aria-label={`Open ${label(img)}`} sx={{ display: "block", width: "100%", animation: reduced ? undefined : "carouselIn 300ms ease-out", "@keyframes carouselIn": { from: { opacity: 0 }, to: { opacity: 1 } } }}>
        <Box sx={{ maxWidth: 900, mx: "auto" }}>
          <FittedImage img={{ ...img, dominantColor: undefined }} ratio={16 / 8} fit="contain" large />
        </Box>
      </ButtonBase>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderTop: 1, borderColor: "divider" }}>
        <Box sx={{ flex: 1, minWidth: 0 }} aria-live="polite">
          <Typography sx={{ fontWeight: 600, fontSize: "0.95rem" }} noWrap>
            {img.figureLabel && `${img.figureLabel} · `}
            {img.caption ?? "Untitled image"}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {img.postTitle} · {Math.min(at, n - 1) + 1} of {of}
          </Typography>
        </Box>
        {n <= 12 && (
        <Stack direction="row" spacing={0.5} sx={{ display: { xs: "none", sm: "flex" } }} role="tablist" aria-label="Choose an image">
          {images.map((x, i) => (
            <Box
              key={x.imageInstanceId}
              component="button"
              role="tab"
              aria-selected={i === at}
              aria-label={`Image ${i + 1}`}
              onClick={() => setAt(i)}
              sx={{ width: i === at ? 18 : 7, height: 7, p: 0, border: 0, borderRadius: 4, cursor: "pointer", bgcolor: i === at ? "primary.main" : "action.disabled", transition: "width 200ms" }}
            />
          ))}
        </Stack>
        )}
        <IconButton onClick={() => go(-1)} aria-label="Previous image"><ChevronLeftRounded /></IconButton>
        <IconButton onClick={() => go(1)} aria-label="Next image"><ChevronRightRounded /></IconButton>
      </Stack>
    </Box>
  );
}
