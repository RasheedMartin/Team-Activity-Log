# Team Activity Log

A searchable lab notebook for teams. People post what they did, found, or decided (text,
images, tables, and annotated figures), then find it again by full-text and boolean search,
facets, and dates. Slide decks import as editable posts, and any set of posts can be arranged
into a notebook or presented as slides.

> "Team Activity Log" is a working name. The brand lives in `frontend/src/app/brand.ts`.

## What it does

- **Posts.** A rich-text editor (TipTap) with images, tables, slide breaks, and text color,
  highlight, and alignment. Draw on images: arrows, shapes, text, highlighter. Posts have a work
  date, tags, and co-authors, and stay drafts until published.
- **Search.** Boolean queries (`AND`, `OR`, `NOT`, parentheses, `field:value`), faceted filters, a
  date histogram, an image gallery, and saved searches. Search reads image captions, annotation
  text, and comments as well as post text.
- **Import slides.** Drop in a `.pptx`. Slides whose layout matters stay **designed slides**: text
  boxes, shapes, pictures, and the template, positioned as in PowerPoint. Text-only slides become
  post text that keeps its formatting (colors, highlight, lists, links, headings). Charts come in
  as tables of their data. You review and publish; nothing publishes on its own.
- **Designed slides.** Lay out a slide right in a post: move and resize, edit text in place, and
  add shapes, pictures, and charts (drawn from an editable data table). Slide text and chart data
  are searchable like any post text.
- **Present and download.** Present any post, selection, or notebook full-screen, in a theme of
  your choice (or the imported deck's own look), and download it as a real PowerPoint file with
  editable text, tables, native charts, and presenter notes.
- **Explore, collections, and notebooks.** Browse by tag. A collection is posts you pick; a
  notebook is posts in reading order. Present any post, selection, or notebook full-screen.
- **Discussion.** Threaded comments, @mentions, questions with accepted answers, reactions, and
  live updates.
- **Teams.** Organizations, workspaces (including private ones), roles, invites and join links,
  Google sign-in, email verification, and plan limits.
- **Works on laptop and phone.** Every page is built and tested at both sizes.

The words the product uses (saved search, collection, notebook, favorites, and so on) are
defined in [docs/CONCEPTS.md](team-activity-log/docs/CONCEPTS.md).

## How it's built

| Part | Stack |
|---|---|
| Frontend | React 19, TypeScript, MUI 7, TipTap 3, TanStack Query, React Router 7, Vite |
| Backend | FastAPI, SQLAlchemy 2 (async), Alembic, Python 3.11+ |
| Data | **Postgres** is the source of truth. **Elasticsearch 8** holds search, rebuilt from Postgres whenever needed. Images are stored in Postgres or an S3-compatible bucket. |
| Tests | Vitest (unit), pytest (backend), Playwright (end to end, run against both the mock and the real API) |
| Hosting | Railway: a single Docker service serves the built UI and the `/v1` API from one origin |

The frontend talks to one API contract
([frontend/src/api/contract.ts](team-activity-log/frontend/src/api/contract.ts)). It runs in two
modes:

- **Mock:** an in-browser mock server (MSW and IndexedDB). No backend needed; good for UI work and
  demos.
- **Live:** the real FastAPI backend.

Both modes implement the same contract, so the UI doesn't change between them.

## Repository layout

```
team-activity-log/
├── frontend/          React app, mock API (src/mock), E2E tests (e2e/)
│   └── scripts/       test-deck and mock-asset generators
├── backend/           FastAPI app (src/tal), migrations, tests, the `tal` CLI
│   └── src/app/       the original prototype API (legacy, not used by the app)
├── docs/              CONCEPTS (glossary), DECISIONS (design log), PRICING, AUDIT
├── Dockerfile         builds the UI and serves it from the API
└── railway.toml       Railway start command and health check
```

## Run it

### Frontend only (mock mode)

Needs Node 20+.

```bash
cd team-activity-log/frontend
npm install
npm run dev            # http://localhost:5173
```

Open `/dev` to load a demo scenario (an empty org, a small team, a busy 5,000-post org, and
others) and sign in as any persona.

### With the real backend

Needs Python 3.11+, Postgres 14+, and Elasticsearch 8. Set up the backend first, following
[backend/README.md](team-activity-log/backend/README.md): fill in `.env`, then run
`tal check`, `tal migrate` and `tal serve`. Then start the frontend in live mode:

```bash
cd team-activity-log/frontend
npm run dev:live       # proxies /v1 to localhost:8000
```

The backend README also covers:
- S3 image storage;
- email delivery (Resend or Postmark);
- Google sign-in;
- rebuilding search;
- running Postgres and Elasticsearch locally.

## Test

```bash
cd team-activity-log/frontend
npm run typecheck && npm run lint && npm test     # types, lint, unit tests
npx playwright test                               # end to end, mock mode
E2E_API=live npx playwright test                  # end to end, real API (needs local Postgres + Elasticsearch)

cd ../backend
.venv/bin/pytest                                  # backend tests (uses a tal_test database)
```

## Deploy

Merging to `main` deploys to Railway automatically. On start, the service runs
`tal migrate && tal serve`, and Railway checks `/v1/health`. For service setup and the
environment variables to set, see
[backend/README.md → Deploy on Railway](team-activity-log/backend/README.md#deploy-on-railway).

## Design notes

- [docs/DECISIONS.md](team-activity-log/docs/DECISIONS.md): why things work the way they do
  (navigation, import rules, slides, search).
- [docs/PRICING.md](team-activity-log/docs/PRICING.md): plans and how each limit is enforced.
- [docs/CONCEPTS.md](team-activity-log/docs/CONCEPTS.md): user-facing terms, and the help pages
  still to write.
