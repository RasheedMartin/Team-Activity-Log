# Decisions log

Assumptions and defaults taken while building the UI (spec rule 7). One line each, newest at the bottom of each section. Open questions refer to spec §C2.

## Open questions taken at their default

| # | Decision | Rationale |
|---|---|---|
| C2.3 | Admins **cannot** see others' drafts | Spec default; drafts are private working space |
| C2.4 | Viewers **may** react | Spec default; reacting is low-risk feedback |
| C2.5 | Imported `.pptx` originals are **not retained** (7-day temp TTL); retention is an org setting, off | Spec default; saves storage |
| C2.6 | Speaker notes import as **per-slide notes** on `slide_break` blocks | Spec default; keeps notes out of the main view |
| C2.7 | No public expiring presentation links for now | Spec default |
| C2.12 | KaTeX math deferred (v2 stretch, not built yet) | Keeps the composer small for v2; easy to add as a TipTap extension |
| C2.13 | "Present off the platform" = full-screen carousel without app chrome; export UI is a stub until backend B-5 | Spec reading; real PDF/PPTX export needs the backend |

## Contract (`src/api/contract.ts`) additions beyond §A7

Additions only; nothing in §A7 was removed or renamed.

- `Post.reactions` and `Post.collectionIds`: the detail view and the `collection` filter need them, and they map directly to `reactions` and `collection_posts` (§B9).
- `Membership.workspaceIds`: the members admin edits workspace access in one place (`workspace_members`).
- `FilterSpec.histogram.bounds`: the zoomed histogram window ("Zoom to selection"). It never filters results, so the ES query maps it to `extended_bounds` / a `hard_bounds` on the histogram only.
- `SearchHit.images`: thumbnails for result cards so the feed doesn't need N extra requests; ES returns them from the nested `images` field.
- `MeResponse`, `PostDetail`, `DraftSummary`, `ImportJob`/`ImportItem`, `Notification`, `LiveEvent`, `SavedView`, `Collection`, `Invite`, `InviteLink`, `Session`: concrete shapes for routes listed in §B11.
- `Shape` (annotation vectors): points are **normalized 0..1** to the image and stroke size is a fraction of image width, so annotations survive any display size or a replaced image with the same aspect ratio.

## UI-0 foundation

- **Stack versions are newer than the spec** (React 19, MUI 7, Router 7, Vite 7). Kept as-is; no functional difference.
- **Storybook 9.1** instead of 8: Storybook 8 doesn't support Vite 7.
- **Mock store = in-memory tables + write-through to IndexedDB (Dexie).** Searching 5,000 posts must be < 150 ms; reading IndexedDB per request wouldn't be.
- **Auth in mock mode uses a cookie set by MSW's `Set-Cookie`.** Client code sends `credentials: "include"` and never reads the cookie, matching the httpOnly-cookie session planned in §B8.
- **Uploads follow presign → PUT → complete** (§B7) even in the mock; the PUT uses XHR so the composer shows real progress.
- **Live updates use real SSE** (`EventSource`) answered by MSW's `sse()` handler, with timers playing the other personas.
- **Histogram time zone:** the mock buckets in UTC calendar days. `workDate` is a plain date, so it's unaffected; timestamp fields will use the user's timezone server-side (§B4.5).
- **Vite `base` changed from `./` to `/`**: deep routes (`/o/x/w/y/p/z`) can't load relative asset paths. FastAPI still mounts the build at `/`.
- **The mock ships in production builds** (`VITE_API_MODE` defaults to `mock`), so the Vercel deploy is a working demo until the backend exists. Set `VITE_API_MODE=live` and `VITE_API_URL` to switch.
- **Command palette and global shortcuts** communicate through window events (`tal:*`) instead of a context, to avoid re-rendering the shell.

## UI-3 Find It

- **Boolean search language (owner request)** in `FilterSpec.q`: `AND`/`OR`/`NOT`/`-`, parentheses, `"phrases"`, `prefix*`, field scopes `title: body: comment: image: tag:`. Operators are UPPERCASE (like Elasticsearch `query_string`), so "salt and pepper" stays words. Parser: `src/lib/query.ts`, never throws; malformed input shows a quiet hint and still searches. Backend maps the AST to an ES `bool` query (must / should / must_not, `match_phrase`, `prefix`, per-field `multi_match`).
- **Excluded words are never prefix-expanded** (`-pump` doesn't exclude "pumpkin"); the last *positive* word is (prefix-as-you-type).
- **`FilterSpec.where`**: nested `{ op: and|or|not, items }` groups from the Advanced filters drawer, ANDed with `all/any/none`. Counts as "other filters" for disjunctive facets (it never excludes its own facet).
- `tag:name` / `by:name` typed in the search bar become chips when they match a known tag/person; unknown `tag:x` stays text and searches tag names.
- **Histogram colors** validated with the dataviz skill's contrast check: bars 6.47:1 (light) / 7.20:1 (dark); outside-selection bars 3.18:1 / 3.15:1 (≥ 3:1 non-text). One series, so no legend; table view is the accessible twin.
- **Zoom** uses `FilterSpec.histogram.bounds` (view window only, never filters results).
- **Zero-results suggestions** run one count query per active filter (an ES `msearch` in production).
- **Mock engine performance:** derived docs build eagerly (55 ms for 5,000 posts); the full-text index builds in idle time after first render (≈330 ms) so the feed isn't delayed. Production build on the busy scenario: reload → results 911 ms; searches 3–41 ms; scroll 60 fps.
- **Peek pane**: inline on ≥ 1536 px screens, a non-modal drawer below that; j/k/Enter keep working while it's open.
- Bundle: only MUI is vendor-split; the editor and the mock server are lazy chunks (the mock never loads in live mode).

## Explore (owner request, between UI-3 and UI-4)

- New route `GET /workspaces/{ws}/explore` → `ExploreResponse` (shelves per tag with recent posts and images). Backend: ES `terms` agg on `tags.id` + `top_hits`, same security filters as search; tag group names hydrated from Postgres.
- Shelves are ordered by most recent activity and can be narrowed by tag group. "Slideshow" is a reusable `ImageSlideshow` over any `FilterSpec` (gallery query, oldest first); UI-5 reuses it for presenting selections.
- Notebooks (stitching posts into one document) are planned with UI-5 collections/present/export.

## UI-4 Talk About It

- Comments are read from the comments API (Postgres-owned), never from search; search only indexes their text.
- Threads render unlimited depth in data; past depth 4 the UI shows "Continue thread →" (focused sub-thread with a way back). Top-level threads page 30 at a time (the 200-comment fixture stays fast).
- Mentions are ProseMirror `mention` nodes `{ id, label }`; the server notifies by ID. The suggestion popup renders names with `textContent` (untrusted data).
- Anyone who can comment may resolve a question; only the question's author or an admin may pick the accepted answer.
- Pinned image comments store normalized `anchor {x, y}`; pins are numbered per image in creation order. Clicking a pin previews it and links into the thread; the thread's pin chip flashes the pin.
- Notifications carry `postTitle` and `excerpt` (hydrated server-side) so the inbox is one request.
- Live: SSE invalidates the affected queries; new comments from others get a brief highlight. Simulated teammates act every ~20–40 s in the mock (toggle in /dev).
- Mock: tabs share one "server" via BroadcastChannel, so two personas in two tabs see each other live.
- Search results toggle relabeled "Posts | Images" with tooltips (owner feedback: icon-only was unclear).

## UI-5 Bring It In & Present It (+ notebooks)

- **Slide derivation** (`src/lib/slides.ts`, unit-tested): title slide, then explicit slide-break sections; without breaks, each image becomes a slide with adjacent short text (≤ 260 chars) as its caption, and long text is chunked (~650 chars). Headings at the top of a chunk become slide titles.
- Slides render on a fixed 1280×720 canvas scaled to fit, so typography is identical in the presenter, overview, and presenter window.
- **Presenter notes** live on `slide_break.notes` and only appear in the separate presenter window (P), synced with the main window over `BroadcastChannel`; never on the main screen.
- Presenting decks: `/present?posts=a,b` (a selection) or `/present?collection=id`. Slide position is kept in `?s=` so a reload resumes.
- **Selections** survive query changes so posts can be gathered from several searches (`x` toggles the focused result).
- **Notebooks (owner request)** are `Collection { kind: "notebook" }`: ordered by work date at creation, reorderable, removable, printable (print CSS hides app chrome; each entry starts a page). "Make notebook" exists on the selection tray and on each Explore shelf (all posts with the tag, oldest first). Deleting a notebook never deletes posts.
- **Import**: the mock simulates the job (progress, canned slides, per-mode grouping, warnings, guessed dates). Edits in review autosave; commit is idempotent (`Idempotency-Key`). Everything lands as drafts in a `deck_import` collection; "Publish all" and "Delete this import" act on the whole import. Filenames containing "corrupt" simulate a damaged file; "800" simulates an 800-slide deck.
- **Export**: PDF via the browser's print dialog from notebooks; PPTX/PDF file export waits for backend B-5 (open question C2.13 default).
- **App error screen**: anything uncaught shows a recoverable error page instead of the router's developer page.
- **Accessibility**: tooltips on labeled buttons use `describeChild`, so the visible label stays the accessible name.

## Scale: views, notebooks, collections (owner request)

- **No screen downloads every saved view or collection.** The list routes are replaced by `GET /workspaces/{ws}/library?kind=&q=&sort=recent|name&mine=&limit=&cursor=` (one paged, searchable index over views, notebooks, and collections, with per-kind counts) plus single-item reads (`GET /saved-views/:id`, `GET /collections/:id`, `GET /collections/:id/entries`).
- **Pins are per user** (`GET/PUT /workspaces/{ws}/pins`, ordered; Postgres `user_pins(user_id, workspace_id, kind, item_id, position)`). The rail shows up to 10 pins plus a Library link; `SavedView.pinned` now means "pinned by the caller".
- Pickers (Saved menu, command palette, collection filter) search the server as you type; filter chips load only the collections they reference.
- Tag notebooks store `sourceTagId`: one per tag, survives renames; Explore shelves return `notebookId`.
- Delete in the Library offers Undo by recreating the item (the delete returns what it removed).
- The busy scenario seeds ~150 library items so the scale paths are exercised.

## Import reads real decks (owner question: "does import actually work?")

- The mock now parses the uploaded `.pptx` in the browser (`src/mock/pptx.ts`, JSZip + DOMParser) instead of inventing slides. Commit creates real draft posts with the deck's text, tables, pictures (deduplicated by hash), and speaker notes.
- **These parsing rules are the spec for the backend worker** (python-pptx, B-5): slide order from `presentation.xml`; PowerPoint Sections from `p14:sectionLst`; title = `title`/`ctrTitle` placeholder; other text shapes in z-order, bulleted for body/object placeholders or explicit bullet chars; bold/italic/underline kept; `a:tbl` → table block; `p:pic` → image (PNG/JPEG/GIF/SVG/WebP); notes from the notesSlide body placeholder; `secHead` layouts start sections when a deck has no Sections. Warnings for charts, SmartArt, other embedded objects, EMF/WMF pictures, video/audio, animations, transitions, and untitled slides.
- Dates are guessed from slide text: `2024-03-12`, `3/12/2024` (US order), `12 Mar 2024`, `March 12, 2024`.
- Notes are stored on a `slide_break` before each slide's content, so presenting shows them in the notes window.
- Not yet: rendering charts/SmartArt as images (needs LibreOffice server-side), OCR of imported pictures, resumable chunked upload of very large decks.
- Test fixture `e2e/fixtures/Lab_Notes_2021.pptx` is generated by `npm run gen:test-deck`.

## Import keeps slide formatting (owner feedback: "the styling gets stripped", Oct 2026)

Step 1 of the slides plan. Step 2 is a "designed slide" block (a positioned canvas whose text is still indexed); step 3 is editing it in place.

- **Reading order.** Shapes are ordered by position (rows of 1/16 slide height, then left to right), not z-order. Placeholders without their own position inherit it from the layout, then the master. If any shape has no position, the parser keeps z-order. Text and images interleave as they did on the slide (`ParsedSlide.parts`).
- **Formatting kept:**
  - numbered lists (`buAutoNum`, `startAt`) and nested levels (`lvl`);
  - links (`hlinkClick` → external rel, http/https/mailto only);
  - strikethrough;
  - text color and highlight, resolved through the theme (`schemeClr` → `clrScheme`, `lumMod`/`lumOff`);
  - alignment (`algn`);
  - subtitle placeholders and short paragraphs whose runs are all ≥ 28 pt become `h3`.
- **Colors are kept only when clearly colored** (HLS saturation ≥ 0.25 and lightness 0.18–0.82). Black, white, and gray text follows the app theme, so dark mode works. Dark mode lightens stored colors with `color-mix` (`--tc` in `theme/prose.ts`), and highlights keep dark text.
- **Tables:** a header row only when `firstRow` is set (or the table has no `tblPr`); `gridSpan`/`rowSpan` kept; merged-away cells skipped; multi-paragraph cells kept.
- **Charts** become a table of their cached data (categories × series, up to 200 rows and 20 series) with the chart title as a caption. **SmartArt** becomes a bullet list of its node text. Both are searchable.
- **Schema:** the new marks and attributes are `textStyle{color}`, `highlight{color}`, and `textAlign` on paragraphs and headings. The backend sanitizer accepts only `#rrggbb` and the four alignments, and imported docs pass through it.
- **Editor:** one "Text color and highlight" button, and one alignment button that cycles left → center → right → justify, to keep the toolbar short on phones. A text block that contains a table loads with table support, so editing an imported post never drops its tables.
- **Parity:** `Formatting_2024.pptx` (same generator) has a shared expected output, `e2e/fixtures/Formatting_2024.expected.json`, that both the mock and the backend parser must match exactly.

## Navigation and naming (owner feedback, Oct 2026)

- **Home is Explore; the feed is Search.** Home browses (latest posts, tag shelves) and has no
  search box of its own; Search is the newest-first list and the only place you type a query.
- **One Activity entry** replaces Inbox, My drafts, and Hidden & deleted in the rail. Tabs inside
  (`/activity`, `/activity/drafts`, `/activity/recycle-bin`); old URLs redirect. "Hidden & deleted"
  is called **Recycle bin**.
- **Import slides** is a button under New post (the two ways content gets in), plus drop-a-.pptx-
  anywhere, ⌘K, and a hint on empty search results.
- **Pins → Favorites.** A star, a toast that says "Added to Favorites in the sidebar", and a
  highlight on the new rail entry. The rail section is hidden until you have one; Library is a
  normal rail item. API names (`pinned`, `/pins`) are unchanged.
- **Saved view → Saved search.** Each of saved search / collection / notebook has one icon and
  one-line definition everywhere (`concepts.tsx`). Glossary and the documentation backlog:
  `docs/CONCEPTS.md`.
