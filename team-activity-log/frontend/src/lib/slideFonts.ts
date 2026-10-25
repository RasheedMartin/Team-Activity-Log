import type { SlideDesign } from "../api/contract";

// Fonts for designed slides. A deck names fonts most viewers don't have (Calibri, Cambria, Arial
// on a phone…). For those we load free fonts with the same metrics from Google Fonts, so text
// wraps where it did in PowerPoint; fonts that are on Google Fonts load as themselves. The app's
// CSP already allows fonts.googleapis.com / fonts.gstatic.com.

const NAME = /^[\w .-]{1,64}$/;

/** Metric-compatible stand-ins for Microsoft fonts. */
const SUBSTITUTE: Record<string, string> = {
  calibri: "Carlito",
  "calibri light": "Carlito",
  cambria: "Caladea",
  arial: "Arimo",
  helvetica: "Arimo",
  "times new roman": "Tinos",
  "courier new": "Cousine",
  georgia: "Gelasio",
  "century gothic": "Didact Gothic",
  "segoe ui": "Open Sans",
  abadi: "Mulish",
  "abadi extra light": "Mulish",
};

/** Families served by Google Fonts under the same name (a short list of the common ones). */
const GOOGLE = new Set(
  [
    "Lato", "Roboto", "Open Sans", "Montserrat", "Inter", "Poppins", "Raleway", "Nunito", "Oswald", "Merriweather", "Playfair Display",
    "Source Sans 3", "Source Serif 4", "PT Sans", "PT Serif", "Work Sans", "Fira Sans", "Ubuntu", "Noto Sans", "Noto Serif", "Rubik",
    "IBM Plex Sans", "IBM Plex Serif", "IBM Plex Mono", "Roboto Mono", "Roboto Slab", "Lora", "Mulish", "Karla", "DM Sans", "Barlow",
    "Carlito", "Caladea", "Arimo", "Tinos", "Cousine", "Gelasio", "Didact Gothic",
  ].map((f) => f.toLowerCase()),
); // prettier-ignore

const SERIF = /serif|times|georgia|cambria|garamond|book|palatino|merriweather|playfair|lora|slab|caladea|tinos|gelasio/i;
const MONO = /mono|courier|consolas|code|menlo|cousine/i;

/** The family to load from Google Fonts for a deck font, if any. */
export function webFontFor(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  const plain = key.replace(/\s+(semibold|bold|light|medium|text|extralight|black)$/, "");
  const sub = SUBSTITUTE[key] ?? SUBSTITUTE[plain];
  if (sub) return sub;
  if (GOOGLE.has(key)) return name.trim();
  if (GOOGLE.has(plain)) return name.trim().slice(0, plain.length);
  return undefined;
}

/** CSS font-family for a deck font: the font itself, its web stand-in, then a fallback of the same kind. */
export function fontStack(name?: string): string {
  if (!name || !NAME.test(name)) return `"Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif`;
  const web = webFontFor(name);
  const generic = MONO.test(name) ? "ui-monospace, Menlo, Consolas, monospace" : SERIF.test(name) ? "Georgia, 'Times New Roman', serif" : "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  return [`"${name}"`, ...(web && web !== name ? [`"${web}"`] : []), generic].join(", ");
}

/** Every font a design uses: theme fonts and per-run typefaces. */
export function designFonts(design: SlideDesign): string[] {
  const out = new Set<string>(Object.values(design.fonts ?? {}).filter(Boolean) as string[]);
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { marks?: { type: string; attrs?: { fontFamily?: unknown } }[]; content?: unknown[] };
    for (const m of node.marks ?? []) if (m.type === "textStyle" && typeof m.attrs?.fontFamily === "string") out.add(m.attrs.fontFamily);
    node.content?.forEach(walk);
  };
  for (const e of design.elements) if (e.kind !== "image") walk(e.doc);
  return [...out];
}

const loaded = new Set<string>();

/** Load the web stand-ins for these fonts (once per family per page). */
export function ensureWebFonts(names: string[]) {
  if (typeof document === "undefined") return;
  const families = [...new Set(names.map(webFontFor).filter((f): f is string => !!f))].filter((f) => !loaded.has(f));
  if (!families.length) return;
  const add = (family: string, axes: string, retry?: () => void) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}${axes}&display=swap`;
    if (retry) link.onerror = retry;
    document.head.appendChild(link);
  };
  for (const f of families) {
    loaded.add(f);
    // One request per family: a family without bold or italics is retried as plain regular.
    add(f, ":ital,wght@0,400;0,700;1,400;1,700", () => add(f, ""));
  }
}
