import { AttachFileRounded, Code, FormatBold, FormatItalic, FormatListBulleted, HelpOutlineRounded, LinkRounded } from "@mui/icons-material";
import { Box, Button, Checkbox, FormControlLabel, IconButton, LinearProgress, Stack, Tooltip, Typography } from "@mui/material";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ID, ImageView, User } from "../../api/contract";
import { createImageInstance, uploadImage } from "../../api/hooks";
import { Kbd } from "../../components/ui";
import { errorMessage } from "../../lib/format";
import { isDocEmpty } from "../../lib/prosemirror";
import { proseSx } from "../../theme/prose";

// Light rich text for comments (§W3.1): bold, italic, code, links, lists, @mentions, images.
// Mentions are ProseMirror `mention` nodes ({ id, label }), so the server can notify by ID.

function mentionSuggestion(getPeople: () => User[]) {
  return {
    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      return getPeople()
        .filter((u) => !q || u.name.toLowerCase().split(/\s+/).some((p) => p.startsWith(q)) || u.name.toLowerCase().startsWith(q))
        .slice(0, 6);
    },
    render: () => {
      // A tiny DOM popup (no portal library): positioned at the caret, keyboard-driven.
      let el: HTMLDivElement | null = null;
      let items: User[] = [];
      let index = 0;
      let select: ((u: User) => void) | null = null;
      const draw = () => {
        if (!el) return;
        el.replaceChildren(
          ...(items.length
            ? items.map((u, i) => {
                const row = document.createElement("div");
                row.textContent = u.name; // textContent: names are untrusted data
                row.setAttribute("role", "option");
                row.setAttribute("aria-selected", String(i === index));
                row.className = i === index ? "on" : "";
                row.onmousedown = (e) => {
                  e.preventDefault();
                  select?.(u);
                };
                return row;
              })
            : [Object.assign(document.createElement("div"), { textContent: "No one matches", className: "none" })]),
        );
      };
      const place = (rect?: (() => DOMRect | null) | null) => {
        const r = rect?.();
        if (el && r) Object.assign(el.style, { left: `${r.left + window.scrollX}px`, top: `${r.bottom + window.scrollY + 4}px` });
      };
      return {
        onStart: (p: { items: User[]; command: (a: { id: string; label: string }) => void; clientRect?: (() => DOMRect | null) | null }) => {
          el = document.createElement("div");
          el.className = "tal-mentions";
          el.setAttribute("role", "listbox");
          document.body.appendChild(el);
          items = p.items;
          index = 0;
          select = (u) => p.command({ id: u.id, label: u.name });
          draw();
          place(p.clientRect);
        },
        onUpdate: (p: { items: User[]; command: (a: { id: string; label: string }) => void; clientRect?: (() => DOMRect | null) | null }) => {
          items = p.items;
          index = Math.min(index, Math.max(0, items.length - 1));
          select = (u) => p.command({ id: u.id, label: u.name });
          draw();
          place(p.clientRect);
        },
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
          if (event.key === "ArrowDown") index = (index + 1) % Math.max(1, items.length);
          else if (event.key === "ArrowUp") index = (index - 1 + items.length) % Math.max(1, items.length);
          else if (event.key === "Enter" || event.key === "Tab") {
            if (items[index]) select?.(items[index]);
            return true;
          } else return false;
          draw();
          return true;
        },
        onExit: () => {
          el?.remove();
          el = null;
        },
      };
    },
  };
}

function Btn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip title={title}>
      <IconButton size="small" aria-label={title} aria-pressed={active} onMouseDown={(e) => (e.preventDefault(), onClick())} sx={{ color: active ? "primary.main" : "text.secondary", p: 0.4, "& svg": { fontSize: 17 } }}>
        {children}
      </IconButton>
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({ editor, selector: ({ editor: e }) => ({ b: e.isActive("bold"), i: e.isActive("italic"), c: e.isActive("code"), l: e.isActive("bulletList"), a: e.isActive("link") }) });
  const c = () => editor.chain().focus();
  return (
    <>
      <Btn title="Bold" active={s.b} onClick={() => c().toggleBold().run()}><FormatBold /></Btn>
      <Btn title="Italic" active={s.i} onClick={() => c().toggleItalic().run()}><FormatItalic /></Btn>
      <Btn title="Code" active={s.c} onClick={() => c().toggleCode().run()}><Code /></Btn>
      <Btn title="List" active={s.l} onClick={() => c().toggleBulletList().run()}><FormatListBulleted /></Btn>
      <Btn
        title="Link"
        active={s.a}
        onClick={() => {
          if (s.a) return c().unsetLink().run();
          const href = window.prompt("Link URL (https://…)");
          if (href && /^(https?:|mailto:)/i.test(href.trim())) c().setLink({ href: href.trim() }).run();
        }}
      >
        <LinkRounded />
      </Btn>
    </>
  );
}

export interface CommentDraft {
  doc: unknown;
  imageInstanceIds: ID[];
  isQuestion: boolean;
}

interface Props {
  orgId: ID;
  postId: ID;
  people: User[];
  placeholder?: string;
  initialDoc?: unknown;
  submitLabel?: string;
  autoFocus?: boolean;
  allowQuestion?: boolean;
  compact?: boolean;
  onSubmit: (d: CommentDraft) => void;
  onCancel?: () => void;
}

export function CommentEditor({ orgId, postId, people, placeholder, initialDoc, submitLabel = "Comment", autoFocus, allowQuestion, compact, onSubmit, onCancel }: Props) {
  const peopleRef = useRef(people);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);
  const [images, setImages] = useState<ImageView[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isQuestion, setIsQuestion] = useState(false);
  const [focused, setFocused] = useState(!!autoFocus);
  const submitRef = useRef<() => void>(() => {});

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }),
      Placeholder.configure({ placeholder: placeholder ?? "Add a comment… (@ to mention)" }),
      Mention.configure({ HTMLAttributes: { class: "mention" }, renderText: ({ node }) => `@${node.attrs.label}`, suggestion: mentionSuggestion(() => peopleRef.current) }),
    ],
    [placeholder],
  );

  const attach = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setUploading((n) => n + imgs.length);
    for (const f of imgs) {
      try {
        const asset = await uploadImage(orgId, f, undefined, "paste");
        const img = await createImageInstance(orgId, { assetId: asset.id, postId });
        setImages((x) => [...x, img]);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const editor = useEditor({
    extensions,
    content: (initialDoc as object) ?? undefined,
    autofocus: autoFocus ? "end" : false,
    onFocus: () => setFocused(true),
    editorProps: {
      attributes: { "aria-label": placeholder ?? "Add a comment", role: "textbox", "aria-multiline": "true" },
      handleKeyDown: (_v, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          submitRef.current();
          return true;
        }
        if (e.key === "Escape" && onCancel) {
          onCancel();
          return true;
        }
        return false;
      },
      handlePaste: (_v, e) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (!files.some((f) => f.type.startsWith("image/"))) return false;
        void attach(files);
        return true;
      },
    },
  });
  const empty = useEditorState({ editor, selector: ({ editor: e }) => (e ? isDocEmpty(e.getJSON()) : true) });

  const submit = () => {
    if (!editor || uploading || (empty && !images.length)) return;
    onSubmit({ doc: editor.getJSON(), imageInstanceIds: images.map((i) => i.id), isQuestion });
    editor.commands.clearContent();
    setImages([]);
    setIsQuestion(false);
    if (compact) setFocused(false);
  };
  submitRef.current = submit;

  const open = focused || !empty || images.length > 0 || !compact;
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        "&:focus-within": { borderColor: "primary.main" },
        "& .tal-mentions": {},
      }}
    >
      <Box sx={[proseSx, { px: 1.25, py: 0.75, fontSize: "0.9rem", "& .ProseMirror": { outline: "none", minHeight: open ? 44 : 22 }, "& .ProseMirror p.is-editor-empty:first-of-type::before": { content: "attr(data-placeholder)", color: "text.disabled", float: "left", height: 0, pointerEvents: "none" } }]}>
        <EditorContent editor={editor} />
      </Box>
      {images.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ px: 1.25, pb: 1 }}>
          {images.map((img) => (
            <Box key={img.id} sx={{ position: "relative" }}>
              <Box component="img" src={img.asset.variants[0]?.url} alt="" sx={{ width: 72, height: 54, objectFit: "cover", borderRadius: 0.5, border: 1, borderColor: "divider" }} />
              <IconButton size="small" aria-label="Remove image" onClick={() => setImages(images.filter((x) => x.id !== img.id))} sx={{ position: "absolute", top: -8, right: -8, bgcolor: "background.paper", border: 1, borderColor: "divider", p: 0.1, fontSize: 12 }}>×</IconButton>
            </Box>
          ))}
        </Stack>
      )}
      {uploading > 0 && <LinearProgress sx={{ height: 2 }} />}
      {open && editor && (
        <Stack direction="row" alignItems="center" spacing={0.25} sx={{ px: 0.75, py: 0.5, borderTop: 1, borderColor: "divider" }}>
          <Toolbar editor={editor} />
          <Tooltip title="Attach images">
            <IconButton size="small" component="label" aria-label="Attach images" sx={{ color: "text.secondary", p: 0.4, "& svg": { fontSize: 17 } }}>
              <AttachFileRounded />
              <input hidden type="file" accept="image/*" multiple onChange={(e) => (void attach(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
            </IconButton>
          </Tooltip>
          {allowQuestion && (
            <FormControlLabel
              sx={{ ml: 0.5, "& .MuiFormControlLabel-label": { fontSize: "0.78rem", color: "text.secondary" } }}
              control={<Checkbox size="small" checked={isQuestion} onChange={(e) => setIsQuestion(e.target.checked)} icon={<HelpOutlineRounded fontSize="small" />} checkedIcon={<HelpOutlineRounded fontSize="small" color="primary" />} />}
              label="Ask as a question"
            />
          )}
          <Box sx={{ flex: 1 }} />
          {error && <Typography variant="caption" color="error" sx={{ mr: 1 }}>{error}</Typography>}
          {onCancel && <Button size="small" onClick={onCancel}>Cancel</Button>}
          <Button size="small" variant="contained" disabled={(empty && !images.length) || uploading > 0} onClick={submit} endIcon={<Kbd>⌘↵</Kbd>}>
            {submitLabel}
          </Button>
        </Stack>
      )}
    </Box>
  );
}
