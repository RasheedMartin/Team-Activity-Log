import {
  AddPhotoAlternateOutlined,
  ArrowRightAltRounded,
  CategoryOutlined,
  CircleOutlined,
  CropSquareRounded,
  DeleteOutlineRounded,
  FlipToBackRounded,
  FlipToFrontRounded,
  FormatColorFillRounded,
  HorizontalRuleRounded,
  MoreHorizRounded,
  RectangleOutlined,
  TextFieldsRounded,
  VerticalAlignBottomRounded,
  VerticalAlignCenterRounded,
  VerticalAlignTopRounded,
  ChangeHistoryRounded,
  BorderColorRounded,
  WallpaperRounded,
} from "@mui/icons-material";
import { Box, Button, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Popover, Stack, Tooltip, Typography } from "@mui/material";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { ID, ImageView, SlideDesign, SlideElement, SlideShape } from "../../../api/contract";
import { SlideCanvas } from "../../../components/SlideCanvas";
import { boxTextSx, slideProseSx } from "../../../components/slideStyles";
import { hasTable } from "../../../lib/prosemirror";
import { bringOn, imageElement, keepOn, newElement, offSlide } from "../../../lib/slideLayouts";
import { HIGHLIGHTS, TEXT_COLORS, formattingExtensions, slideTextExtensions, tableExtensions } from "./formatting";
import { EditorToolbar } from "./TextBlockEditor";

// Edit a designed slide in place (slides step 3): click to select, drag to move, handles to
// resize, double-click (or Enter) to edit text with the same tools as post text, arrow keys to
// nudge (Shift: 10 pt). Works with touch. Geometry changes are drafted locally while dragging and
// committed on release, so the post isn't re-saved on every pointer move.

type El = SlideElement;
type TextLike = Extract<El, { kind: "text" | "shape" | "chart" }>;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];
const MIN = 8;
const SNAP = 6;

const SHAPES: { id: SlideShape; label: string; icon: ReactNode }[] = [
  { id: "rect", label: "Rectangle", icon: <RectangleOutlined fontSize="small" /> },
  { id: "roundRect", label: "Rounded rectangle", icon: <CropSquareRounded fontSize="small" /> },
  { id: "ellipse", label: "Ellipse", icon: <CircleOutlined fontSize="small" /> },
  { id: "triangle", label: "Triangle", icon: <ChangeHistoryRounded fontSize="small" /> },
  { id: "line", label: "Line", icon: <HorizontalRuleRounded fontSize="small" /> },
  { id: "arrow", label: "Arrow", icon: <ArrowRightAltRounded fontSize="small" /> },
];
const FILLS = ["#ffffff", "#000000", "#1f2328", "#4472c4", "#ed7d31", ...TEXT_COLORS.map((c) => c.value), ...HIGHLIGHTS.map((c) => c.value)];

const describe = (e: El) => {
  if (e.kind === "image") return "Picture";
  const text = (JSON.stringify(e.doc ?? "").match(/"text":"([^"]*)"/g) ?? []).map((m) => m.slice(8, -1)).join(" ").trim();
  const what = e.kind === "chart" ? "Chart" : e.kind === "shape" ? (SHAPES.find((s) => s.id === e.shape)?.label ?? "Shape") : e.role === "title" ? "Title" : "Text box";
  return text ? `${what}: ${text.slice(0, 40)}` : what;
};

function Swatches({ value, onPick, allowNone }: { value?: string; onPick: (c?: string) => void; allowNone?: boolean }) {
  return (
    <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", maxWidth: 260 }}>
      {allowNone && (
        <Button size="small" variant={value ? "outlined" : "contained"} onClick={() => onPick(undefined)} sx={{ minWidth: 0, px: 1, height: 28 }}>
          None
        </Button>
      )}
      {FILLS.map((c) => (
        <Box key={c} component="button" type="button" aria-label={`Color ${c}`} aria-pressed={value === c} onClick={() => onPick(c)} sx={{ width: 28, height: 28, borderRadius: 1, border: 2, borderColor: value === c ? "primary.main" : "divider", bgcolor: c, cursor: "pointer", p: 0 }} />
      ))}
    </Stack>
  );
}

function ColorButton({ label, icon, value, onPick, allowNone }: { label: string; icon: ReactNode; value?: string; onPick: (c?: string) => void; allowNone?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title={label}>
        <IconButton size="small" aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={(e) => setAnchor(e.currentTarget)} sx={{ borderRadius: 1, "& svg": { fontSize: 18 } }}>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {icon}
            <Box sx={{ width: 14, height: 3, borderRadius: 1, mt: "-2px", bgcolor: value ?? "transparent", border: value ? 0 : 1, borderColor: "divider" }} />
          </Box>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} disableRestoreFocus anchorOrigin={{ vertical: "bottom", horizontal: "left" }} slotProps={{ paper: { sx: { p: 1.5, maxWidth: "calc(100vw - 32px)" } } }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>{label}</Typography>
        <Swatches
          value={value}
          allowNone={allowNone}
          onPick={(c) => {
            onPick(c);
            // Back to the slide, so keyboard shortcuts keep working on the selection.
            const editor = anchor?.closest<HTMLElement>("[data-slide-editor]");
            setAnchor(null);
            requestAnimationFrame(() => editor?.focus({ preventScroll: true }));
          }}
        />
      </Popover>
    </>
  );
}

/** In-place text editor for one element, laid out exactly like the rendered text. */
function SlideTextEditor({ e, fonts, onDoc, onEditor, onDone }: { e: TextLike; fonts: SlideDesign["fonts"]; onDoc: (doc: unknown) => void; onEditor: (ed: Editor | null) => void; onDone: () => void }) {
  const onDocRef = useRef(onDoc);
  useEffect(() => {
    onDocRef.current = onDoc;
  });
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }), ...formattingExtensions, ...slideTextExtensions, ...(hasTable(e.doc) ? tableExtensions : [])],
    content: (e.doc as object) ?? { type: "doc", content: [{ type: "paragraph" }] },
    autofocus: "end",
    immediatelyRender: true,
    onUpdate: ({ editor: ed }) => onDocRef.current(ed.getJSON()),
    editorProps: { attributes: { "aria-label": "Slide text", role: "textbox", "aria-multiline": "true" } },
  });
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  return (
    <Box
      onPointerDown={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === "Escape") onDone();
      }}
      sx={[boxTextSx(e, fonts), { outline: "none", cursor: "text", "& .ProseMirror": { outline: "none", minHeight: "1em" } }] as never}
    >
      <Box sx={slideProseSx}>
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}

interface Props {
  design: SlideDesign;
  images: Map<ID, ImageView>;
  label: string;
  onChange: (design: SlideDesign) => void;
  onUploadImage: (file: File) => Promise<ImageView>;
  onConvertToText: () => void;
}

export function SlideEditor({ design, images, label, onChange, onUploadImage, onConvertToText }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<SlideDesign | null>(null); // geometry while dragging
  const [textEditor, setTextEditor] = useState<Editor | null>(null);
  const [shapeMenu, setShapeMenu] = useState<HTMLElement | null>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const shown = draft ?? design;
  const { w: W, h: H } = design.size;
  const sel = shown.elements.find((e) => e.id === selected);
  const lost = design.elements.filter((e) => offSlide(e, W, H));

  const setElements = (elements: El[]) => onChange({ ...design, elements });
  const update = (id: string, patch: Partial<El>) => setElements(design.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as El) : e)));
  const add = (e: El, edit = false) => {
    setElements([...design.elements, e]);
    setSelected(e.id);
    setEditing(edit ? e.id : null);
    if (!edit) requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
  };
  const remove = (id: string) => {
    setElements(design.elements.filter((e) => e.id !== id));
    setSelected(null);
    setEditing(null);
  };
  const arrange = (id: string, to: "front" | "back") => {
    const e = design.elements.find((x) => x.id === id)!;
    const rest = design.elements.filter((x) => x.id !== id);
    setElements(to === "front" ? [...rest, e] : [e, ...rest]);
  };

  // ---- drag & resize (pointer events: mouse, pen, touch) ----
  const gesture = useRef<{ id: string; handle?: Handle; px: number; py: number; box: { x: number; y: number; w: number; h: number }; scale: number; moved: boolean } | null>(null);
  const snap = (v: number, targets: number[]) => targets.reduce((best, t) => (Math.abs(v - t) < SNAP && Math.abs(v - t) < Math.abs(v - best) ? t : best), v);
  const begin = (ev: PointerEvent, e: El, scale: number, handle?: Handle) => {
    ev.stopPropagation();
    ev.preventDefault();
    // Keyboard shortcuts (Delete, arrows) need the editor focused; the browser's own handling of
    // the press runs after this, so focus again once it's done.
    requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
    if (editing && editing !== e.id) setEditing(null);
    setSelected(e.id);
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    gesture.current = { id: e.id, handle, px: ev.clientX, py: ev.clientY, box: { x: e.x, y: e.y, w: e.w, h: e.h }, scale, moved: false };
  };
  const drag = (ev: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = (ev.clientX - g.px) / g.scale;
    const dy = (ev.clientY - g.py) / g.scale;
    if (!g.moved && Math.hypot(dx, dy) * g.scale < 3) return; // a click, not a drag
    g.moved = true;
    const b = { ...g.box };
    const e = design.elements.find((x) => x.id === g.id)!;
    if (!g.handle) {
      b.x = keepOn(snap(g.box.x + dx, [0, W / 2 - b.w / 2, W - b.w]), b.w, W);
      b.y = keepOn(snap(g.box.y + dy, [0, H / 2 - b.h / 2, H - b.h]), b.h, H);
    } else {
      const hd = g.handle;
      if (hd.includes("e")) b.w = g.box.w + dx;
      if (hd.includes("s")) b.h = g.box.h + dy;
      if (hd.includes("w")) {
        b.w = g.box.w - dx;
        b.x = g.box.x + dx;
      }
      if (hd.includes("n")) {
        b.h = g.box.h - dy;
        b.y = g.box.y + dy;
      }
      const isLine = e.kind === "shape" && (e.shape === "line" || e.shape === "arrow");
      const minH = isLine ? 0 : MIN;
      if (e.kind === "image" && hd.length === 2) {
        // corners keep a picture's proportions
        const ratio = g.box.w / Math.max(1, g.box.h);
        b.h = b.w / ratio;
        if (hd.includes("n")) b.y = g.box.y + g.box.h - b.h;
      }
      if (b.w < MIN) {
        if (hd.includes("w")) b.x -= MIN - b.w;
        b.w = MIN;
      }
      if (b.h < minH) {
        if (hd.includes("n")) b.y -= minH - b.h;
        b.h = minH;
      }
    }
    const r = (v: number) => Math.round(v * 2) / 2;
    setDraft({ ...design, elements: design.elements.map((x) => (x.id === g.id ? ({ ...x, x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) } as El) : x)) });
  };
  const end = () => {
    root.current?.focus({ preventScroll: true });
    const g = gesture.current;
    gesture.current = null;
    if (g?.moved && draft) onChange(draft);
    setDraft(null);
  };

  // ---- keyboard (when the slide, not its text, has focus) ----
  const onKey = (ev: globalThis.KeyboardEvent) => {
    if (!sel) return;
    const step = ev.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (nudge[ev.key]) {
      ev.preventDefault();
      update(sel.id, { x: keepOn(sel.x + nudge[ev.key][0], sel.w, W), y: keepOn(sel.y + nudge[ev.key][1], sel.h, H) });
    } else if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      remove(sel.id);
    } else if (ev.key === "Enter" && sel.kind !== "image") {
      ev.preventDefault();
      setEditing(sel.id);
    } else if (ev.key === "Escape") setSelected(null);
  };

  // Shortcuts act on the selection wherever focus is (a press on the slide doesn't reliably leave
  // focus here), except while typing somewhere. A press outside this slide clears its selection,
  // so only one slide on the page answers.
  const onKeyRef = useRef(onKey);
  useEffect(() => {
    onKeyRef.current = onKey;
  });
  useEffect(() => {
    if (!selected || editing) return;
    // Not while typing, and not for keys meant for a menu, picker, or dialog.
    const elsewhere = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest(".MuiPopover-root, .MuiDialog-root, [role=menu]"));
    const onKeyDown = (ev: globalThis.KeyboardEvent) => !elsewhere(ev.target) && onKeyRef.current(ev);
    const onDown = (ev: globalThis.PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (!root.current?.contains(t) && !t.closest(".MuiPopover-root, .MuiMenu-root, .MuiDialog-root")) setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [selected, editing]);

  const pickImage = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      add(imageElement(await onUploadImage(file), { x: W * 0.25, y: H * 0.2, w: W * 0.5, h: H * 0.6 }));
    } finally {
      setBusy(false);
    }
  };

  const overlay = (scale: number) => (
    <Box
      onPointerDown={(ev) => {
        if (ev.target === ev.currentTarget) {
          setSelected(null);
          setEditing(null);
        }
      }}
      sx={{ position: "absolute", inset: 0 }}
    >
      {shown.elements.map((e) => {
        const isSel = e.id === selected;
        if (e.id === editing && e.kind !== "image")
          return (
            <Box key={e.id} sx={{ position: "absolute", left: e.x, top: e.y, width: e.w, height: e.h, outline: `${2 / scale}px solid`, outlineColor: "primary.main", transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined }}>
              <SlideTextEditor e={e} fonts={design.fonts} onDoc={(doc) => update(e.id, { doc })} onEditor={setTextEditor} onDone={() => (setEditing(null), root.current?.focus())} />
            </Box>
          );
        const line = e.kind === "shape" && (e.shape === "line" || e.shape === "arrow");
        const hit = line ? 8 / scale : 0; // lines are thin; give them something to grab
        return (
          <Box
            key={e.id}
            role="button"
            tabIndex={-1}
            aria-label={describe(e)}
            aria-pressed={isSel}
            data-slide-hit={e.id}
            onPointerDown={(ev) => begin(ev, e, scale)}
            onPointerMove={drag}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => e.kind !== "image" && setEditing(e.id)}
            sx={{
              position: "absolute",
              left: e.x - hit,
              top: e.y - hit,
              width: e.w + 2 * hit,
              height: e.h + 2 * hit,
              cursor: "move",
              touchAction: "none",
              transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
              outline: isSel ? `${2 / scale}px solid` : "none",
              outlineColor: "primary.main",
              "&:hover": { outline: isSel ? undefined : `${1 / scale}px dashed`, outlineColor: "primary.main" },
            }}
          >
            {isSel &&
              HANDLES.filter((hd) => !line || hd === "e" || hd === "w" || e.h > 0).map((hd) => {
                const size = 12 / scale;
                const left = hd.includes("w") ? -size / 2 : hd.includes("e") ? e.w + 2 * hit - size / 2 : (e.w + 2 * hit) / 2 - size / 2;
                const top = hd.includes("n") ? -size / 2 : hd.includes("s") ? e.h + 2 * hit - size / 2 : (e.h + 2 * hit) / 2 - size / 2;
                return (
                  <Box
                    key={hd}
                    data-handle={hd}
                    onPointerDown={(ev) => begin(ev, e, scale, hd)}
                    onPointerMove={drag}
                    onPointerUp={end}
                    onPointerCancel={end}
                    sx={{ position: "absolute", left, top, width: size, height: size, bgcolor: "background.paper", border: `${1.5 / scale}px solid`, borderColor: "primary.main", borderRadius: "2px", cursor: `${hd}-resize`, touchAction: "none" }}
                  />
                );
              })}
          </Box>
        );
      })}
    </Box>
  );

  const textLike = sel && sel.kind !== "image" ? sel : undefined;
  const isLine = sel?.kind === "shape" && (sel.shape === "line" || sel.shape === "arrow");
  return (
    <Box ref={root} tabIndex={0} data-slide-editor aria-label={`${label}: designed slide editor`} sx={{ outline: "none", "&:focus-visible .slide-frame": { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` } }}>
      <Stack direction="row" alignItems="center" useFlexGap spacing={0.5} role="toolbar" aria-label="Slide" sx={{ flexWrap: "wrap", mb: 0.75 }}>
        <Button size="small" startIcon={<TextFieldsRounded />} onClick={() => add(newElement("text"), true)}>Text</Button>
        <Button size="small" startIcon={<CategoryOutlined />} onClick={(e) => setShapeMenu(e.currentTarget)} aria-haspopup="menu">Shape</Button>
        <Button size="small" startIcon={<AddPhotoAlternateOutlined />} component="label" disabled={busy}>
          {busy ? "Uploading…" : "Picture"}
          <input hidden type="file" accept="image/*" onChange={(e) => (void pickImage(e.target.files?.[0]), (e.target.value = ""))} />
        </Button>
        <ColorButton label="Slide background" icon={<WallpaperRounded />} value={design.background} onPick={(c) => onChange({ ...design, background: c ?? "#ffffff" })} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="More">
          <IconButton size="small" aria-label="More slide actions" onClick={(e) => setMore(e.currentTarget)}>
            <MoreHorizRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {/* Menus here don't hand focus back to their button: the slide takes it, so Delete and the
          arrow keys work on what was just added or picked. */}
      <Menu anchorEl={shapeMenu} open={!!shapeMenu} onClose={() => setShapeMenu(null)} disableRestoreFocus>
        {SHAPES.map((s) => (
          <MenuItem key={s.id} onClick={() => (add(newElement(s.id)), setShapeMenu(null))}>
            <ListItemIcon>{s.icon}</ListItemIcon>
            <ListItemText>{s.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={more} open={!!more} onClose={() => setMore(null)} disableRestoreFocus>
        <MenuItem onClick={() => (setMore(null), onConvertToText())}>
          <ListItemText primary="Convert to post text" secondary="Keep the words and pictures, drop the layout" />
        </MenuItem>
      </Menu>

      {/* Below the slide, so selecting something never moves the slide under the pointer. */}
      <Box className="slide-frame" sx={{ borderRadius: 1 }}>
        <SlideCanvas design={shown} images={images} label={label} overlay={overlay} editingId={editing} />
      </Box>
      {sel && (
        <Stack direction="row" alignItems="center" useFlexGap spacing={0.25} role="toolbar" aria-label="Selected element" sx={{ flexWrap: "wrap", mt: 0.75, px: 0.5, py: 0.25, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}>
          {editing && textEditor && (
            <>
              <EditorToolbar editor={textEditor} />
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            </>
          )}
          {textLike && !isLine && (
            <>
              <Tooltip title="Smaller text">
                <Button size="small" aria-label="Smaller text" onMouseDown={(e) => e.preventDefault()} onClick={() => update(textLike.id, { fontSize: Math.max(6, Math.round((textLike.fontSize ?? 18) - 2)) })} sx={{ minWidth: 32 }}>A−</Button>
              </Tooltip>
              <Typography variant="caption" sx={{ minWidth: 28, textAlign: "center" }} aria-label="Font size">{Math.round(textLike.fontSize ?? 18)}</Typography>
              <Tooltip title="Larger text">
                <Button size="small" aria-label="Larger text" onMouseDown={(e) => e.preventDefault()} onClick={() => update(textLike.id, { fontSize: Math.min(200, Math.round((textLike.fontSize ?? 18) + 2)) })} sx={{ minWidth: 32 }}>A+</Button>
              </Tooltip>
              <ColorButton label="Text color" icon={<TextFieldsRounded />} value={textLike.color} onPick={(c) => update(textLike.id, { color: c ?? "#000000" })} />
              {(["top", "middle", "bottom"] as const).map((v) => (
                <Tooltip key={v} title={`Align ${v}`}>
                  <IconButton size="small" aria-label={`Align ${v}`} aria-pressed={(textLike.valign ?? "top") === v} onMouseDown={(e) => e.preventDefault()} onClick={() => update(textLike.id, { valign: v })} sx={{ borderRadius: 1, color: (textLike.valign ?? "top") === v ? "primary.main" : "text.secondary", "& svg": { fontSize: 18 } }}>
                    {v === "top" ? <VerticalAlignTopRounded /> : v === "middle" ? <VerticalAlignCenterRounded /> : <VerticalAlignBottomRounded />}
                  </IconButton>
                </Tooltip>
              ))}
            </>
          )}
          {textLike && textLike.kind !== "chart" && !isLine && <ColorButton label="Fill" icon={<FormatColorFillRounded />} value={textLike.fill} allowNone onPick={(c) => update(textLike.id, { fill: c })} />}
          {textLike && textLike.kind !== "chart" && <ColorButton label={isLine ? "Line color" : "Outline"} icon={<BorderColorRounded />} value={textLike.line} allowNone={!isLine} onPick={(c) => update(textLike.id, { line: c })} />}
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Tooltip title="Bring to front">
            <IconButton size="small" aria-label="Bring to front" onClick={() => arrange(sel.id, "front")} sx={{ borderRadius: 1, "& svg": { fontSize: 18 } }}><FlipToFrontRounded /></IconButton>
          </Tooltip>
          <Tooltip title="Send to back">
            <IconButton size="small" aria-label="Send to back" onClick={() => arrange(sel.id, "back")} sx={{ borderRadius: 1, "& svg": { fontSize: 18 } }}><FlipToBackRounded /></IconButton>
          </Tooltip>
          <Tooltip title="Delete (Del)">
            <IconButton size="small" aria-label="Delete element" onClick={() => remove(sel.id)} sx={{ borderRadius: 1, "& svg": { fontSize: 18 } }}><DeleteOutlineRounded /></IconButton>
          </Tooltip>
        </Stack>
      )}

      {lost.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 0.75, px: 1, py: 0.5, borderRadius: 1, bgcolor: "action.hover" }} role="status">
          <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
            {lost.length === 1 ? "1 item is" : `${lost.length} items are`} outside the slide, so nobody can see {lost.length === 1 ? "it" : "them"}.
          </Typography>
          <Button size="small" onClick={() => setElements(design.elements.map((e) => (offSlide(e, W, H) ? ({ ...e, ...bringOn(e, W, H) } as El) : e)))}>
            Bring onto slide
          </Button>
        </Stack>
      )}
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
        {sel ? (sel.kind === "image" ? "Drag to move · corners keep the proportions · Delete removes" : "Double-click to edit text · drag to move · arrow keys nudge") : "Click anything on the slide to change it"}
      </Typography>
    </Box>
  );
}
