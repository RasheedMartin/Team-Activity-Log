import { Box, Stack, Typography } from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import type { ID, Tag, User } from "../../api/contract";
import { AnnotationLayer } from "../../components/AnnotationLayer";
import { RichText } from "../../components/RichText";
import { SlideCanvas } from "../../components/SlideCanvas";
import { formatDay } from "../../lib/dates";
import { fontStack } from "../../components/slideStyles";
import { ensureWebFonts } from "../../lib/slideFonts";
import { muted, THEMES, type Theme } from "../../lib/themes";
import { useFit } from "../../lib/useFit";
import type { Slide } from "../../lib/slides";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/** Render a slide on a fixed 1280×720 canvas scaled to its container (consistent type at any size). */
export function ScaledSlide({ children, background = "#ffffff" }: { children: ReactNode; background?: string }) {
  const fit = useFit<HTMLDivElement>(SLIDE_W / SLIDE_H);
  const scale = fit.width / SLIDE_W;
  return (
    <Box ref={fit.ref} sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", overflow: "hidden" }}>
      <Box data-slide-surface sx={{ width: fit.width, height: fit.height, position: "relative", overflow: "hidden", bgcolor: background, boxShadow: 6, borderRadius: 0.5 }}>
        <Box sx={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", top: 0, left: 0 }}>{children}</Box>
      </Box>
    </Box>
  );
}


function ZoomableImage({ slide, interactive }: { slide: Extract<Slide, { kind: "content" }>; interactive: boolean }) {
  const img = slide.image!;
  const a = img.asset;
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const maxW = slide.text.length ? 760 : 1180;
  const maxH = slide.heading ? 560 : 640;
  const s = Math.min(maxW / a.width, maxH / a.height);
  const w = a.width * s;
  const h = a.height * s;
  return (
    <Box
      onClick={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setZoom(zoom ? null : { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
      }}
      sx={{ width: w, height: h, position: "relative", overflow: "hidden", flexShrink: 0, cursor: interactive ? (zoom ? "zoom-out" : "zoom-in") : "default", bgcolor: a.dominantColors[0] ?? "#eee" }}
    >
      <Box sx={{ position: "absolute", inset: 0, transform: zoom ? "scale(2.2)" : "none", transformOrigin: zoom ? `${zoom.x}% ${zoom.y}%` : "50% 50%", transition: "transform 200ms ease-out" }}>
        <Box component="img" src={(a.variants.find((v) => v.name === "original") ?? a.variants[0])?.url} alt={img.altText ?? ""} sx={{ width: "100%", height: "100%", display: "block" }} />
        <AnnotationLayer shapes={img.annotation?.shapes ?? []} width={a.width} height={a.height} />
      </Box>
    </Box>
  );
}

/** Any slide, sized to its container: designed slides at their own aspect, others on the 16:9
 *  canvas in the theme. */
export function SlideFrame({ slide, people, tags, theme = THEMES[0], interactive = false }: { slide: Slide; people: Map<ID, User>; tags: Map<ID, Tag>; theme?: Theme; interactive?: boolean }) {
  useEffect(() => ensureWebFonts([theme.headingFont, theme.bodyFont].filter((f): f is string => !!f)), [theme.headingFont, theme.bodyFont]);
  if (slide.kind === "designed") return <DesignedFrame slide={slide} />;
  return (
    <ScaledSlide background={theme.background}>
      <SlideBody slide={slide} people={people} tags={tags} theme={theme} interactive={interactive} />
    </ScaledSlide>
  );
}

function DesignedFrame({ slide }: { slide: Extract<Slide, { kind: "designed" }> }) {
  const { w, h } = slide.design.size;
  const fit = useFit<HTMLDivElement>(w / h);
  return (
    <Box ref={fit.ref} sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", overflow: "hidden" }}>
      <Box sx={{ width: fit.width }}>{fit.width > 0 && <SlideCanvas design={slide.design} images={slide.images} quality="original" />}</Box>
    </Box>
  );
}

export function SlideBody({ slide, people, tags, theme = THEMES[0], interactive = false }: { slide: Exclude<Slide, { kind: "designed" }>; people: Map<ID, User>; tags: Map<ID, Tag>; theme?: Theme; interactive?: boolean }) {
  const ink = { color: theme.text, fontFamily: fontStack(theme.bodyFont) };
  const headingFont = fontStack(theme.headingFont ?? theme.bodyFont);
  if (slide.kind === "title") {
    const author = people.get(slide.authorId);
    return (
      <Stack justifyContent="center" sx={{ height: "100%", px: 12, ...ink }}>
        <Box sx={{ width: 96, height: 6, bgcolor: theme.accent, borderRadius: 1, mb: 3 }} />
        <Typography sx={{ fontSize: 22, color: theme.accent, fontFamily: "inherit", fontWeight: 600, mb: 2, letterSpacing: "0.04em", textTransform: "uppercase" }}>{formatDay(slide.workDate)}</Typography>
        <Typography sx={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em", mb: 3, color: theme.heading, fontFamily: headingFont }}>{slide.title}</Typography>
        {slide.summary && <Typography sx={{ fontSize: 28, color: muted(theme), fontFamily: "inherit", mb: 4, maxWidth: 1000 }}>{slide.summary}</Typography>}
        <Typography sx={{ fontSize: 24, color: muted(theme), fontFamily: "inherit" }}>
          {author?.name ?? ""}
          {slide.tagIds.length > 0 && " · "}
          {slide.tagIds.map((id) => tags.get(id)?.name).filter(Boolean).join(" · ")}
        </Typography>
      </Stack>
    );
  }
  const hasText = slide.text.length > 0;
  return (
    <Stack sx={{ height: "100%", px: 6, py: 4.5, ...ink }}>
      {slide.heading && <Typography sx={{ fontSize: 40, fontWeight: 700, mb: 2.5, letterSpacing: "-0.01em", color: theme.heading, fontFamily: headingFont }}>{slide.heading}</Typography>}
      <Stack direction="row" spacing={4} alignItems="center" sx={{ flex: 1, minHeight: 0 }}>
        {slide.image && <ZoomableImage slide={slide} interactive={interactive} />}
        {hasText && (
          <RichText
            doc={{ type: "doc", content: slide.text }}
            sx={{ flex: 1, fontSize: slide.image ? 24 : 30, lineHeight: 1.45, color: theme.text, fontFamily: "inherit", "& p": { my: 1.25 }, "& li": { my: 0.5 }, "& h2, & h3": { fontSize: "1.2em", color: theme.heading, fontFamily: headingFont }, "& a": { color: theme.accent }, "& li::marker": { color: theme.accent }, "& [data-tc]": { color: "var(--tc)" }, "& th, & td": { borderColor: muted(theme) } }}
          />
        )}
      </Stack>
    </Stack>
  );
}
