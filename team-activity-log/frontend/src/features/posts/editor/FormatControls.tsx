import { FormatAlignCenter, FormatAlignJustify, FormatAlignLeft, FormatAlignRight, FormatColorTextRounded, FormatColorResetRounded } from "@mui/icons-material";
import { Box, ButtonBase, IconButton, Popover, Stack, Tooltip, Typography } from "@mui/material";
import { useEditorState, type Editor } from "@tiptap/react";
import { useState } from "react";
import { HIGHLIGHTS, TEXT_COLORS } from "./formatting";

function Swatch({ name, value, selected, onPick, kind }: { name: string; value: string; selected: boolean; onPick: () => void; kind: "text" | "highlight" }) {
  return (
    <Tooltip title={name}>
      <ButtonBase
        aria-label={`${kind === "text" ? "Text" : "Highlight"} ${name.toLowerCase()}`}
        aria-pressed={selected}
        onMouseDown={(e) => e.preventDefault()} // keep the editor selection
        onClick={onPick}
        sx={{ width: 32, height: 32, borderRadius: 1, border: 2, borderColor: selected ? "primary.main" : "divider", bgcolor: kind === "highlight" ? value : "background.paper", color: value, fontWeight: 700, fontSize: 15 }}
      >
        {kind === "text" ? "A" : ""}
      </ButtonBase>
    </Tooltip>
  );
}

/** One toolbar button: the "A" shows the current color; the popover sets text color and highlight. */
export function ColorMenu({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const s = useEditorState({ editor, selector: ({ editor: e }) => ({ color: (e.getAttributes("textStyle").color as string | undefined) ?? null, highlight: (e.getAttributes("highlight").color as string | undefined) ?? null }) });
  const c = () => editor.chain().focus();
  return (
    <>
      <Tooltip title="Text color and highlight">
        <IconButton
          size="small"
          aria-label="Text color and highlight"
          aria-haspopup="dialog"
          onMouseDown={(e) => {
            e.preventDefault();
            setAnchor(e.currentTarget);
          }}
          sx={{ borderRadius: 1, p: 0.5, color: "text.secondary", "& svg": { fontSize: 18 } }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <FormatColorTextRounded sx={{ mb: "-3px" }} />
            <Box sx={{ width: 14, height: 3, borderRadius: 1, bgcolor: s.color ?? s.highlight ?? "text.disabled" }} />
          </Box>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        disableRestoreFocus
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Typography variant="caption" color="text.secondary">Text color</Typography>
        <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", mt: 0.5, mb: 1.5 }}>
          <Tooltip title="Default">
            <IconButton size="small" aria-label="Default text color" onMouseDown={(e) => e.preventDefault()} onClick={() => c().unsetColor().run()} sx={{ width: 32, height: 32, borderRadius: 1, border: 2, borderColor: s.color ? "divider" : "primary.main" }}>
              <FormatColorResetRounded fontSize="small" />
            </IconButton>
          </Tooltip>
          {TEXT_COLORS.map((x) => (
            <Swatch key={x.value} kind="text" {...x} selected={s.color === x.value} onPick={() => c().setColor(x.value).run()} />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">Highlight</Typography>
        <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", mt: 0.5 }}>
          <Tooltip title="None">
            <IconButton size="small" aria-label="No highlight" onMouseDown={(e) => e.preventDefault()} onClick={() => c().unsetHighlight().run()} sx={{ width: 32, height: 32, borderRadius: 1, border: 2, borderColor: s.highlight ? "divider" : "primary.main" }}>
              <FormatColorResetRounded fontSize="small" />
            </IconButton>
          </Tooltip>
          {HIGHLIGHTS.map((x) => (
            <Swatch key={x.value} kind="highlight" {...x} selected={s.highlight === x.value} onPick={() => c().setHighlight({ color: x.value }).run()} />
          ))}
        </Stack>
      </Popover>
    </>
  );
}

const ALIGNS = [
  { value: "left", label: "Align left", icon: <FormatAlignLeft /> },
  { value: "center", label: "Align center", icon: <FormatAlignCenter /> },
  { value: "right", label: "Align right", icon: <FormatAlignRight /> },
  { value: "justify", label: "Justify", icon: <FormatAlignJustify /> },
];

/** One button that cycles left → center → right → justify; its icon shows the current alignment. */
export function AlignButton({ editor }: { editor: Editor }) {
  const current = useEditorState({ editor, selector: ({ editor: e }) => ALIGNS.findIndex((a) => e.isActive({ textAlign: a.value })) });
  const now = ALIGNS[Math.max(0, current)];
  const next = ALIGNS[(Math.max(0, current) + 1) % ALIGNS.length];
  return (
    <Tooltip title={`${now.label} (click: ${next.label.toLowerCase()})`}>
      <IconButton
        size="small"
        aria-label={`Alignment: ${now.label.toLowerCase()}`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (next.value === "left") editor.chain().focus().unsetTextAlign().run();
          else editor.chain().focus().setTextAlign(next.value).run();
        }}
        sx={{ borderRadius: 1, p: 0.5, color: current > 0 ? "primary.main" : "text.secondary", "& svg": { fontSize: 18 } }}
      >
        {now.icon}
      </IconButton>
    </Tooltip>
  );
}
