import type { Presentation, SlideTheme } from "../api/contract";

// Themes for automatic slides (Present and .pptx export). Designed slides keep their own design.

export type Theme = Required<Pick<SlideTheme, "name" | "background" | "heading" | "text" | "accent">> & Pick<SlideTheme, "headingFont" | "bodyFont">;

export const THEMES: Theme[] = [
  { name: "Classic", background: "#ffffff", heading: "#1b1f24", text: "#1b1f24", accent: "#3451d1" },
  { name: "Paper", background: "#fbf8f1", heading: "#2b2118", text: "#3b2f25", accent: "#b4532a", headingFont: "Georgia", bodyFont: "Georgia" },
  { name: "Lab", background: "#f4f7fb", heading: "#0b3d91", text: "#1f2937", accent: "#2563eb", headingFont: "IBM Plex Sans", bodyFont: "IBM Plex Sans" },
  { name: "Midnight", background: "#0f172a", heading: "#ffffff", text: "#cbd5e1", accent: "#2dd4bf" },
  { name: "Forest", background: "#0d2b23", heading: "#ecfdf5", text: "#c7e5d6", accent: "#4ade80" },
  { name: "Mono", background: "#ffffff", heading: "#000000", text: "#222222", accent: "#000000" },
];

/** A stored theme filled in from Classic (a deck's look may not name every color). */
export function resolveTheme(t?: SlideTheme): Theme {
  const base = THEMES[0];
  return { ...base, ...Object.fromEntries(Object.entries(t ?? {}).filter(([, v]) => v)), name: t?.name ?? base.name } as Theme;
}

/** Which theme a post presents with inside a notebook: the notebook's, else the post's own. */
export const themeFor = (notebook?: Presentation, post?: Presentation): Theme => resolveTheme(notebook?.theme ?? post?.theme);

/** Secondary text: the text color mixed toward the background. */
export const muted = (t: Theme) => `color-mix(in srgb, ${t.text} 68%, ${t.background})`;
