# Audit of v0 (before the UI rebuild)

Spec: [`log-scoping/log_activity_plan.md`](../log-scoping/log_activity_plan.md) (v0.3).
Audited on 2026-10-23 at commit `8f83479`.

## What exists

| Area | v0 state | Maps to spec |
|---|---|---|
| Stack | React **19**, MUI **7**, TipTap **3**, TanStack Query 5, React Router **7**, Vite 7, TS 5.8 (spec says React 18 / MUI 5; the installed versions are newer and kept) | §0 |
| Layout | `pages/TeamActivityLog.tsx`: one 570-line page, three columns, mobile drawers | §A4 AppShell (rewrite) |
| Data | `api/client.ts` `apiFetch` against FastAPI `/api/posts|users|tags`; posts copied into local `useState` after first load, all mutations are local-only | §A3 seam (rewrite) |
| Types | `interfaces/TeamActivityLogInterfaces.tsx`: numeric IDs, `tags: string[]` by label, blocks as HTML strings / data-URL images, comments nested inline in posts | §A7 contract (replace) |
| Composer | `PostComposer.tsx`: TipTap with images *inside* the ProseMirror doc as base64, tag menu, publish button | §W2.2 (rewrite around drafts + `blocks[]`) |
| Annotator | `ImageAnnotator.tsx`: 8 tools, palette, size/opacity, undo, keyboard shortcuts; **raster** — flattens to a PNG data URL | §W2.4 (keep UX, rewrite storage as vector shapes) |
| Comments | `CommentNode.tsx` recursive tree, `ReplyBox.tsx` | §W3.2 (rewrite on the new contract) |
| Feed | `PostCard.tsx`, `PreviewCard.tsx`, `FullPostPanel.tsx`: block rendering, reactions, collapse | §W2.9 / §W4.11 (rewrite; virtualized) |
| Theme | `utilities/theme.tsx`: dark-only MUI theme, IBM Plex | §A4 tokens (extend: light/dark, density) |
| Backend | FastAPI stub, read-only `GET /api/posts|users|tags` from in-memory lists | Part B (not touched in UI milestones) |
| Tooling | ESLint only. No tests, no Storybook, no CI | §0 UI-0 |

## Keep

- Annotator interaction model (tool set, `P L R E A T H X` shortcuts, palette, size/opacity sliders, hint bar).
- TipTap as the rich-text engine (ProseMirror JSON is the contract's `doc` type) and the toolbar's button set.
- IBM Plex typography, MUI as the component library.
- The ordered `blocks[]` idea (now typed per §A7).

## Rewrite

- Everything that touches data: the page-level `useState` copies of server data become TanStack Query hooks over a typed client (§A3).
- Types: replaced by `src/api/contract.ts` (string UUIDv7 IDs, `tagIds`, `Block` union, `FilterSpec`).
- Annotator storage: vector `Shape[]` on the image instance (non-destructive, re-editable, searchable text).
- Images: real assets (blob + dimensions + metadata) instead of base64 embedded in HTML.
- Layout: AppShell with left rail, routed screens (§A3 route map) instead of one page with panels.

## Risks

1. **Scope.** Six milestones of UI; each is built to "demoable", with polish depth noted in `DECISIONS.md` where it was traded off.
2. **Version drift from the spec** (React 19 / MUI 7 / Router 7 instead of 18 / 5 / 6). No functional impact; noted so nobody "downgrades to match".
3. **5,000-post mock performance.** The mock search engine runs on the main thread. Mitigated by an in-memory store (Dexie is write-through persistence only) and a prebuilt MiniSearch index.
4. **MSW + images.** Uploaded blobs are served as object URLs regenerated on each load (per §A3).
5. **Backend drift.** `backend/` still serves the v0 `/api/*` shapes; the UI now targets `/v1` (§B11). Live mode won't work until Part B starts. This is expected.
