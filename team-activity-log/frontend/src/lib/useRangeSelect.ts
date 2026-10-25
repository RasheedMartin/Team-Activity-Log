import { useRef } from "react";

/**
 * Click to toggle one; Shift-click to set everything between the last click and this one to the
 * same state (like a file manager). `ids` is the on-screen order; `selectable` filters out rows
 * that can't be picked (e.g. already added).
 */
export function useRangeSelect(ids: string[], selected: Set<string>, setSelected: (s: Set<string>) => void, selectable: (id: string) => boolean = () => true) {
  const anchor = useRef<string | null>(null);
  return (id: string, shift: boolean) => {
    const on = !selected.has(id);
    const next = new Set(selected);
    const a = anchor.current ? ids.indexOf(anchor.current) : -1;
    const b = ids.indexOf(id);
    const range = shift && a >= 0 && b >= 0 ? ids.slice(Math.min(a, b), Math.max(a, b) + 1) : [id];
    for (const x of range) {
      if (!selectable(x)) continue;
      if (on) next.add(x);
      else next.delete(x);
    }
    anchor.current = id;
    setSelected(next);
  };
}
