import { PaletteOutlined } from "@mui/icons-material";
import { Box, ButtonBase, IconButton, Popover, Stack, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import type { SlideTheme } from "../../api/contract";
import { fontStack } from "../../components/slideStyles";
import { muted, resolveTheme, THEMES, type Theme } from "../../lib/themes";

/** A small slide drawn in the theme, so choosing is seeing. */
function Swatch({ theme, selected, onPick }: { theme: Theme; selected: boolean; onPick: () => void }) {
  return (
    <ButtonBase
      onClick={onPick}
      aria-label={`Theme ${theme.name}`}
      aria-pressed={selected}
      sx={{ display: "block", textAlign: "left", borderRadius: 1, outline: selected ? "2px solid" : "1px solid", outlineColor: selected ? "primary.main" : "divider", outlineOffset: 2 }}
    >
      <Box sx={{ width: 132, aspectRatio: "16 / 9", bgcolor: theme.background, borderRadius: 1, p: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.5, overflow: "hidden" }}>
        <Box sx={{ width: 20, height: 3, bgcolor: theme.accent, borderRadius: 1 }} />
        <Typography sx={{ color: theme.heading, fontFamily: fontStack(theme.headingFont ?? theme.bodyFont), fontWeight: 700, fontSize: 13, lineHeight: 1.1 }}>Aa Heading</Typography>
        <Typography sx={{ color: muted(theme), fontFamily: fontStack(theme.bodyFont), fontSize: 9 }}>Body text</Typography>
      </Box>
      <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.primary" }}>{theme.name}</Typography>
    </ButtonBase>
  );
}

interface Props {
  current: Theme;
  /** An imported deck's own look, offered first so it can be chosen again. */
  deck?: SlideTheme;
  /** Where the choice is saved, said in plain words (or that it's just for now). */
  scope: string;
  onPick: (theme: Theme) => void;
}

export function ThemePicker({ current, deck, scope, onPick }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const options = [...(deck ? [resolveTheme({ ...deck, name: deck.name ?? "From the deck" })] : []), ...THEMES];
  return (
    <>
      <Tooltip title="Theme">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ color: "inherit" }} aria-label="Slide theme" aria-haspopup="dialog">
          <PaletteOutlined />
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "top", horizontal: "center" }} transformOrigin={{ vertical: "bottom", horizontal: "center" }} slotProps={{ paper: { sx: { p: 2, maxWidth: "calc(100vw - 32px)" } } }}>
        <Typography variant="subtitle2">Theme</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          For text slides. Designed slides keep their own look. {scope}
        </Typography>
        <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", maxWidth: 3 * 150 }} role="group" aria-label="Themes">
          {options.map((t) => (
            <Swatch key={t.name} theme={t} selected={t.name === current.name} onPick={() => (onPick(t), setAnchor(null))} />
          ))}
        </Stack>
      </Popover>
    </>
  );
}
