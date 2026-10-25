# Pricing (proposal — owner to confirm)

Status: **draft**, with the Free member limit decided (10). Limits are enforced by the backend (`backend/src/tal/plans.py`); billing (upgrading a plan) is not built yet. The landing page reads
`frontend/src/app/pricing.ts`; the backend enforces limits from `backend/src/tal/plans.py`.
Keep the two in sync (later: the landing page fetches plans from `GET /v1/plans`).

## What we charge for

- **Value metric: active members (seats).** The product gets more valuable with every teammate
  who posts and searches. It's what buyers expect from team tools (Notion, Linear, Slack).
- **Guardrail: storage.** Images and imported decks are the real cost (object storage, the search
  index, OCR). Storage is pooled per org and grows with seats, so it rarely bites, but it caps abuse.
- **Never limited: search history.** "Find it months later" is the product. A free plan that
  forgets old posts would undercut the pitch.

## Plans

| | **Free** | **Team** | **Business** | **Enterprise** |
|---|---|---|---|---|
| Price | $0 | **$8** /member/mo yearly ($10 monthly) | **$16** /member/mo yearly ($20 monthly) | Custom |
| Members | up to 10 | unlimited | unlimited | unlimited |
| Workspaces | 1 | unlimited | unlimited | unlimited |
| Storage (pooled) | 2 GB | 10 GB / member | 25 GB / member | custom |
| Import slides | 5 decks / month | unlimited | unlimited | unlimited |
| Search, notebooks, present | ✓ | ✓ | ✓ | ✓ |
| Private workspaces | — | ✓ | ✓ | ✓ |
| Guests (read/comment only) | — | ✓ | ✓ | ✓ |
| SSO (SAML / OIDC), SCIM | — | — | ✓ | ✓ |
| Audit log, retention controls | — | — | ✓ | ✓ |
| Support | community | email | priority | dedicated + SLA |
| Hosting | cloud | cloud | cloud | cloud, region pinning, or self-hosted |

**Academic & nonprofit:** 50% off Team and Business for universities, national labs, and
registered nonprofits. Research groups are the first market; this removes the budget objection.

**Trial (built):** Team free for 14 days on every new org (`TRIAL_DAYS`), no card needed. Then it falls
back to Free: nothing is deleted; Free limits block adding more until they upgrade.

## Billing rules

- Billable member = active membership in the billing period (invited-not-accepted and deactivated
  members are free). Viewers count as members on Team; guests are free.
- Yearly billing is prorated when seats are added; removals take effect at renewal.
- Downgrades never delete data. Over a limit → new uploads/imports are blocked with a clear message.

## Data the backend keeps (already in the schema)

- `organizations.plan` (`free | team | business | enterprise`), `organizations.billing_status`,
  `organizations.trial_ends_at`, `organizations.billing_customer_id` (payment provider id),
  `organizations.storage_quota_bytes` (override; null = derive from plan × seats).
- Entitlements are code (`plans.py`), not rows, so changing a plan is a deploy, not a migration.
- Payment provider: **[OPEN]** Stripe Billing is the default assumption (per-seat prices, customer
  portal, webhooks → `billing_status`).

## Enforcement (built)

Checked where usage grows, never by deleting or hiding anything: an org over a limit keeps
reading and writing text.

| Limit | Checked when | Counts |
|---|---|---|
| Members | sending invites; accepting an invite or join link | active members + pending invites |
| Workspaces / private workspaces | creating, unarchiving, making private | open (not archived) workspaces |
| Storage | storing a new image (upload, deck import) | original bytes, each image once per org |
| Imports per month | starting and committing an import | imports committed this calendar month (abandoned or deleted imports don't count) |

Admins see a Plan & usage tab (Organization admin). New orgs start on `NEW_ORG_PLAN` (default
Free); no grandfathering. Demo scenarios load as Team.

## Open questions

1. Are viewers billable? (Proposed: yes on Team; free read-only *guests* cover outside collaborators.)
2. Per-seat vs flat per-lab pricing for academia (some PIs prefer one fixed annual invoice).

## Billing (built)

Stripe, over its HTTPS API (`tal/billing.py`); off until `STRIPE_*` settings exist (setup steps in
`backend/README.md` → Free trial and billing).

- **Upgrade:** Organization admin → Organization → Upgrade (Team or Business, monthly or yearly) opens
  Stripe Checkout; seats = active members.
- **Manage:** "Manage billing" opens Stripe's portal (plan, card, invoices, cancel).
- **State comes from Stripe's signed webhook** (`POST /v1/billing/webhook`, HMAC-verified, 5-minute replay
  window): active/trialing → that price's plan; past_due → keeps the plan, shows a warning; canceled/unpaid
  → Free. Handlers set state, so redelivery is harmless.
- **Seats follow membership:** after a member joins or is removed (and the change is saved), the
  subscription quantity is updated with prorations.
- **Not built yet:** Guests, SSO/SCIM, audit log (the pricing page marks them coming soon); invoices for
  Enterprise (contact sales); academic discount codes (Stripe promotion codes work in Checkout).
