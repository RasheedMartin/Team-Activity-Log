import {
  ChevronLeftRounded,
  ChevronRightRounded,
  CloseRounded,
  GridViewRounded,
  OpenInNewRounded,
  RadioButtonCheckedRounded,
} from "@mui/icons-material";
import { Box, Button, IconButton, InputBase, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCollection, usePeople, usePostDetails, useTags } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { EmptyState } from "../../components/ui";
import { deriveSlides, type Slide } from "../../lib/slides";
import { SlideFrame } from "./SlideView";

type Msg = { type: "go"; index: number } | { type: "hello" };

/** Which posts to present: one (/p/:id/present), a selection (?posts=a,b), or a collection (?collection=id). */
function useDeckPostIds(): { ids: string[]; title: string; back: string } {
  const { postId } = useParams();
  const [params] = useSearchParams();
  const { org, ws } = useWs();
  const collectionId = params.get("collection");
  const { data: c } = useCollection(org.id, ws.id, postId ? undefined : collectionId);
  if (postId) return { ids: [postId], title: "", back: wsPath(org, ws, `/p/${postId}`) };
  if (collectionId) {
    return { ids: c?.postIds ?? [], title: c?.name ?? "", back: c?.kind === "notebook" ? wsPath(org, ws, `/notebooks/${collectionId}`) : wsPath(org, ws) };
  }
  return { ids: (params.get("posts") ?? "").split(",").filter(Boolean), title: "Selection", back: wsPath(org, ws) };
}

export default function PresentPage() {
  const { org, me } = useWs();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const presenter = params.get("presenter") === "1";
  const { ids, title, back } = useDeckPostIds();
  // Posts are read individually from the Postgres-owned detail route (presenting isn't a search).
  const posts = usePostDetails(org.id, ids);
  const { data: peopleList = [] } = usePeople(org.id);
  const { data: tagData } = useTags(org.id);
  const people = useMemo(() => new Map(peopleList.map((p) => [p.id, p])), [peopleList]);
  const tags = useMemo(() => new Map((tagData?.tags ?? []).map((t) => [t.id, t])), [tagData]);
  const loaded = posts.every((p) => p.data);
  const slides: Slide[] = useMemo(() => (loaded ? posts.flatMap((p) => deriveSlides(p.data!.post, p.data!.images)) : []), [loaded, posts]);

  const [index, setIndex] = useState(() => Math.max(0, Number(params.get("s") ?? 1) - 1));
  const [overview, setOverview] = useState(false);
  const [laser, setLaser] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [chrome, setChrome] = useState(true);
  const [jump, setJump] = useState("");
  const jumpRef = useRef<HTMLInputElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduced = me.preferences.reducedMotion;

  // Presenter view sync: both windows share the current slide. The channel lives in an effect
  // (StrictMode-safe); refs give its handler the latest index without re-subscribing.
  const channelName = `tal-present-${ids.join(",")}`;
  const channel = useRef<BroadcastChannel | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const slideCount = useRef(0);
  slideCount.current = slides.length;
  const go = useCallback((i: number, from?: "remote") => {
    const n = Math.max(0, Math.min(slideCount.current - 1, i));
    if (n === indexRef.current) return;
    setIndex(n);
    if (from !== "remote") channel.current?.postMessage({ type: "go", index: n } satisfies Msg);
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(channelName);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data.type === "go") go(e.data.index, "remote");
      if (e.data.type === "hello") ch.postMessage({ type: "go", index: indexRef.current } satisfies Msg);
    };
    if (presenter) ch.postMessage({ type: "hello" } satisfies Msg);
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [channelName, presenter, go]);

  // Keep ?s= in the URL so a reload returns to the same slide.
  useEffect(() => {
    if (!slides.length) return;
    const p = new URLSearchParams(params);
    if (p.get("s") !== String(index + 1)) {
      p.set("s", String(index + 1));
      setParams(p, { replace: true });
    }
  }, [index, slides.length, params, setParams]);

  const exit = useCallback(() => {
    if (presenter) window.close();
    else navigate(back);
  }, [navigate, back, presenter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === jumpRef.current) return;
      const k = e.key;
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(k)) {
        e.preventDefault();
        go(index + 1);
      } else if (["ArrowLeft", "PageUp", "Backspace"].includes(k)) {
        e.preventDefault();
        go(index - 1);
      } else if (k === "Home") go(0);
      else if (k === "End") go(slides.length - 1);
      else if (k.toLowerCase() === "o") setOverview((o) => !o);
      else if (k.toLowerCase() === "l") setLaser((l) => !l);
      else if (k.toLowerCase() === "g") {
        e.preventDefault();
        setChrome(true);
        setTimeout(() => jumpRef.current?.focus(), 0);
      } else if (k.toLowerCase() === "p" && !presenter) window.open(`${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(params), presenter: "1" })}`, "tal-presenter", "width=1100,height=720");
      else if (k === "Escape") {
        if (overview) setOverview(false);
        else exit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, slides.length, overview, exit, presenter, params]);

  const wake = () => {
    setChrome(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setChrome(false), 2200);
  };
  useEffect(() => () => clearTimeout(idle.current), []);

  const touch = useRef<number | null>(null);
  const slide = slides[index];

  if (!ids.length) return <EmptyState title="Nothing to present" body="Pick posts from search, or open a post and press Present." />;
  if (!loaded)
    return (
      <Box sx={{ height: "100dvh", bgcolor: "#0b0c0f", p: 4 }}>
        <Skeleton variant="rounded" sx={{ bgcolor: "#1b1f24", height: "100%" }} />
      </Box>
    );

  if (presenter) return <PresenterView slides={slides} index={index} go={go} people={people} tags={tags} />;

  return (
    <Box
      onMouseMove={(e) => {
        wake();
        if (laser) setPointer({ x: e.clientX, y: e.clientY });
      }}
      onClick={(e) => {
        if (overview || (e.target as HTMLElement).closest("button, input")) return;
        go(e.clientX > window.innerWidth / 3 ? index + 1 : index - 1);
      }}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 40) go(dx < 0 ? index + 1 : index - 1);
        touch.current = null;
      }}
      role="region"
      aria-roledescription="presentation"
      aria-label={title || "Presentation"}
      sx={{ height: "100dvh", width: "100vw", bgcolor: "#0b0c0f", position: "fixed", inset: 0, zIndex: 1300, cursor: laser ? "none" : chrome ? "default" : "none", userSelect: "none" }}
    >
      <Box sx={{ position: "absolute", inset: { xs: 8, md: 24 }, bottom: { xs: 56, md: 64 } }} aria-live="polite" aria-atomic>
        {slide && (
          <Box key={index} sx={{ width: "100%", height: "100%", animation: reduced ? "none" : "tal-slide-in 160ms ease-out", "@keyframes tal-slide-in": { from: { opacity: 0 }, to: { opacity: 1 } } }}>
            <SlideFrame slide={slide} people={people} tags={tags} interactive />
          </Box>
        )}
      </Box>

      {laser && pointer && <Box sx={{ position: "fixed", left: pointer.x - 7, top: pointer.y - 7, width: 14, height: 14, borderRadius: "50%", bgcolor: "#ff2d2d", boxShadow: "0 0 12px 4px rgba(255,45,45,0.6)", pointerEvents: "none", zIndex: 5 }} />}

      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        onClick={(e) => e.stopPropagation()}
        sx={{ position: "absolute", left: 0, right: 0, bottom: 0, px: 2, py: 1, color: "#c2c7cf", opacity: chrome || overview ? 1 : 0, transition: "opacity 200ms" }}
      >
        <IconButton onClick={() => go(index - 1)} disabled={index === 0} sx={{ color: "inherit" }} aria-label="Previous slide"><ChevronLeftRounded /></IconButton>
        <Typography variant="body2" sx={{ minWidth: 70, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {index + 1} / {slides.length}
        </Typography>
        <IconButton onClick={() => go(index + 1)} disabled={index >= slides.length - 1} sx={{ color: "inherit" }} aria-label="Next slide"><ChevronRightRounded /></IconButton>
        <InputBase
          inputRef={jumpRef}
          value={jump}
          onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && jump) {
              go(Number(jump) - 1);
              setJump("");
              jumpRef.current?.blur();
            }
            if (e.key === "Escape") jumpRef.current?.blur();
          }}
          placeholder="Go to…"
          inputProps={{ "aria-label": "Go to slide", inputMode: "numeric" }}
          sx={{ width: 70, color: "inherit", fontSize: 13, border: "1px solid #333", borderRadius: 1, px: 1 }}
        />
        <Typography variant="caption" sx={{ flex: 1, textAlign: "center", color: "#8a929c" }} noWrap>
          {title}
        </Typography>
        <Tooltip title="Overview (O)"><IconButton onClick={() => setOverview(!overview)} sx={{ color: overview ? "#8ea2ff" : "inherit" }} aria-label="Slide overview" aria-pressed={overview}><GridViewRounded /></IconButton></Tooltip>
        <Tooltip title="Laser pointer (L)"><IconButton onClick={() => setLaser(!laser)} sx={{ color: laser ? "#ff5a5a" : "inherit" }} aria-label="Laser pointer" aria-pressed={laser}><RadioButtonCheckedRounded /></IconButton></Tooltip>
        <Tooltip describeChild title="Presenter view with notes (P)">
          <Button size="small" startIcon={<OpenInNewRounded />} sx={{ color: "inherit" }} onClick={() => window.open(`${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(params), presenter: "1" })}`, "tal-presenter", "width=1100,height=720")}>
            Notes
          </Button>
        </Tooltip>
        <Tooltip title="Exit (Esc)"><IconButton onClick={exit} sx={{ color: "inherit" }} aria-label="Exit presentation"><CloseRounded /></IconButton></Tooltip>
      </Stack>

      {overview && (
        <Box onClick={(e) => e.stopPropagation()} sx={{ position: "absolute", inset: 0, bottom: 56, bgcolor: "rgba(11,12,15,0.96)", overflow: "auto", p: 3, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2, alignContent: "start" }} role="listbox" aria-label="All slides">
          {slides.map((s, i) => (
            <Box key={i} role="option" aria-selected={i === index} tabIndex={0} onClick={() => (go(i), setOverview(false))} onKeyDown={(e) => {
                if (e.key === "Enter") {
                  go(i);
                  setOverview(false);
                }
              }} sx={{ cursor: "pointer", outline: i === index ? "3px solid #8ea2ff" : "none", borderRadius: 0.5 }}>
              <Box sx={{ aspectRatio: "16 / 9" }}>
                <SlideFrame slide={s} people={people} tags={tags} />
              </Box>
              <Typography variant="caption" sx={{ color: "#8a929c" }}>{i + 1}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Second window: current + next slide, notes, timer. Notes never appear on the main screen (§W5.1). */
function PresenterView({ slides, index, go, people, tags }: { slides: Slide[]; index: number; go: (i: number) => void; people: Map<string, import("../../api/contract").User>; tags: Map<string, import("../../api/contract").Tag> }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.floor((now - start) / 1000);
  const notes = slides[index]?.notes;
  return (
    <Box sx={{ height: "100dvh", bgcolor: "#0b0c0f", color: "#e6e8eb", p: 2, display: "grid", gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr auto", gap: 2 }}>
      <Box sx={{ minHeight: 0 }}>
        {slides[index] && (
          <SlideFrame slide={slides[index]} people={people} tags={tags} />
        )}
      </Box>
      <Stack spacing={2} sx={{ minHeight: 0 }}>
        <Typography variant="overline" sx={{ color: "#8a929c" }}>Next</Typography>
        <Box sx={{ aspectRatio: "16 / 9" }}>
          {slides[index + 1] ? (
            <SlideFrame slide={slides[index + 1]} people={people} tags={tags} />
          ) : (
            <Typography sx={{ color: "#8a929c" }}>End of deck</Typography>
          )}
        </Box>
        <Typography variant="overline" sx={{ color: "#8a929c" }}>Notes</Typography>
        <Typography sx={{ whiteSpace: "pre-wrap", fontSize: 18, overflow: "auto", flex: 1 }}>{notes || "No notes for this slide."}</Typography>
      </Stack>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ gridColumn: "1 / -1" }}>
        <Button onClick={() => go(index - 1)} disabled={index === 0} sx={{ color: "#c2c7cf" }} startIcon={<ChevronLeftRounded />}>Previous</Button>
        <Typography sx={{ fontVariantNumeric: "tabular-nums" }}>{index + 1} / {slides.length}</Typography>
        <Button onClick={() => go(index + 1)} disabled={index >= slides.length - 1} sx={{ color: "#c2c7cf" }} endIcon={<ChevronRightRounded />}>Next</Button>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontVariantNumeric: "tabular-nums", fontSize: 22 }}>{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</Typography>
      </Stack>
    </Box>
  );
}
