# Concepts (user-facing glossary)

The words the product uses, one meaning each. Help pages, tooltips, onboarding, and the
landing page should use these words and no others. The UI's source of truth for names,
icons, and one-line definitions is `frontend/src/features/collections/concepts.tsx`.

| Term | What it is | How you make one | Icon |
|---|---|---|---|
| **Post** | One write-up: text, images, tables, tags. A draft until published. | New post (C), or Import slides | — |
| **Saved search** | A search you rerun. New posts that match show up on their own. Relative dates stay relative. | Search → Save search | saved-search |
| **Collection** | Posts you picked by hand. No reading order. An import makes one per deck. | Search → Select → New collection | collections-bookmark |
| **Notebook** | Posts in an order, read start to finish (one entry at a time, or continuous for print). | Search → Select → New notebook, or Home → a tag → Create notebook | menu-book |
| **Favorites** | Your starred saved searches, collections, and notebooks, shown in the left sidebar. Personal. | The star on any of them | star |
| **Library** | Every saved search, collection, and notebook in the workspace. | — | library |
| **Activity** | What's yours to deal with: mentions & replies, your drafts, and (admins) the recycle bin. | — | bell |
| **Recycle bin** | Deleted posts (kept 30 days) and hidden posts, with Restore. Admins only. | Delete or hide a post | — |
| **Import slides** | Turn a PowerPoint deck into posts: slide text with its formatting (colors, highlight, lists, links), speaker notes, tables, charts (as their data), images, in the slide's reading order. Nothing publishes until you say so. | Rail button, or drop a .pptx anywhere | slideshow |

Internal names differ on purpose and stay stable for the backend contract: a saved search is a
`SavedView` (`/saved-views`), a favorite is a pin (`/pins`), a notebook is a `Collection` with
`kind: "notebook"`.

## Documentation still needed (owner note)

The concepts above were unclear in use, which says in-product words alone aren't enough. To write:

1. **Help center basics**: one short page per concept above, with a screenshot.
2. **"Saved search vs collection vs notebook"**: a single comparison page; link it from the
   Library tabs and the save/create dialogs.
3. **Getting started**: write a post, import slides, search, star a favorite (the onboarding
   checklist should link here).
4. **Search syntax**: AND / OR / NOT, quotes, fields like `tag:`; the in-app syntax help is the
   short version.
5. **Import slides guide**: the three modes, how dates are guessed, what isn't carried over
   (animations, transitions, charts), and the 7-day file retention.
6. **Admin guide**: workspaces, roles, invites, recycle bin and hiding.
7. **Keyboard shortcuts**: one page, matching the in-app list.

Where it lives is open (in-app `/help` route vs. an external docs site). Until then this file
is the reference.
