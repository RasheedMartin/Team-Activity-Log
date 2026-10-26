import type { LibraryItem } from "../../api/contract";
import { toSearchParams } from "../../lib/filterSpec";

/** Search params that show one collection's posts (oldest first). */
export const collectionParams = (id: string) => toSearchParams({ all: [{ field: "collection", op: "in", value: [id] }], sort: "oldest" });

/** Where a library item opens: a view as search with its filters, a notebook as the reader, a
 *  collection (an imported deck, or posts picked by hand) as its own page. */
export function libraryHref(base: string, item: Pick<LibraryItem, "kind" | "id" | "filterSpec">): string {
  if (item.kind === "view") return `${base}/search?${toSearchParams(item.filterSpec ?? {})}&view=${item.id}`;
  if (item.kind === "notebook") return `${base}/notebooks/${item.id}`;
  return `${base}/collections/${item.id}`;
}

/** An imported deck's page, where its slides are reviewed; `review` opens on the drafts left. */
export const deckHref = (base: string, collectionId: string, review = false) => `${base}/collections/${collectionId}${review ? "?show=review" : ""}`;

/** Where an import's posts live: a deck for slides, a notebook for documents. */
export const importHome = (base: string, collectionId: string, fileKind?: string, review = false) =>
  fileKind === "pdf" || fileKind === "docx" ? `${base}/notebooks/${collectionId}` : deckHref(base, collectionId, review);
