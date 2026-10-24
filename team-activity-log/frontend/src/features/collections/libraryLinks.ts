import type { LibraryItem } from "../../api/contract";
import { toSearchParams } from "../../lib/filterSpec";

/** Search params that show one collection's posts (oldest first). */
export const collectionParams = (id: string) => toSearchParams({ all: [{ field: "collection", op: "in", value: [id] }], sort: "oldest" });

/** Where a library item opens: a view as search with its filters, a notebook as the reader, a collection as filtered search. */
export function libraryHref(base: string, item: Pick<LibraryItem, "kind" | "id" | "filterSpec">): string {
  if (item.kind === "view") return `${base}/search?${toSearchParams(item.filterSpec ?? {})}&view=${item.id}`;
  if (item.kind === "notebook") return `${base}/notebooks/${item.id}`;
  return `${base}/search?${collectionParams(item.id)}`;
}
