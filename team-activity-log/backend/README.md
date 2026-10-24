# Team Activity Log API

FastAPI over **Postgres** (the system of record) and **Elasticsearch** (search, rebuildable from
Postgres at any time). It implements the same `/v1` contract the frontend's mock server does
(`frontend/src/api/contract.ts`), so the UI runs against either without code changes.

## Plug in your Postgres and Elasticsearch

You need Python 3.11+, a Postgres 14+ database, and an Elasticsearch 8.x cluster. No Postgres
extensions or other services are required: images are stored in Postgres by default.

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env        # then fill in the two blocks below
```

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
ELASTICSEARCH_URL=https://HOST:443          # or ELASTICSEARCH_CLOUD_ID=...
ELASTICSEARCH_API_KEY=...                   # or ELASTICSEARCH_USERNAME / ELASTICSEARCH_PASSWORD
```

Then:

```bash
.venv/bin/tal check          # both connections, versions, schema and index status
.venv/bin/tal migrate        # create the Postgres schema
.venv/bin/tal init-search    # create the search index (the server also does this on start)
.venv/bin/tal serve          # http://localhost:8000/v1  (OpenAPI docs at /v1/docs)
```

`tal check` tells you exactly what's missing, for example:

```
Postgres       ok   version 16.2; schema at 0001
Elasticsearch  ok   version 8.15.3; index ready
Environment    production; dev mode off; index prefix 'tal'
```

### Point the frontend at it

```bash
cd frontend
VITE_API_MODE=live npm run dev       # /v1 is proxied to localhost:8000 (VITE_API_PROXY to change)
```

In production, either serve the built UI from the API (`FRONTEND_DIST=../frontend/dist`, same
origin, simplest) or put both behind one reverse proxy that routes `/v1` to the API. Sessions are
httpOnly cookies, so keep the UI and `/v1` on one origin.

## Deploy on Railway

One service runs everything users touch: the `Dockerfile` in `team-activity-log/` builds the
React app in live mode and serves it from the API, so the app and `/v1` share one origin.
Postgres, Elasticsearch, and the bucket are separate Railway services you already have.

| Service | Start command | Settings |
|---|---|---|
| Postgres | Railway default (leave empty) | |
| Elasticsearch | Railway default | |
| Bucket | n/a | |
| **App (this repo)** | from `railway.toml`: `tal migrate && tal serve --port $PORT` | Root Directory = `team-activity-log` |

Railway auto-deploys from the repo's `main` branch: changes go live when they are merged to `main`.

1. **New service → GitHub repo** (branch `main`), then in its Settings set **Root Directory** to `team-activity-log`.
   Railway picks up `railway.toml` and the `Dockerfile` there. (`backend/railway.toml` belongs to
   the old prototype and is not used by this service.)
2. **Variables** on the app service, using Railway references so traffic stays on the private network:

   ```dotenv
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ELASTICSEARCH_URL=http://${{Elasticsearch.RAILWAY_PRIVATE_DOMAIN}}:9200
   ELASTICSEARCH_USERNAME=<reference the Elasticsearch service's username variable>
   ELASTICSEARCH_PASSWORD=<reference the Elasticsearch service's password variable>
   STORAGE=s3
   S3_ENDPOINT=<bucket endpoint>          # references to the bucket service's credentials
   S3_BUCKET=<bucket name>
   S3_ACCESS_KEY_ID=<access key>
   S3_SECRET_ACCESS_KEY=<secret key>
   S3_REGION=auto
   ENV=production
   DEV_MODE=false
   PUBLIC_APP_URL=https://<your app domain>
   ```

   No `TAL_ENV_FILE` here: `.env.railway` is only for running commands from your laptop.
3. **Networking → Generate Domain** on the app service. That URL is the app.
4. Deploy. Each start runs migrations first (safe to repeat), then serves on Railway's `$PORT`.
   Railway waits for `/v1/health`; `/v1/health/ready` shows both data stores and the search index lag.
5. Optional, once the app is live: remove the public TCP proxies on Postgres and Elasticsearch.
   The app only needs the private network. Keep them if you want to run `tal` from your laptop.

The first person to register creates the first organization. There is no demo data in
production (`DEV_MODE=false`), and scenario loading is refused unless `DEV_ALLOW_RESET=true`.

## How it fits together

| Concern | Where |
|---|---|
| Accounts, orgs, workspaces, posts, comments, tags, saved searches, collections, favorites, imports | Postgres (`src/tal/models.py`, migrations in `src/tal/migrations`) |
| Search, facets, histogram, gallery, Explore | Elasticsearch (`src/tal/search/`) |
| Keeping search current | Every write adds an **outbox** row in the same transaction; the indexer drains it (in-process by default, or `tal worker`) |
| Live updates (new comments, reactions) | Server-sent events over Postgres `LISTEN/NOTIFY` (works with many API processes) |
| Images | Postgres (`asset_blobs`), deduplicated per org by SHA-256, resized variants |
| Slide import | `src/tal/pptx.py` (stdlib only), same rules as the mock parser, tested on the same deck |

If Elasticsearch is down, search returns a clear 503 and everything else keeps working; writes
queue in the outbox and catch up. `GET /v1/health/ready` reports both stores and the index lag.

### Rebuilding search

Postgres is the truth, so search can always be rebuilt:

```bash
tal reindex                      # refresh everything in place
tal reindex --org <org-id>       # one tenant
tal reindex --new-version 2      # build tal_posts_v2 and swap the alias (zero downtime; use after mapping changes)
```

## Development

Local Postgres and Elasticsearch live in `.devservices/` (git-ignored):

```bash
# Postgres 16 on :5433 (data in .devservices/pg-data)
$(cat .devservices/pgbin.path)/pg_ctl -D .devservices/pg-data -o "-p 5433 -k /tmp" -l .devservices/pg.log start
# Elasticsearch 8.15 on :9200, security off (dev only)
.devservices/elasticsearch-8.15.3/bin/elasticsearch -E discovery.type=single-node -E xpack.security.enabled=false \
  -E path.data=$PWD/.devservices/es-data -E path.logs=$PWD/.devservices/es-logs
```

With `DEV_MODE=true`, the frontend's `/dev` page loads the same demo scenarios as mock mode
(persona sign-in, the busy 5,000-post org, …) into Postgres and Elasticsearch.

```bash
.venv/bin/pytest                                 # unit tests (parser, query language, translator, …)
cd ../frontend && E2E_API=live npx playwright test   # the whole UI suite against this API
```

The live E2E run uses its own database (`tal_e2e`) and index prefix (`tal_e2e`), so it never
touches your dev data.

## Not yet

- OCR for uploaded images (`ocrState: "none"` until an OCR worker is added).
- S3-compatible object storage as an alternative to Postgres for image bytes.
- Postgres row-level security as a second tenancy guard (tenancy is enforced in every query today).
- Sending real email (messages are written to the `emails` table and shown on `/dev`).
- Billing (plans are in the schema; see `docs/PRICING.md`).
