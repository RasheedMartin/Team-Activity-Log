import type { Comment, ID, ImageView } from "../../api/contract";

/** Number anchored comments per image in creation order: pin 1, 2, 3… (§W3.3). */
export function pinNumbers(comments: Comment[], images: ImageView[]) {
  const byImage = new Map<ID, number>();
  const out = new Map<ID, { n: number; image?: ImageView }>();
  [...comments]
    .filter((c) => c.anchor && !c.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((c) => {
      const id = c.anchor!.imageInstanceId;
      const n = (byImage.get(id) ?? 0) + 1;
      byImage.set(id, n);
      out.set(c.id, { n, image: images.find((i) => i.id === id) });
    });
  return out;
}

/** Scroll an element into view and briefly highlight it. */
export function flashElement(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  el.animate?.([{ backgroundColor: "rgba(52,81,209,0.18)" }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
}
