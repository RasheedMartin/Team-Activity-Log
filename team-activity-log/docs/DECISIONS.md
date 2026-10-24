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
