# Team Activity Log — Product, UI & Data Architecture Spec

**Status:** Draft v0.3 (agent-ready)
**Owner:** Rasheed
**Audience:** The AI coding agent that will build this, plus me and collaborators
**Last updated:** 2026-10-23
**Suggested location in the repo:** `docs/DESIGN.md`

**Changes from v0.2**
- **Search ownership changed.** Anything a user *searches or browses with filters* (including the main feed) is served by **Elasticsearch**. **Postgres** owns identity, relationships, and guaranteed data (auth, users, orgs, comments and threads, permissions, drafts, the user panel). See Part B.
- **UI-first is now the headline.** §0 tells the agent what to build first; the backend is specified so contracts are right, but is **not built yet**.
- **New:** UI design direction (§A4), a full search UX spec with histogram, date filters, tag and user facets (§A6 v4), the user panel (§A6 v1), and a complete backend data architecture (Part B).
- **UI build order:** foundation → v1 → v2 → **v4 (Find It)** → v3 → v5. Block numbers are unchanged; only the order differs, because search is the differentiator and works fully on mocks.

---

## 0. Start here (instructions for the AI agent)

### Mission
Build the best possible **frontend** for a multi-team work-log product, running entirely on fake data behind a mock network layer, so the workflows and feel can be perfected before any backend exists. The backend (Postgres + Elasticsearch + FastAPI) is fully specified in Part B so that the UI contracts are right, **but do not implement it yet**.

### Product in one paragraph
Physicists were logging work in PowerPoint decks that grew too large to open, share, or search. This product replaces that: people write PowerPoint-style posts (title, rich text, annotatable images), discuss them in threads, and find anything later with keyword search and precise filters (histogram, dates, tags, people). Old decks can be imported as posts, and posts can be presented as slides. It is multi-tenant: organizations contain workspaces, workspaces contain posts.

### Existing code (v0)
The repo (`RasheedMartin/Team-Activity-Log`) already has a React 18 + TypeScript + MUI v5 + TipTap + TanStack Query v5 + Vite frontend with a post composer, an image annotator (pen, line, rect, ellipse, arrow, text, highlighter, eraser), threaded comments, reactions, tags, a three-column layout, and a FastAPI stub exposing read-only `GET /posts`, `/users`, `/tags`. Posts use an ordered `blocks[]` array. **Treat v0 as a prototype: reuse what's good (annotator, composer, block model), rewrite what isn't.**

### Ground rules
1. **Audit first.** Before changing anything, write `docs/AUDIT.md`: what exists, what maps to this spec, what to keep, what to rewrite, and risks. Then proceed; don't wait for approval unless something is a real blocker.
2. **UI only, on mocks.** No Postgres, Elasticsearch, auth provider, or object storage work. Leave `backend/` runnable but untouched.
3. **The seam is the network layer** (§A3). Components never import fixtures or call `fetch` directly. Everything goes hooks → typed API client → `fetch`, answered by **MSW** in mock mode.
4. **Build to the final contract** (§A7). No temporary data shapes. Mock search must implement the real `FilterSpec`, facet semantics, and histogram bucketing (§A6 v4, B4).
5. **Every feature works in every scenario:** *empty org*, *small team*, *busy org (5,000 posts)*, *slow network*, *random errors*, and for the *viewer* persona.
6. **Quiet, dense, fast** (§A4). Don't add modals, banners, badges, or toasts without a stated reason.
7. **Record assumptions.** For every **[OPEN]** item you need, pick the stated default, and log it in `docs/DECISIONS.md` with a one-line rationale. Ask the owner only about true blockers.
8. **Small, demoable increments.** One concern per commit/PR; each milestone below ends in something I can click through.
9. **Develop components in isolation** with Storybook + MSW so every component is reviewed in all states (loading, empty, error, large, dark, compact).

### Milestones (in order)

| # | Milestone | Scope | Done when |
|---|---|---|---|
| **UI-0** | Foundation | Repo layout (`frontend/`, `backend/`), design tokens + MUI theme, app shell, routing, MSW + Dexie mock server, faker seed + hand-written fixtures, scenarios + `/dev` panel, `contract.ts`, Storybook, CI (lint, tsc, tests) | `npm run dev` shows the shell on mock data; scenario switching works; CI green |
| **UI-1** | **v1 Get In** | Sign-in/register, org + workspace creation, invites, switcher, members admin, **user panel** | A persona can register an org, create workspaces, invite and accept, switch, and edit their profile |
| **UI-2** | **v2 Write It Up** | Composer, images + metadata drawer, annotator, autosave drafts, publish, edit, hide/show, delete/restore, feed, post detail | Write → annotate → autosave through refresh → publish → edit → hide/unhide, in all scenarios |
| **UI-3** | **v4 Find It** | Search bar, histogram, date filters, tag + user facets, chips, saved views, gallery mode, command palette | The §A6 v4 "done when" list passes on the 5,000-post scenario at 60 fps |
| **UI-4** | **v3 Talk About It** | Threads, anchored image comments, reactions, mentions, inbox, live updates | Deep threads, pins on images, live mock activity, inbox |
| **UI-5** | **v5 Bring It In & Present It** | Carousel/presenter, selection decks, import wizard + review, export UI | Any post presents cleanly; import wizard runs end to end against the mock job |

After UI-5 (or sooner, when the owner says so), start Part B §B13 (backend build order).

---

# PART A — PRODUCT & UI (build first)

## A1. Principles

1. **Capture is effortless.** A title and a pasted screenshot is a valid post. Everything else is optional.
2. **Retrieval is the product.** Value compounds with every post, so search and filtering quality outrank every other feature.
3. **Quiet by default.** Dense, calm UI. No notification spam, no gamification, no engagement tricks.
4. **Your data is yours.** Full export in open formats; no lock-in, especially since we ask people to leave PowerPoint.
5. **Replace PowerPoint, don't fight it.** Easy import in, easy presentation out.

## A2. Vocabulary, roles & permissions

- **Organization (org):** the tenant (a lab, a company). **Workspace:** a team's log inside an org; every post lives in exactly one. **Member:** a user's membership in an org, with a role.
- **Post:** a titled, dated report of ordered **blocks** (text, image, table, slide break). **Asset:** an uploaded file. **Image instance:** an asset as used in one post/comment (captions and annotations attach here). **Annotation:** non-destructive vector markup on an image instance. **Collection:** an ordered set of posts (an imported deck, a meeting selection).

**Org roles:** `owner` · `admin` · `member` · `viewer`.
**Workspace access [DECISION]:** explicit membership (private by default) with an optional "all org members" toggle.

| Action | owner | admin | member | viewer |
|---|:-:|:-:|:-:|:-:|
| Manage org, transfer ownership | ✅ | | | |
| Create/archive workspaces, invite/remove users, change roles | ✅ | ✅ | | |
| Create, edit own, hide own posts | ✅ | ✅ | ✅ | |
| Edit/hide others' published posts | ✅ | ✅ | | |
| Comment | ✅ | ✅ | ✅ | |
| React | ✅ | ✅ | ✅ | ✅ (**[OPEN]** default: yes) |
| Import decks | ✅ | ✅ | ✅ | |
| Read published, visible posts | ✅ | ✅ | ✅ | ✅ |
| See others' drafts | | | | |

Drafts are private to their author. **[OPEN]** default: admins can't see others' drafts.

## A3. UI-first build approach

**[DECISION] The seam is the network layer.** Components call hooks (TanStack Query) → a typed API client → `fetch`. In mock mode **MSW (Mock Service Worker)** intercepts those requests and answers from an in-browser mock server. In live mode the same requests hit FastAPI. One env flag switches: `VITE_API_MODE=mock|live`. No component changes at tie-in; loading and error states are real.

**Mock server**
- Persistent store in the browser (Dexie/IndexedDB or `@mswjs/data`) so everything survives reloads. Uploaded images are stored as blobs and served via object URLs, so upload → annotate → publish feels real.
- Seed data with `@faker-js/faker` plus hand-written, realistic physics-flavored fixtures (titles, tags like `calibration` / `detector-B`, plot-like images in `/public/mock-assets`, OCR text on some images).
- **Scenarios** switchable at `/dev`: *empty org*, *small team (20 posts)*, *busy org (5,000 posts, 800 images, 12 users, 60 tags, 3 years of dates)*, *multi-org user*, *viewer-only*, *slow network*, *random 500s*, *mock-index-lag (new posts appear in search after ~1.5 s, to mimic the real indexer)*.
- **Fake auth:** "Sign in as…" persona picker (dev only) plus the *real* sign-in/register screens wired to the mock.
- **Mock search engine** (MiniSearch/Fuse + hand-written filtering) implements the final `FilterSpec`, **disjunctive facet counts**, and **date-histogram bucketing** exactly as specified in §A6 v4 and §B4, so the UI is built on the real behavior.
- **Mock import:** simulated job with progress and a canned result from a sample deck (real PPTX parsing is backend work).

**Contract-first loop per block:** write/update `src/api/contract.ts` → build UI on mocks → demo and revise → **freeze** the block's contract → (later) backend implements it → flip to live → contract tests keep mock and API in parity.

**Route map**
```
/                         landing + sign-in
/register                 create account (+ create org)
/accept-invite/:token     join via invite
/o/:org                   org home: workspace picker
/o/:org/w/:ws             feed (= search with no filters)
/o/:org/w/:ws/search      search + filters (same view, URL-driven)
/o/:org/w/:ws/new         composer (creates a draft)
/o/:org/w/:ws/p/:postId   post detail
/o/:org/w/:ws/p/:postId/present   carousel / slide view
/o/:org/w/:ws/drafts      my drafts
/o/:org/w/:ws/inbox       mentions and replies
/o/:org/w/:ws/import      import wizard
/o/:org/admin/...         members, workspaces, org settings, storage
/me/...                   user panel: profile, preferences, security, activity
/dev                      mock controls (dev only)
```
**Note:** the feed and search are the **same screen** driven by one URL-serialized `FilterSpec`. "Feed" is just the empty filter, sorted newest first.

## A4. UI design direction

The goal is a tool people keep open all day without it demanding attention.

**Layout.** A left rail (workspace switcher; nav: Feed, Drafts, Saved views, Collections, Inbox, Import), a main column, and an optional right peek pane. On the search screen: top search bar → **histogram strip** → results, with a collapsible **filter sidebar** on the left. Pressing `Space` on a focused result opens a **peek pane** (quick preview, comments count, image strip) without leaving the list.

**Visual language.** Neutral surfaces with a single accent color. Color is reserved for **tags** and **status** (draft/hidden). IBM Plex Sans/Mono (already in v0). 8-px spacing grid. Light and dark themes; **compact** density by default with a *comfortable* toggle (stored in user preferences). Images are the content, so cards give them room and everything else stays small.

**Interaction principles**
- **Keyboard-first:** `c` new post · `/` search · `j/k` move through results · `Enter` open · `Space` peek · `Esc` back/close · `Ctrl/Cmd+K` command palette · `Ctrl/Cmd+Enter` submit · `[` toggle filter sidebar · annotator keys `P L R E A T H X`, `Ctrl/Cmd+Z`.
- **Optimistic everywhere:** reactions, comments, tag edits, hide/show appear instantly and reconcile.
- **Undo instead of confirm:** deleting or hiding shows a single quiet "Undo" for ~8 s. Use a confirmation dialog only for irreversible or org-wide actions (remove user, transfer ownership).
- **No flicker:** while a new search loads, keep the previous results visible and dimmed (`placeholderData: keepPreviousData`); use skeletons, not spinners; debounce typing ~150 ms and cancel in-flight requests.
- **Inline over modal:** edit titles, tags, captions, and metadata in place or in drawers; reserve modals for the annotator and the import wizard.
- **Motion:** 120–200 ms ease-out, purposeful only (panel open, histogram transition, slide change); honor `prefers-reduced-motion`.
- **Empty states** show one clear next action, and never a blank page. Onboarding checklist is dismissible, once.
- **Notifications:** off by default except mentions/replies in the Inbox. No red badges beyond a small dot.

**Images.** Lazy-load with a **blurhash or dominant-color placeholder** (from image metadata, §B10), serve the smallest sufficient variant (thumb/small/medium/original), reserve layout space from stored width/height to avoid layout shift, and open the annotator on the original.

**Performance budgets (on the 5,000-post scenario).** Initial render < 1.5 s; feed scroll at 60 fps via virtualization; filter-change to updated results < 150 ms in mock; histogram interaction at 60 fps; no layout shift from images.

**Accessibility.** Fully keyboard navigable; visible focus; ARIA for custom controls; contrast-checked; the histogram has a keyboard mode and a "view as table" toggle; reduced motion respected. Add `axe` checks to CI.

**Component inventory** (each with Storybook stories for all states): `AppShell`, `WorkspaceSwitcher`, `PostCard` (compact/comfortable), `PostDetail`, `Composer`, `BlockEditor`, `ImageStrip`, `ImageMetadataDrawer`, `Annotator`, `ThreadView`, `CommentComposer`, `ReactionBar`, `SearchBar` (with suggestions), `FilterChips`, `Histogram`, `DateRangePicker`, `FacetList` (tags/people), `SavedViews`, `GalleryGrid`, `PeekPane`, `CommandPalette`, `SlidePlayer`, `ImportWizard`, `MembersTable`, `UserPanel`.

**Testing.** Vitest (pure logic: filter engine, histogram bucketing, state machine, slide derivation), React Testing Library, Storybook interaction tests, Playwright E2E per milestone with screenshot comparison per scenario.

## A5. Post lifecycle (cross-cutting)

Two independent axes plus soft deletion:

```
status:      draft ──publish──▶ published
                   ◀─(only if no comments/reactions)─ unpublish
visibility:  visible ⇄ hidden            (meaningful for published posts)
deletion:    deleted_at set (soft; admins restore for N days, then purge)
```

| State | Who sees it | In feed/search | Comments |
|---|---|---|---|
| Draft | Author only | No (author sees *My drafts*) | No |
| Published + visible | Workspace members | Yes | Yes |
| Published + hidden | Author and admins | Only with "include hidden" | Existing threads read-only |
| Deleted | Admins (restore view) | No | No |

**Hide vs. unpublish [DECISION]:** once a post has comments or reactions it can't return to draft; use **hide** (reversible, optional reason, records who/when). **Revisions:** publishing creates revision 1; later edits create new revisions (rapid autosaves coalesce); readers see an "edited" marker and can open history. Drafts autosave continuously and don't create public revisions. Posts carry a `version` integer for **optimistic concurrency** (§B3).

## A6. Building blocks (workflows)

Each block: **workflows** (what a person does) → screens → what the mock must supply → done-when. (Backend tie-in lives in Part B.)

---

### v1 — Get In: identity, organizations, workspaces, user panel
*Nobody lands inside a team view without signing in and choosing where they are.*

**W1.1 Register an organization.** `/` → "Create account" (name, email, password / magic link / Google) → verify email → create org (name, auto-suggested slug with availability check) → create first workspace ("General", editable) → land in an empty workspace with a dismissible checklist (*invite teammates · write first post · import a deck*).
**W1.2 Sign in/out.** Email+password, magic link, or OAuth; forgot-password; session expiry shows a quiet re-auth prompt that preserves unsaved work (drafts autosave).
**W1.3 Workspaces.** Admin → Workspaces → New (name, description, access: specific members or all org members). Rename, archive (read-only, hidden from pickers, still admin-searchable), restore.
**W1.4 Invite and register users.** Paste emails or upload CSV (`email, name, role, workspaces`); choose role and workspaces; optional shareable invite link with expiry and role cap; resend/revoke; pending list.
**W1.5 Accept an invite.** New users register (email locked) and join assigned workspaces; existing users sign in and the org is added.
**W1.6 Switch org/workspace.** Switcher lists accessible orgs and workspaces, remembers last used, keyboard accessible. Single-org/single-workspace users never see a picker.
**W1.7 Manage members.** Change role, add/remove from workspaces, deactivate (content stays attributed), reactivate, transfer ownership (confirmed). The last owner can't be removed.
**W1.8 User panel** *(Postgres-owned data; see §B8).*
- **Profile:** name, avatar, title/team, bio, pronouns (optional), timezone.
- **Preferences:** theme (light/dark/system), density (compact/comfortable), default workspace, default date field for the histogram (work/published), keyboard shortcuts on/off, notification digest (off/daily/weekly), reduced motion.
- **Security:** password, magic-link/OAuth connections, active sessions with "sign out everywhere", (2FA later).
- **My activity:** my posts, my drafts, my comments, my reactions; each as a filtered view (reusing the search UI).
- **Data:** export my data (JSON + images), delete account (with org-ownership checks).

**Screens:** landing/sign-in · register · verify email · create org · org home/picker · workspace settings · members + invite dialog · accept invite · user panel.
**Mock supplies:** personas (owner, admin, member, viewer, multi-org, invited-not-registered), invite tokens (valid/expired/revoked), slug check, "emails sent" visible in `/dev`.
**Done when:** a new user registers, creates an org and workspace, invites a teammate who accepts and sees only their workspaces, switches workspaces, and edits profile and preferences (theme/density apply immediately and persist).

---

### v2 — Write It Up: posts, images, annotation, draft/publish, hide/show
*The core act: turning work into a clear, findable post.*

**W2.1 Start a post.** `c` creates a **draft immediately** (has an ID; nothing is ever unsaved).
**W2.2 Compose a detailed report.** Title (required to publish) · short summary (optional; powers cards and snippets) · **work date** (when the work happened; default today; distinct from created/published) · body blocks (paragraphs, headings, lists, quotes, code, tables, images, optional slide breaks) · tags (typeahead, color-coded, grouped e.g. *Project / Instrument / Status*) · co-authors (optional) · math via KaTeX (stretch, high value for physicists).
**W2.3 Attach images.** Pick, drag-drop, or paste; multi-select; progress with retry; drag to reorder; replace an image (annotations preserved if dimensions match, else warn). Each image has a **metadata drawer**: *you provide* caption, alt text, figure label ("Fig. 3a"), image tags, free-form key-value fields (`run_id`, `sample`, `instrument`…); *we extract* (read-only) dimensions, type, size, filename, EXIF capture time/camera, OCR text, detected content type, dominant colors/blurhash, content hash. GPS is stripped by default. (Full list: §B10.)
**W2.4 Annotate an image.** Tools: pen, line, rectangle, ellipse, arrow, text, highlighter, eraser, select/move. Color, opacity, size; per-stroke undo/redo; clear. **Non-destructive:** original kept, shapes stored as vectors and re-editable; annotation text is searchable. Annotations belong to the **image instance** (so one picture in two posts keeps separate markup). Handle huge images (downscaled display, original retained) and touch/stylus.
**W2.5 Drafts.** Autosave every few seconds and on blur with a subtle "Saved". *My drafts* lists title, last edited, image count; discard with undo; recover after reload; two-tab edit conflicts warn rather than silently overwrite (`version` check).
**W2.6 Publish.** Inline checklist (title present, ≥1 block, uploads finished; non-blocking hints for missing alt text/tags). On success the post appears at the top of the feed (optimistic; real search catches up within ~1–2 s, §B6).
**W2.7 Edit a published post.** Edit in place → "Update" creates a revision; "edited" marker; revision history (view-only diff first).
**W2.8 Hide / show / unpublish / delete.** Hide with optional reason (badge for those who can still see it); show restores; unpublish only if no comments/reactions; soft delete with undo and admin restore.
**W2.9 Browse and read.** The feed is the search screen with no filters (built in UI-3; in UI-2 a simple chronological list + tag/author filter on the same `FilterSpec`). Post detail renders blocks in order with images inline and annotation overlays visible.

**Screens:** feed · composer · image metadata drawer · annotator · post detail · revision history · my drafts · hidden/trash (admin).
**Mock supplies:** posts in every state, upload that stores blobs with real dimensions and canned EXIF/OCR, injected failures (upload, validation), the 5,000-post scenario.
**Done when:** a member writes a post with several images, annotates two, tags it, survives a refresh via autosave, publishes, edits, hides and unhides it; an admin restores a deleted one; annotations survive reload and re-edit.

---

### v4 — Find It: search, histogram, filters, saved views *(built third in the UI)*
*Retrieval is the product. Everything on this screen is served by Elasticsearch in production (Part B).*

**Screen anatomy**
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Workspace ▾]  🔍 Search posts, tags, people…               [Saved ▾] [+] │
├───────────────┬──────────────────────────────────────────────────────────┤
│ FILTERS       │  ▂▃▅▇▆▃▂▁▂▄▆█▅▃▂▃▅   ← histogram (click bar / drag to select) │
│ Date          │  Jan     Mar     May     Jul     Sep                      │
│  ○ Last 30 d  ├──────────────────────────────────────────────────────────┤
│  ● Custom…    │ 128 posts · 12 Mar – 30 Sep 2026   [tag: calibration ✕]  │
│ Tags (grouped)│                              [by: Dana ✕]  Clear · Save   │
│  ☑ calibration│ ┌──────────────────────────────────────────────────────┐ │
│  ☐ detector-B │ │ Detector B drift after cooldown        Dana · 12 Sep │ │
│ People        │ │ …highlighted snippet…        [img][img][img]    💬 4 │ │
│  ☐ Dana (41)  │ └──────────────────────────────────────────────────────┘ │
│  ☐ Marcus (27)│ …virtualized results…                       [Posts|Gallery]│
└───────────────┴──────────────────────────────────────────────────────────┘
```

**W4.1 Keyword search.** `/` focuses the search bar. Results are **posts**, ranked, with highlighted snippets and a quiet "matched in: title · body · comment · image text · annotation" hint. Prefix matching as you type, typo tolerance, phrases in quotes, `-exclude`.
*Suggestions dropdown while typing:* recent searches, matching **tags**, matching **people**, and top post titles. Selecting a tag or person adds a filter **chip**, not text.
*Operators* (typed text turns into chips on space/enter): `tag:calibration` · `by:dana` · `after:2026-03-01` · `before:2026-09-30` · `has:image` · `has:annotation` · `has:comments` · `is:question` · `-term` · `"exact phrase"`.

**W4.2 Histogram.** A full-width strip above the results showing **number of posts over time** for the *current filters*.

| Behavior | Spec |
|---|---|
| Data | Counts per time bucket for the selected date field (**work date** by default; toggle to *published* or *updated*). |
| Buckets | **Auto interval** targeting ~30–60 bars: ≤ 60 days → day · ≤ 1 year → week · ≤ 4 years → month · ≤ 10 years → quarter · else year. A small control lets the user force day/week/month/quarter/year. |
| Select | **Click a bar** → date filter = that bucket. **Drag across bars** (brush) → custom range. **Shift-click** extends. Drag brush handles to adjust. **Double-click** or `Esc` clears. |
| Zoom | After selecting, "Zoom to selection" re-buckets the strip at finer granularity; "Zoom out" returns. Mouse-wheel + `ctrl` zooms; pinch on touch. |
| Counts reflect | **Every filter except the date filter itself**, so you can still see the distribution outside your selected range (selected range is highlighted; outside is muted). |
| Tooltip | Bucket range, post count, and the top 3 tags in that bucket. |
| Empty/edge | Zero-count bars still render (continuous axis, `min_doc_count: 0`); sparse data shows baseline ticks; a single bar still looks intentional. |
| A11y | Focusable; `←/→` moves between bars, `Enter` selects, `Shift+←/→` extends, a "View as table" toggle exposes the same data. |
| Perf | Pure SVG/canvas; transitions between interval changes animate bar heights (reduced-motion: instant). |

**W4.3 Date filters.** Presets: *Today · Last 7 days · Last 30 days · This quarter · This year · All time*; **Custom range** with a calendar that shows post density per day (heat dots); relative ranges ("last 90 days") are stored as relative so saved views stay fresh. A **Date field** selector: *Work date* (default) / *Published* / *Updated*. The histogram and the date filter always agree.

**W4.4 Tag facet.** Grouped by tag group (Project, Instrument, Status…), with in-list search and per-tag **counts under the current filters**. *Click* = include, *Alt/Option-click* = exclude (shown as a struck-through chip). A **Match any / Match all** toggle per selection. Tags with zero results in the current context are dimmed (not hidden) with their count. Keyboard: arrow keys, `Space` to toggle.

**W4.5 People facet.** Avatars + names with counts (authors and co-authors); *Me* pinned on top; same include/exclude semantics; quick presets "Mine", "I commented", "Mentions me".

**W4.6 Other filters** (via **Add filter** menu → chips; AND/OR/NOT where sensible).

| Filter | Behavior |
|---|---|
| Content | has images · has annotations · has comments |
| Discussion | unanswered questions · resolved threads · I commented · I reacted · mentions me |
| Collection | in/not in a collection (e.g. an imported deck) |
| Status | (author/admin) my drafts · hidden · include deleted (admin) |
| **Image-level** | OCR text contains · image type (chart/photo/screenshot/diagram) · figure label · filename · captured-date range · min dimensions · custom metadata key=value · annotation text contains |
| Provenance | imported from deck · date was guessed |

**W4.7 Facet semantics (disjunctive faceting) [DECISION].** A facet's counts reflect **all other active filters but not its own selection**. Example: with `tag: calibration` selected, the tag list still shows other tags' counts as if only the *other* filters applied, so you can add more tags with OR semantics and see what you'd gain. The histogram follows the same rule for the date filter. (Implementation in §B4; the mock must mimic it.)

**W4.8 Active filter chips and URL state.** All filters appear as removable chips under the strip with a result count, **Clear all**, and **Save view**. The entire `FilterSpec` (query, filters, sort, date field, interval, view mode) is serialized into the URL, so links reproduce the exact view.

**W4.9 Saved views.** Name a filter+sort combination; private or workspace-shared; pinned views appear in the left rail. Relative dates stay relative.

**W4.10 Gallery mode.** `[Posts | Gallery]` toggle switches results to an **image grid** (thumbnail with blurhash placeholder, caption, figure label, parent post). Click → image viewer with annotations and a link to the post; image-level filters apply naturally here.

**W4.11 Sort, pagination, states.** Sort: relevance (when there's a query), newest, oldest, work date, most discussed, recently active. Infinite scroll with a stable cursor. **Zero results** explains why and suggests which filter to drop (using facet counts). Loading keeps the previous results dimmed. An unobtrusive "Indexing…" hint is never shown; the post you just published appears optimistically.

**W4.12 Command palette** (`Ctrl/Cmd+K`): jump to a post by title, apply a saved view, toggle a tag, switch workspace, "New post".

**Mock supplies:** the client-side engine described in §A3; seeded OCR text; 3 years of dates with realistic clustering (bursts around deadlines) so the histogram looks alive; tags with groups; a `mock-index-lag` scenario.
**Done when:** on the 5,000-post scenario, a user can type a query, click a histogram bar, add two tags (one excluded), filter to one person, switch to gallery, save the view, and reload from the URL to get the identical state; facet counts follow §W4.7; everything stays at 60 fps; the whole flow works by keyboard.

---

### v3 — Talk About It: comments, threads, reactions, mentions *(built fourth)*
*Posts become conversations. Comments and threads are Postgres-owned (relationships, ordering, permissions).*

**W3.1 Comment.** Under the post: light rich text (bold, italic, code, links, lists), **@mentions**, pasted/attached images (same asset pipeline, annotatable). `Ctrl/Cmd+Enter` submits; optimistic UI.
**W3.2 Reply in threads.** Reply to any comment; unlimited depth in data; UI collapses beyond depth 4 ("Continue thread →"); collapse/expand branches; "jump to latest reply".
**W3.3 Anchored comments on images.** Click a spot (or select an annotation) to **pin a comment** at normalized coordinates. A numbered pin appears on the image and the thread opens in a side panel, linked both ways.
**W3.4 React.** Emoji toggles on posts and comments with who-reacted on hover.
**W3.5 Mentions and inbox.** `@` autocompletes workspace members; the **Inbox** lists mentions and replies with mark-read; no push/email by default (optional digest later).
**W3.6 Questions and resolution.** Mark a thread as a **question**; anyone can mark it **resolved** (optionally choosing an accepted answer). Feeds the "unanswered questions" filter.
**W3.7 Edit, delete, moderate.** Edit own ("edited" marker); delete own (tombstone if it has replies); admins can hide comments.
**W3.8 Live updates.** New comments/reactions appear without refresh (SSE in production; timers in the mock).

**Mock supplies:** threads 6 levels deep, a 200-comment post, anchored comments, other personas commenting live, tombstones, mentions of the current persona.
**Done when:** two personas converse live in a deep thread, pin a comment to an image region, mention each other, see Inbox items, and resolve a question; viewers can only react; hidden posts' threads are read-only.

---

### v5 — Bring It In & Present It: slide view and PowerPoint import
*The migration path off PowerPoint, and the way back out.*

**W5.1 Present a post (carousel).** **Present** opens a full-screen carousel with no app chrome. *Slide derivation [DECISION]:* a title slide, then slides from blocks; explicit **slide-break** blocks win; otherwise each image block becomes a slide with its adjacent text as caption and long text is chunked; imported decks keep their original breaks. Controls: arrows/click/swipe, overview grid, jump-to-slide, annotations visible, optional presenter notes (per-slide, never on the main screen), zoom-into-image, laser pointer. Reduced-motion honored. **[OPEN]** read-only expiring presentation links for people without an account.
**W5.2 Present a selection.** From search results or a collection, select posts → ordered deck (reorder, skip) → save as a collection.
**W5.3 Import a PowerPoint.** Upload (chunked, resumable) → choose a mode → defaults → progress → **review** → commit.
- **Modes:** *One post per slide* (default, dated lab logs) · *One post for the whole deck* with slides as slide-break sections (presentations) · *Group by section* (consecutive slides under one header become one post).
- **Defaults:** author, workspace, tags, base work date (or "guess from slide text/file date"), collection name.
- **Review:** grid of what will be created: title, slide count, guessed date, images, **warnings** (unsupported objects, missing titles, huge images). Edit titles, merge/split, deselect slides, bulk-fix dates.
- **Commit:** everything is created as **drafts** in a collection named after the deck; then bulk publish/tag/hide. A downloadable report lists counts, skips, warnings.
- **Mapping:** slide title → post title · text frames → text blocks (bold/italic/lists/links) · pictures → image blocks (deduped, thumbnails, OCR, metadata) · tables → table blocks · speaker notes → per-slide notes **[OPEN]** · charts/SmartArt/groups → image of that slide as a fallback. Animations, transitions, macros, and video aren't preserved and are called out in warnings.
- **Dates:** `work_date_source` records `user | guessed | import_fallback`; the review screen highlights guessed ones.
**W5.4 Provenance without hoarding storage [DECISION — please confirm].**
- The original `.pptx` is **not retained by default**: it lives in temp storage and is deleted at commit or after a **7-day TTL**.
- Every imported post and image keeps **lightweight provenance**: filename, file hash, size, slide number/total, import date, importer, job. Shown as a quiet label: *From "Lab_Notes_2022.pptx" · slide 42* (a download link only if the file is retained).
- Pictures are the real payload: stored as normal assets, **deduplicated by hash within the org**, with thumbnails generated once. We **don't** store a render of every slide, only of slides with unmappable content.
- **Optional, off by default:** org setting "Retain original decks" with a window (30/90/365 days or until deleted) and a per-org storage quota with a usage meter. Storage accounting exists from v2.
**W5.5 Post-import cleanup.** Bulk publish/tag/hide, merge/split posts, re-guess dates, delete a whole import (removes its posts and unreferenced assets).
**W5.6 Export (stretch).** PDF and PPTX of a post/selection/collection (editable text and images; annotations flattened to PNG). I read "present off the platform" as presenting from the carousel without app chrome, plus export for when the app isn't available; **please confirm.**

**Mock supplies:** canned results per import mode (with warnings), simulated progress/failure/resume, an 800-slide scenario, posts with and without slide breaks.
**Done when:** every post presents cleanly; the import wizard runs end to end in all three modes against the mock job, including review edits and commit-as-drafts.

---

## A7. Frontend contract (`src/api/contract.ts`, starting point)

The mock server and the real API both implement this. When it changes, update the mock, the doc, and the contract tests in the same PR.

```ts
type ID = string;        // UUIDv7
type ISODateTime = string;
type ISODate = string;   // YYYY-MM-DD (no timezone)

type OrgRole = "owner" | "admin" | "member" | "viewer";
type PostStatus = "draft" | "published";
type Visibility = "visible" | "hidden";

interface User { id: ID; name: string; email: string; avatarUrl?: string; title?: string }
interface UserPreferences {
  theme: "light" | "dark" | "system"; density: "compact" | "comfortable";
  defaultWorkspaceId?: ID; histogramDateField: DateField;
  shortcuts: boolean; digest: "off" | "daily" | "weekly"; reducedMotion: boolean; timezone: string;
}
interface Organization { id: ID; name: string; slug: string }
interface Membership { orgId: ID; user: User; role: OrgRole; status: "active" | "invited" | "deactivated" }
interface Workspace { id: ID; orgId: ID; name: string; slug: string; description?: string; archived: boolean; allOrgMembers: boolean }

interface Tag { id: ID; name: string; color: string; groupId?: ID }
interface TagGroup { id: ID; name: string }

type Block =
  | { id: ID; type: "text"; doc: unknown /* ProseMirror JSON */ }
  | { id: ID; type: "image"; imageInstanceId: ID }
  | { id: ID; type: "table"; doc: unknown }
  | { id: ID; type: "slide_break"; notes?: string };

interface Post {
  id: ID; orgId: ID; workspaceId: ID;
  title: string; summary?: string;
  workDate: ISODate; workDateSource: "user" | "guessed" | "import_fallback";
  status: PostStatus; visibility: Visibility;
  hiddenReason?: string; hiddenBy?: ID; hiddenAt?: ISODateTime;
  authorId: ID; coAuthorIds: ID[]; tagIds: ID[]; blocks: Block[];
  revision: number; version: number;                       // version = optimistic concurrency token
  createdAt: ISODateTime; updatedAt: ISODateTime; publishedAt?: ISODateTime; deletedAt?: ISODateTime;
  counts: { comments: number; reactions: number; images: number };
  source?: { kind: "import"; importJobId: ID; fileName: string; fileSha256: string; slide: number; slideCount: number };
}

interface Asset {
  id: ID; kind: "image"; mime: string; bytes: number; width: number; height: number; sha256: string;
  originalFilename?: string; blurhash?: string; dominantColors: string[];
  variants: { name: "thumb" | "small" | "medium" | "original"; url: string; width: number; height: number }[];
  processing: "pending" | "ready" | "failed";
  metadata: ImageMetadata;   // §B10
}
interface ImageInstance {      // an asset as used in one post or comment
  id: ID; assetId: ID; postId?: ID; commentId?: ID;
  caption?: string; altText?: string; figureLabel?: string; tags: string[];
  customFields: Record<string, string>;
  annotation?: { shapes: Shape[]; version: number };
}

interface Comment {
  id: ID; postId: ID; parentId?: ID; authorId: ID; doc: unknown; imageInstanceIds: ID[];
  anchor?: { imageInstanceId: ID; x: number; y: number; annotationShapeId?: string }; // 0..1
  isQuestion: boolean; resolved: boolean; hidden: boolean;
  createdAt: ISODateTime; editedAt?: ISODateTime; deletedAt?: ISODateTime;
  reactions: Record<string, ID[]>;
}

// ---- Search: ONE schema used by the URL, saved views, the mock engine, and the real API ----
type DateField = "workDate" | "publishedAt" | "updatedAt";
type Interval = "auto" | "day" | "week" | "month" | "quarter" | "year";

interface FilterSpec {
  q?: string;
  all?: Condition[];        // AND
  any?: Condition[];        // OR (one level)
  none?: Condition[];       // NOT
  sort?: "relevance" | "newest" | "oldest" | "workDate" | "mostDiscussed" | "recentActivity";
  view?: "posts" | "gallery";
  histogram?: { field: DateField; interval: Interval };
  facets?: ("tags" | "authors" | "imageTypes")[];
  cursor?: string; limit?: number;
}
type Condition = { field: FilterField; op: "in" | "in_all" | "not_in" | "eq" | "between" | "contains" | "gte" | "lte"; value: unknown };
type FilterField =
  | "author" | "coAuthor" | "tag" | DateField
  | "hasImages" | "hasAnnotations" | "hasComments" | "unansweredQuestion" | "resolved"
  | "mentionsMe" | "iCommented" | "iReacted" | "mine" | "collection" | "status" | "visibility"
  | "importedFrom" | "workDateGuessed"
  | "image.ocrText" | "image.type" | "image.figureLabel" | "image.filename"
  | "image.capturedAt" | "image.minWidth" | "image.minHeight" | "image.custom" | "image.annotationText";
// Relative dates are allowed as { preset: "last_30_days" } values and resolved server-side/at query time.

interface FacetBucket { value: string; label?: string; count: number; selected?: boolean }
interface HistogramBucket { start: ISODateTime; end: ISODateTime; count: number; topTags?: { tagId: ID; count: number }[] }

interface SearchResponse {
  hits: { post: Post; highlights: { field: string; snippet: string }[]; matchedIn: string[]; imageHits?: { imageInstanceId: ID; thumbUrl: string }[] }[];
  images?: { imageInstanceId: ID; postId: ID; thumbUrl: string; blurhash?: string; caption?: string; figureLabel?: string }[]; // gallery view
  facets: { tags: FacetBucket[]; authors: FacetBucket[]; imageTypes: FacetBucket[] };
  histogram?: { field: DateField; interval: Exclude<Interval, "auto">; buckets: HistogramBucket[]; selectedRange?: { from: ISODateTime; to: ISODateTime } };
  total: number; nextCursor?: string; tookMs: number;
}
```

---

# PART B — BACKEND DATA ARCHITECTURE (specified now, built after the UI)

## B1. Guiding principle: who owns what

**Postgres is the system of record for relationships and guaranteed data.** Anything that must be correct, consistent, permissioned, or transactional lives there. **Elasticsearch is the system of discovery.** When a user searches or browses with filters (including the main feed, histogram, and facets), they are querying Elasticsearch. ES is **derived data**: it can be deleted and rebuilt from Postgres at any time, and nothing exists only in ES.

| Concern | Postgres | Elasticsearch |
|---|---|---|
| Login, sessions, passwords, OAuth identities | ✅ | |
| Users, orgs, workspaces, memberships, roles, invites | ✅ | |
| User panel: profile, preferences, security, activity | ✅ | |
| Permission decisions (who can see/do what) | ✅ (authoritative) | mirrors a few fields for filtering |
| Post create/update/publish/hide/delete (writes) | ✅ | |
| Post **detail** read (single post by ID) | ✅ | |
| Drafts, "My drafts", hidden/trash admin lists | ✅ | |
| **Comments, threads, replies, reactions, mentions, inbox** (reads and writes) | ✅ | comment text is indexed for *searching*, not served from ES |
| Tags, tag groups, collections, saved views (CRUD, ordering) | ✅ | tag names/IDs indexed on posts |
| Assets and image-instance metadata (source of truth) | ✅ | image text/metadata indexed for search |
| Import jobs, exports, audit log, storage accounting | ✅ | |
| **Keyword search, ranking, highlighting** | | ✅ |
| **Main feed and filtered browsing** | | ✅ |
| **Facets (tags, people) with counts** | | ✅ |
| **Date histogram** | | ✅ |
| **Gallery mode (image search)** | | ✅ |
| Saved views *execution* (run the stored `FilterSpec`) | stored | executed |

**Rule of thumb:** *searching and browsing → ES; opening, writing, relating, authenticating → Postgres.*

## B2. Data flows

**Write path (every mutation)**
```
Client ──▶ FastAPI ──▶ BEGIN
                        1. validate + authorize (membership/role from PG, RLS on)
                        2. write rows (posts/comments/…)  [check `version` for concurrency]
                        3. INSERT outbox row(s) for affected search documents
                      COMMIT   ──▶ respond to client (optimistic UI already shown)
                                  │
Indexer worker ◀── outbox ────────┘   builds docs from Postgres ──▶ Elasticsearch
```

**Read paths**
```
Open a post / thread / inbox / members / drafts ──▶ FastAPI ──▶ Postgres ──▶ response
Search / feed / histogram / facets / gallery     ──▶ FastAPI ──▶ build ES query from FilterSpec
                                                     (server injects tenant + permission filters)
                                                  ──▶ Elasticsearch ──▶ IDs + highlights + aggs
                                                  ──▶ hydrate from Postgres (authoritative fields,
                                                       drop anything PG says is not visible)
                                                  ──▶ response
```
Hydration keeps list responses correct if the index is momentarily stale (e.g., a post was just hidden): ES decides **which** posts and in what order; Postgres decides **what is returned and whether the caller may see it**.

## B3. Postgres design rules

- **Version:** PostgreSQL 16+. Extensions: `citext` (emails, tag names), `ltree` (comment thread paths), `pg_trgm` (typeahead in admin lists such as members), `btree_gin` as needed. UUIDv7 primary keys (generated in the app, or native `uuidv7()` on PG 18).
- **Tenancy.** Every tenant table carries `org_id` (and `workspace_id` where relevant). **Row-level security** is enabled on all of them with a policy like `org_id = current_setting('app.current_org')::uuid`, set per request via `SET LOCAL` inside the transaction. The application connects as a role that does **not** bypass RLS. Workspace-level access is enforced in the service layer and re-verified by hydration queries.
- **Integrity.** Foreign keys everywhere; `ON DELETE` rules chosen deliberately (org delete cascades; user delete is a *deactivation*, never a hard delete of authored content); enums as `CHECK` constraints or lookup tables; partial unique indexes (e.g., unique tag name per org where `archived_at IS NULL`; unique `(org_id, sha256)` on assets); `CHECK`s encoding the post state machine (e.g., `status = 'draft' ⇒ published_at IS NULL`).
- **Concurrency.** `version integer` on posts and comments, incremented on every update; clients send the version they read and the update fails with `409` if stale (prevents two tabs silently overwriting each other's draft). Use `SELECT … FOR UPDATE` only inside short transactions.
- **Comment trees.** Adjacency list (`parent_id`) plus an `ltree` `path` for fast subtree and ordering queries; load a post's thread in one query ordered by path; paginate by top-level comment. Denormalized counters (`comment_count`, `reaction_count`) are updated in the same transaction (or by a trigger) and reconciled by a nightly job.
- **Soft delete.** `deleted_at` on posts/comments; a purge job hard-deletes after the retention window and removes now-unreferenced assets (`asset_refs`). Tombstones for comments with replies.
- **Pagination.** Keyset only (never `OFFSET`), e.g. `(created_at, id)` for comments and admin lists.
- **Transactional outbox.** Any write that changes searchable content inserts outbox rows **in the same transaction** (§B5). No dual writes, ever.
- **Idempotency.** `idempotency_keys` table for create endpoints that clients may retry (publish, import commit).
- **Migrations.** Alembic only; expand → migrate → contract for breaking changes; every migration is reviewed against a fresh DB and the previous schema.
- **Backups.** Automated backups + PITR, documented restore drill. (ES snapshots are optional because ES is rebuildable.)

## B4. Elasticsearch design

**Version:** Elasticsearch 8.x (**[OPEN]** OpenSearch is a near drop-in if licensing or managed-hosting preference demands it).

**Indices** (versioned names with aliases, e.g. `posts_v1` ← aliases `posts_read`, `posts_write`)
- **`posts`**: one document per *published* post (hidden posts are included with `hidden: true`; drafts are **never** indexed; deleted posts are removed). Comments and images are **nested** inside the post document.
- **`images`**: one document per image instance, denormalized with its parent's tenant, tags, authors, and dates, powering **gallery mode** and image-level result lists (pagination is per image, which nested hits can't do well).
- **Tenancy:** a **shared index** with `org_id` as the routing key (queries route to the org's shard) and a mandatory server-injected `org_id` filter. A very large tenant can later be given a dedicated index. Start with 1–3 primary shards.
- **Mapping:** `dynamic: strict`.

**Post document (sketch)**
```json
{
  "org_id": "keyword", "workspace_id": "keyword", "post_id": "keyword",
  "status": "keyword", "hidden": "boolean", "deleted": "boolean",
  "title": { "type": "text", "analyzer": "text_en",
             "fields": { "prefix": { "type": "text", "analyzer": "prefix_index", "search_analyzer": "standard" },
                         "raw": { "type": "keyword", "normalizer": "lowercase" } } },
  "summary": { "type": "text", "analyzer": "text_en" },
  "body_text": { "type": "text", "analyzer": "text_en", "term_vector": "with_positions_offsets" },
  "author_id": "keyword", "co_author_ids": "keyword",
  "tags": { "type": "object", "properties": {
      "id": "keyword", "name": { "type": "text", "analyzer": "text_en", "fields": { "prefix": {} , "raw": {} } }, "group_id": "keyword" } },
  "collection_ids": "keyword",
  "work_date": "date", "work_date_source": "keyword",
  "published_at": "date", "updated_at": "date", "created_at": "date",
  "has_images": "boolean", "has_annotations": "boolean", "has_comments": "boolean",
  "unanswered_question": "boolean", "has_resolved_thread": "boolean",
  "comment_count": "integer", "reaction_count": "integer", "image_count": "integer",
  "mentioned_user_ids": "keyword", "commenter_ids": "keyword", "reactor_ids": "keyword",
  "imported_from": "keyword",
  "comments": { "type": "nested", "properties": {
      "id": "keyword", "author_id": "keyword", "text": { "type": "text", "analyzer": "text_en" },
      "is_question": "boolean", "resolved": "boolean", "created_at": "date" } },
  "images": { "type": "nested", "properties": {
      "image_instance_id": "keyword", "asset_id": "keyword",
      "caption": "text", "alt_text": "text", "figure_label": { "type": "keyword", "normalizer": "lowercase" },
      "ocr_text": { "type": "text", "analyzer": "text_en" },
      "annotation_text": { "type": "text", "analyzer": "text_en" },
      "type": "keyword", "filename": "keyword", "captured_at": "date",
      "width": "integer", "height": "integer",
      "custom": { "type": "flattened" }, "tags": "keyword" } },
  "version": "long"
}
```
*(This is a sketch: implementers finalize the exact mapping and analyzers, but the field set and the "nested for comments/images" decision are fixed.)*

**Analysis.** `text_en`: standard tokenizer → lowercase → ASCII folding → English possessive/stop/stem. `prefix_index`: edge n-gram (2–15) for as-you-type on titles and tags. Highlighting uses the unified highlighter with offsets. A per-workspace synonym set (e.g., domain terms) is a later feature.

**Why nested.** Comments and images must match *as a unit*: "an image of type `chart` **and** OCR text containing `peak`" must hit the same image, not two different ones. Comments are capped at indexing time (e.g., latest 500 comments / ~100 KB of text) to bound document size; if volume demands it, move comments to their own index (**[OPEN]**).

**Query construction (always server-side from `FilterSpec`; never raw client queries)**
1. **Security filters, always on** (inside `bool.filter`): `org_id = ctx.org`, `workspace_id ∈ user's accessible workspaces`, `status = published`, `deleted = false`, and `hidden = false` unless the caller has `include hidden` *and* permission.
2. **Text query** (`q`): `bool.should` across `title^4` (plus `title.prefix^2`), `summary^2`, `tags.name^3`, `body_text`, `nested(comments.text)^0.7`, `nested(images.caption/alt_text/ocr_text/annotation_text)^0.8`, with a phrase boost for quoted phrases; `inner_hits` on nested clauses supply the "matched in" hints and snippets. Default relevance tie-break: `published_at desc, _id`.
3. **Filters** from `all/any/none` map to `term/terms/range/exists` clauses (nested for image-level conditions).
4. **Disjunctive faceting.** Selected facet values are applied in **`post_filter`** (so they narrow the hits but not the aggregations). Each facet aggregation (tags, authors, image types) is wrapped in a **`filter` aggregation containing every *other* active filter**, then a `terms` aggregation. This yields counts "as if my own selection weren't applied" (§A6 W4.7).
5. **Histogram.** A `date_histogram` on the chosen date field with `calendar_interval` (day/week/month/quarter/year), `min_doc_count: 0`, `extended_bounds` set to the active range (or data min/max), and `time_zone` from user preferences (for timestamp fields; `work_date` is a plain date). It sits inside a `filter` aggregation holding **all filters except the date filter**. A sub-aggregation returns top tags per bucket for tooltips. **Auto interval** is chosen server-side from the requested range (rules in §A6 W4.2) so the client always receives ~30–60 buckets.
6. **Paging.** Point-in-time (PIT) + `search_after` with a stable tiebreaker; the cursor in `FilterSpec` wraps PIT id + sort values. Never deep-page with `from/size`.
7. **Gallery mode** queries the `images` index with the same filters (translated to its flatter schema) and the same facet logic.
8. **Hydration.** Take IDs/highlights/aggregations from ES; load posts, authors, tags, counts from Postgres in one batched query (`WHERE id = ANY(...)`, RLS on); silently drop hits Postgres says are invisible.
9. **Relevance extras** (off at first): gentle recency decay, boost for resolved-question threads, "more like this" for related posts.

**Index lifecycle.** New mapping → create `posts_v2`, bulk-index from Postgres, replay the outbox from the start timestamp, atomically swap the `posts_read`/`posts_write` aliases, delete the old index. Zero downtime; same procedure for disaster recovery.

## B5. Sync pipeline (Postgres → Elasticsearch)

- **Outbox rows** carry `(org_id, entity, entity_id, op, created_at)`; the worker never trusts a payload. It **rebuilds the document from Postgres** (making processing idempotent and order-insensitive).
- **Claiming:** `SELECT … FROM outbox WHERE processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT n`, with **coalescing**: if a post has ten pending events, build its document once.
- **Targets:** post events → `posts` doc (comments/images nested) and the post's `images` docs; comment/reaction/annotation/asset-metadata events → re-index the parent post; tag rename → re-index affected posts (background fan-out); user rename → re-index posts where it is denormalized (or avoid denormalizing names: facets return IDs and the client resolves names).
- **Ordering and idempotency:** index with **external versioning** (`version_type=external`, `version = posts.version` or a monotonic counter) so stale writes are rejected by ES. Deletes and hides are explicit operations (`delete` / partial update `hidden: true`).
- **Failure handling:** exponential backoff, attempt counter, dead-letter state after N attempts with an alert; the pipeline is resumable because Postgres is the truth.
- **Latency target:** p95 write-to-searchable **< 2 s** (ES `refresh_interval` 1 s). Expose **index lag** (oldest unprocessed outbox age) as a metric and alert on it.
- **Reindex/backfill command:** `reindex --org <id> | --all | --since <ts>`: keyset-scan Postgres, bulk index, verify counts per org (Postgres published posts vs. ES doc count), report drift.
- **Image processing** (thumbnails, EXIF, hash, OCR, blurhash) runs in the same worker framework; when OCR completes, it enqueues a re-index of the parent post.

## B6. Consistency & failure matrix

| Situation | What the user sees | Mitigation |
|---|---|---|
| Just published a post | It appears at the top of the feed immediately | Client **optimistic overlay** (inserted into the query cache) until ES returns it (≤ ~2 s) |
| Just commented | Comment appears in the thread immediately (thread is read from Postgres) | Search for that comment text may lag ≤ ~2 s; acceptable |
| Post hidden/deleted but ES not yet updated | Post never shown | **Hydration drops** it; ES update follows |
| New tag created/renamed | Tag lists (served from Postgres, cached) are immediate | Facet counts catch up as posts re-index |
| Elasticsearch unavailable | Search/feed return a clear, quiet "Search is temporarily unavailable" state; **everything else works** (detail pages, comments, drafts, admin) | Writes still succeed (outbox queues); alerts fire. **[OPEN]** Optional degraded mode: Postgres `tsvector` search over title/summary/body + basic tag/author/date filters, no facets/highlights. Recommended later, not required at launch. |
| Index drift (bug, partial failure) | Missing or extra results | Per-org count verification job + `reindex` command |
| Worker backlog | Search lags | Lag metric + autoscale workers; UI is unaffected otherwise |
| Stale client edit (two tabs) | "This post changed. Review and retry." | `version` check → `409` |

## B7. Assets & object storage

- **S3-compatible storage** (MinIO locally, S3/R2/GCS in prod). Uploads use **presigned URLs** (multipart for large files). Postgres stores keys and metadata only; keys are org-prefixed (`org/{org_id}/assets/{sha256[:2]}/{sha256}`), so identical content in one org is stored once.
- **Pipeline:** upload → `complete` call → worker generates variants (thumb/small/medium), extracts metadata (EXIF, color stats, perceptual hash, dominant colors, blurhash), runs OCR and content-type detection, and optionally a malware scan → asset `ready`. The UI never blocks: an image is usable immediately and gains metadata as it arrives.
- **Serving:** short-lived signed URLs (or a CDN with signed cookies), scoped to the org.
- **Garbage collection:** `asset_refs` tracks referrers; unreferenced assets are purged after a grace period.
- **Temp area** for imports with TTL cleanup (§A6 W5.4); `storage_usage` accounting per org (assets, temp, retained decks, dedupe savings).

## B8. Auth, sessions & the user panel (all Postgres)

- **Auth provider [OPEN]:** hosted (Clerk / Auth0 / WorkOS) vs. self-hosted (Keycloak / Authentik / `fastapi-users` / Authlib). Either way: no home-grown crypto, **httpOnly secure cookie sessions** (or short-lived JWT + refresh), email verification, password reset, magic link and Google/Microsoft login; SSO (SAML/OIDC) is a later feature but must not be blocked by the choice.
- **Session tables** (`sessions`, `identities`) live in Postgres even with a hosted provider, so "sign out everywhere" and audit work uniformly. Rate-limit auth endpoints.
- **Request context:** auth → resolve user → resolve org from the route → load membership/role → `SET LOCAL app.current_org` → handlers run with RLS on.
- **User panel data** (profile, `user_preferences`, sessions, connected accounts, export/delete requests) is plain relational data in Postgres; "My activity" views are ordinary search `FilterSpec`s executed against Elasticsearch (`mine`, `iCommented`, `iReacted`), while "My drafts" is a Postgres list.
- **Audit log** for admin actions (invites, role changes, deactivations, hide/delete, exports).

## B9. Data model (Postgres)

All tenant tables carry `org_id` (+ `workspace_id` where relevant), `created_at`, `updated_at`, and are under RLS. UUIDv7 IDs.

**Identity & tenancy**
| Table | Key columns / notes |
|---|---|
| `users` | email (citext, unique), name, title, bio, avatar_asset_id, timezone, email_verified_at, last_login_at, deactivated_at |
| `user_preferences` | user_id, theme, density, default_workspace_id, histogram_date_field, shortcuts_enabled, digest, reduced_motion |
| `identities` | user_id, provider (password/google/microsoft/saml), provider_subject, password_hash (local only) |
| `sessions` | user_id, device, ip, created_at, expires_at, revoked_at |
| `organizations` | name, slug (unique), plan, storage_quota_bytes, settings (jsonb: retain_decks, retention_days, …) |
| `memberships` | user_id, org_id, role, status (invited/active/deactivated), invited_by, joined_at |
| `workspaces` | org_id, name, slug, description, all_org_members, archived_at, settings (jsonb) |
| `workspace_members` | workspace_id, user_id, role_override |
| `invites` | org_id, email, role, workspace_ids[], token_hash, expires_at, accepted_at, revoked_at, invited_by |
| `audit_log` | org_id, actor_id, action, entity_type, entity_id, meta (jsonb), ip |
| `idempotency_keys` | key, user_id, request_hash, response, expires_at |

**Posts & organization**
| Table | Key columns / notes |
|---|---|
| `posts` | workspace_id, author_id, title, summary, **work_date**, **work_date_source**, **status**, **visibility**, hidden_by/at/reason, published_at, current_revision, **version**, body_text, source_import_job_id, deleted_at |
| `post_blocks` | post_id, position (fractional index), type (text/image/table/slide_break), content (jsonb ProseMirror), image_instance_id, notes |
| `post_revisions` | post_id, revision, snapshot (jsonb), edited_by, change_note |
| `post_contributors` | post_id, user_id, role (author/co-author) |
| `tag_groups` / `tags` | org_id, name (citext), color, group_id, archived_at; unique name per org (partial) |
| `post_tags` | post_id, tag_id |
| `collections` / `collection_posts` | name, kind (manual/deck_import/saved_selection), created_by / position |
| `saved_views` | workspace_id, owner_id, name, filter_spec (jsonb), shared, pinned, position |

**Discussion** *(Postgres is authoritative for all of it)*
| Table | Key columns / notes |
|---|---|
| `comments` | post_id, parent_id, path (ltree), author_id, body (jsonb), body_text, is_question, resolved_at/by, accepted_answer_id, hidden_at/by, deleted_at, edited_at, **version** |
| `comment_anchors` | comment_id, image_instance_id, x, y (0..1), annotation_shape_id |
| `reactions` | target_type, target_id, user_id, emoji; unique (target, user, emoji) |
| `mentions` | source_type, source_id, mentioned_user_id |
| `notifications` | user_id, kind, source_type, source_id, read_at |

**Assets, images & annotations**
| Table | Key columns / notes |
|---|---|
| `assets` | storage_key, mime, bytes, width, height, sha256, phash, blurhash, processing_state, scan_state, original_filename, source_kind (upload/paste/screenshot/pptx_import), uploaded_by; **unique (org_id, sha256)** |
| `asset_variants` | asset_id, name, storage_key, width, height, bytes |
| `asset_metadata` | asset_id, extracted (jsonb: EXIF, color stats, detected_type, ocr_confidence, language), ocr_text, ocr_state, captured_at, camera_make/model, dominant_colors, orientation, dpi, color_space, has_alpha |
| `image_instances` | asset_id, post_id or comment_id, caption, alt_text, figure_label, tags[], custom_fields (jsonb), position |
| `annotations` | image_instance_id, shapes (jsonb), version, annotation_text, updated_by |
| `asset_refs` | asset_id, referrer_type, referrer_id |

**Import, export & ops**
| Table | Key columns / notes |
|---|---|
| `import_jobs` | workspace_id, user_id, status, mode, source_filename, source_sha256, source_bytes, slide_count, temp_storage_key, temp_expires_at, retained, options, stats, error |
| `import_items` | job_id, slide_number, proposed_title, proposed_date, warnings[], included, post_id |
| `source_refs` | entity_type, entity_id, import_job_id, filename, sha256, slide_number, slide_count |
| `exports` | requested_by, kind (pdf/pptx/zip), target, status, storage_key, expires_at |
| `storage_usage` | bytes_assets, bytes_temp, bytes_retained_decks, dedupe_saved_bytes |
| `outbox` | org_id, entity, entity_id, op, created_at, processed_at, attempts, last_error |
| `jobs` | queue, payload, run_at, locked_by, attempts, last_error (if using a Postgres-backed queue) |

## B10. Image metadata (what makes images findable)

All four sources are stored in Postgres (truth), indexed in Elasticsearch (`posts.images` nested + `images` index), and exposed as filters.

1. **Provided by the author (per image instance):** caption · alt text · figure label ("Fig. 3a") · image tags · free-form key-value fields (`run_id`, `sample`, `instrument`, `temperature`…) · short description. *Later: workspace-defined required custom fields.*
2. **Extracted automatically (worker):**
   - *Technical:* width, height, aspect ratio, bytes, MIME, DPI, color space, has-alpha, orientation, **SHA-256** (exact dedupe), **perceptual hash** (near-duplicates, "similar images"), **blurhash**, dominant colors.
   - *EXIF:* capture time, camera make/model, lens, exposure; **GPS stripped by default** (org setting can retain).
   - *Content:* **OCR text** (+ confidence, language); **detected type** (chart/plot, screenshot, photograph, diagram, table image).
   - *Provenance:* original filename, source kind (file/paste/screenshot/import), uploader, upload time, deck + slide number (imports).
3. **Derived from annotation:** annotation count, annotation text, tools used, last annotated by/at.
4. **Contextual (inherited from the post):** title, tags, work date, author, workspace, collection or imported deck.

Processing states `pending → ready | failed` with retry; the UI shows a quiet "metadata completeness" hint (missing alt text, no caption) at publish time. *Later, flagged off by default:* auto-captions and object labels from a vision model, embeddings for "find images like this", PDF figure extraction.

## B11. API sketch (for the contract)

REST + JSON, versioned `/v1`, OpenAPI is the contract (client generated from it). Cursor pagination, consistent errors (`code`, `message`, `details`), idempotency keys on creates, per-user/org rate limits. Routes are under `/v1/orgs/{org}`; tenancy is enforced on every one.

```
Auth/identity  POST /auth/register · /login · /magic-link · /logout · GET /me · PATCH /me · /me/preferences · /me/sessions
Orgs           POST /orgs · GET /orgs/{org} · members GET/PATCH/DELETE · invites POST/GET/DELETE · /accept-invite
Workspaces     GET/POST /workspaces · PATCH/DELETE /workspaces/{ws} · members PUT/DELETE
Posts (PG)     GET /posts/{id} · POST /workspaces/{ws}/posts · PATCH/DELETE /posts/{id}
               POST /posts/{id}/publish · /unpublish · /hide · /show · /restore · GET /posts/{id}/revisions
Drafts (PG)    GET /workspaces/{ws}/drafts
Search (ES)    POST /workspaces/{ws}/search   FilterSpec → SearchResponse (hits, facets, histogram)
               GET  /workspaces/{ws}/suggest?q=   (tags, people, titles for the search bar)
Assets (PG)    POST /uploads (presign) · POST /uploads/{id}/complete · GET /assets/{id} · PATCH /image-instances/{id}
               PUT /image-instances/{id}/annotation
Comments (PG)  GET/POST /posts/{id}/comments · PATCH/DELETE /comments/{id} · POST /comments/{id}/resolve
Reactions (PG) PUT /reactions (toggle)
Inbox (PG)     GET /notifications · POST /notifications/read
Tags (PG)      GET/POST/PATCH/DELETE /tags · /tag-groups
Views (PG)     GET/POST/PATCH/DELETE /saved-views
Collections    GET/POST /collections · PUT /collections/{id}/posts
Import         POST /imports · PUT /imports/{id}/upload · GET /imports/{id} · PATCH /imports/{id}/items · POST /imports/{id}/commit · DELETE /imports/{id}
Export         POST /exports · GET /exports/{id}
Live           GET /workspaces/{ws}/events (SSE)
Admin          POST /admin/reindex · GET /admin/search-health (index lag, drift)
```

## B12. Non-functional bar

| Area | Bar |
|---|---|
| Performance | Search/feed p95 < 300 ms at ~1M posts per org; post detail p95 < 100 ms; write-to-searchable p95 < 2 s; virtualized lists |
| Security | Tenant isolation tests in CI (every endpoint, plus ES queries); validate uploads (type, size, magic bytes); ProseMirror JSON validated against a schema (no raw HTML); strict CSP; secrets in a secret manager; audit log |
| Reliability | PG backups + PITR + restore drill; ES rebuildable; outbox retries + DLQ; index-lag alerting |
| Observability | Structured logs with org/request IDs, traces, metrics (index lag, search latency, queue depth), error tracking |
| Testing | Unit + integration (real Postgres and ES via testcontainers), **contract tests (mock ≡ API)**, a Playwright flow per block |
| CI/CD | Lint, mypy/tsc, tests, migration check on fresh DB, image build |

## B13. Backend build order (after the UI)

1. **B-0 Foundations:** `docker compose` (Postgres, Elasticsearch, MinIO, API, worker), Alembic baseline, CI with testcontainers, `.env.example`.
2. **B-1 Identity & tenancy** (v1 contract): auth, orgs, workspaces, memberships, invites, RLS, user panel, cross-tenant test suite.
3. **B-2 Posts & assets** (v2): post CRUD + state machine + revisions, presigned uploads, image worker (thumbnails, EXIF, hashes, blurhash), annotations, drafts.
4. **B-3 Search** (v4): outbox + indexer, `posts`/`images` mappings, `FilterSpec → ES` translator with disjunctive facets and histogram, hydration, PIT paging, suggest, saved views, `reindex`, OCR, index-lag metrics. *Flip the UI from mock to live here, search first.*
5. **B-4 Discussion** (v3): comments (ltree), anchors, reactions, mentions, notifications, SSE; wire comment text into the post document.
6. **B-5 Import & export** (v5): temp storage + TTL, `python-pptx` worker, LibreOffice fallback renders, review/commit, provenance, exports.
7. **B-6 Hardening:** degraded search mode (optional), rate limits, malware scanning, load test at the §B12 design point, admin console, data export/delete.

---

# PART C — DECISIONS, OPEN QUESTIONS, LATER

## C1. Decisions already made

Postgres = relationships/guaranteed data; **Elasticsearch = all search and filtered browsing**; ES is derived and rebuildable · transactional outbox · hydration from Postgres with permission re-check · shared ES index routed by `org_id`, nested comments/images + separate `images` index · disjunctive facets and a date histogram that ignores its own filter · ProseMirror JSON for rich text · UUIDv7 · RLS tenancy · private-by-membership workspaces · hide vs. unpublish rule · imports land as drafts · originals not retained by default (7-day TTL) · UI-first on MSW mocks with one `FilterSpec` · UI order: foundation → v1 → v2 → v4 → v3 → v5.

## C2. Open questions (defaults in parentheses; the agent proceeds with them and logs in `docs/DECISIONS.md`)

| # | Question | Needed by |
|---|---|---|
| 1 | Auth provider: hosted vs. self-hosted; SSO at launch? *(hosted, no SSO)* | B-1 |
| 2 | Hosting model: SaaS only or self-hostable (lab data sensitivity, compliance, data residency)? *(SaaS)* | B-0 |
| 3 | Can admins see others' drafts? *(no)* | UI-2 |
| 4 | Viewers may react? *(yes)* | UI-4 |
| 5 | Confirm originals not retained by default + 7-day TTL + optional retention setting | UI-5 |
| 6 | Speaker notes on import: per-slide notes vs. text block vs. first comment *(per-slide notes)* | UI-5 |
| 7 | Public expiring presentation links without an account? *(no for now)* | UI-5 |
| 8 | ES vs. OpenSearch; managed vs. self-managed *(Elasticsearch 8, managed)* | B-3 |
| 9 | Comments nested in post doc vs. their own index *(nested, capped)* | B-3 |
| 10 | Degraded Postgres search mode when ES is down *(later)* | B-6 |
| 11 | Realistic scale for year one (users, posts, images per org; largest legacy deck) | B-2 |
| 12 | KaTeX math in v2 or later? *(v2 stretch)* | UI-2 |
| 13 | Confirm "present off the platform" = carousel without chrome + export | UI-5 |

## C3. Later (not in v1–v5)

Semantic search and "ask the log" Q&A with citations · post templates · diffs and immutable/lab-notebook mode · `[[post]]` backlinks and related posts · email-in and Slack/Teams integrations · public API and webhooks · weekly digest generation · non-image attachments (PDF, CSV, notebooks) · SSO/SAML · retention and legal hold · self-host packaging · mobile-optimized capture · workspace-defined custom image fields · vision-model captions and image similarity search.