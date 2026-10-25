import {
  Code,
  DataObject,
  FormatBold,
  FormatItalic,
  FormatListBulleted,
  FormatListNumbered,
  FormatQuote,
  FormatStrikethrough,
  FormatUnderlined,
  LinkRounded,
  TableRowsOutlined,
  ViewColumnOutlined,
  DeleteSweepOutlined,
} from "@mui/icons-material";
import { Box, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { proseSx } from "../../../theme/prose";
import { AlignButton, ColorMenu } from "./FormatControls";
import { formattingExtensions, tableExtensions } from "./formatting";

// One TipTap editor per text/table block. Content is ProseMirror JSON in and out (§C1).

/**
 * Which text block shows its toolbar: the one most recently focused. A toolbar never collapses
 * just because focus left (a button, a slide, the page), since that would shift everything below it
 * mid-click. Focusing another block swaps toolbars: the old one closes as the new one opens.
 */
let activeBar: string | null = null;
const barListeners = new Set<() => void>();
const setActiveBar = (id: string | null) => {
  activeBar = id;
  barListeners.forEach((l) => l());
};
function useToolbarOwner(id: string, focused: boolean) {
  const active = useSyncExternalStore(
    (l) => (barListeners.add(l), () => barListeners.delete(l)),
    () => activeBar,
  );
  useEffect(() => {
    if (focused) setActiveBar(id);
  }, [focused, id]);
  useEffect(() => () => void (activeBar === id && setActiveBar(null)), [id]);
  return active === id;
}

function Btn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip title={title}>
      <IconButton
        size="small"
        aria-label={title}
        aria-pressed={active}
        onMouseDown={(e) => {
          e.preventDefault(); // keep the editor selection
          onClick();
        }}
        sx={{ borderRadius: 1, color: active ? "primary.main" : "text.secondary", bgcolor: active ? "action.selected" : "transparent", p: 0.5, "& svg": { fontSize: 18 } }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

export function EditorToolbar({ editor, table }: { editor: Editor; table?: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
    }),
  });
  const c = () => editor.chain().focus();
  const setLink = () => {
    if (s.link) return c().unsetLink().run();
    const href = window.prompt("Link URL (https://…)");
    if (href && /^(https?:|mailto:)/i.test(href.trim())) c().setLink({ href: href.trim() }).run();
  };
  return (
    <Stack direction="row" spacing={0.25} alignItems="center" role="toolbar" aria-label="Formatting" sx={{ flexWrap: "wrap", px: 0.5, py: 0.25 }}>
      <Btn title="Bold (⌘B)" active={s.bold} onClick={() => c().toggleBold().run()}><FormatBold /></Btn>
      <Btn title="Italic (⌘I)" active={s.italic} onClick={() => c().toggleItalic().run()}><FormatItalic /></Btn>
      <Btn title="Underline (⌘U)" active={s.underline} onClick={() => c().toggleUnderline().run()}><FormatUnderlined /></Btn>
      <Btn title="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}><FormatStrikethrough /></Btn>
      <Btn title="Inline code" active={s.code} onClick={() => c().toggleCode().run()}><Code /></Btn>
      <Btn title="Link" active={s.link} onClick={setLink}><LinkRounded /></Btn>
      <ColorMenu editor={editor} />
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
      <Btn title="Heading" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}><Typography sx={{ fontWeight: 700, fontSize: 13, px: 0.25 }}>H2</Typography></Btn>
      <Btn title="Subheading" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}><Typography sx={{ fontWeight: 700, fontSize: 12, px: 0.25 }}>H3</Typography></Btn>
      <Btn title="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}><FormatListBulleted /></Btn>
      <Btn title="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}><FormatListNumbered /></Btn>
      <AlignButton editor={editor} />
      <Btn title="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}><FormatQuote /></Btn>
      <Btn title="Code block" active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()}><DataObject /></Btn>
      {table && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Btn title="Add row" onClick={() => c().addRowAfter().run()}><TableRowsOutlined /></Btn>
          <Btn title="Add column" onClick={() => c().addColumnAfter().run()}><ViewColumnOutlined /></Btn>
          <Btn title="Delete row" onClick={() => c().deleteRow().run()}><DeleteSweepOutlined /></Btn>
        </>
      )}
    </Stack>
  );
}

interface Props {
  doc: unknown;
  onChange: (doc: unknown) => void;
  onPasteImages?: (files: File[]) => void;
  onBlur?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  table?: boolean;
  readOnly?: boolean;
  label: string;
}

export function TextBlockEditor({ doc, onChange, onPasteImages, onBlur, placeholder, autoFocus, table, readOnly, label }: Props) {
  const onChangeRef = useRef(onChange);
  const onPasteRef = useRef(onPasteImages);
  const onBlurRef = useRef(onBlur);
  useEffect(() => {
    onChangeRef.current = onChange;
    onPasteRef.current = onPasteImages;
    onBlurRef.current = onBlur;
  });
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }),
      ...formattingExtensions,
      Placeholder.configure({ placeholder: placeholder ?? "Write…" }),
      ...(table ? tableExtensions : []),
    ],
    content: (doc as object) ?? undefined,
    editable: !readOnly,
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: true,
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getJSON()),
    onBlur: () => onBlurRef.current?.(),
    editorProps: {
      attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length || !onPasteRef.current) return false;
        onPasteRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length || !onPasteRef.current) return false;
        event.preventDefault();
        onPasteRef.current(files);
        return true;
      },
    },
  });
  const focused = useEditorState({ editor, selector: ({ editor: e }) => e?.isFocused ?? false });
  const barId = useId();
  const showBar = useToolbarOwner(barId, focused);

  return (
    <Box sx={{ position: "relative" }}>
      {!readOnly && editor && (
        <Box sx={{ position: "sticky", top: 52, zIndex: 2, bgcolor: "background.paper", borderBottom: 1, borderColor: "divider", mb: 1, opacity: showBar ? 1 : 0, height: showBar ? "auto" : 0, overflow: "hidden", transition: "opacity 120ms" }}>
          <EditorToolbar editor={editor} table={table} />
        </Box>
      )}
      <Box
        sx={[
          proseSx,
          {
            "& .ProseMirror": { outline: "none", minHeight: table ? 0 : 48 },
            "& .ProseMirror p.is-editor-empty:first-of-type::before": { content: "attr(data-placeholder)", color: "text.disabled", float: "left", height: 0, pointerEvents: "none" },
            "& .selectedCell": { bgcolor: "action.selected" },
          },
        ]}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}
