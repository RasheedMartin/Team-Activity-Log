import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { can, useWs, wsPath } from "./session";

// §A4 keyboard-first. Global keys live here; list keys (j/k/Enter/Space) live with the list.
// Cross-component actions go through window events so nothing needs prop drilling.

export const APP_EVENTS = {
  palette: "tal:palette",
  focusSearch: "tal:focus-search",
  toggleFilters: "tal:toggle-filters",
} as const;
export const fire = (name: string) => window.dispatchEvent(new Event(name));

export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=dialog] input, .ProseMirror");
}

export function useShortcuts() {
  const { me, org, ws, role } = useWs();
  const navigate = useNavigate();
  const enabled = me.preferences.shortcuts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        fire(APP_EVENTS.palette);
        return;
      }
      if (!enabled || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector(".MuiModal-root:not(.MuiPopover-root):not(.peek-drawer)")) return; // a dialog owns the keyboard
      if (e.key === "c" && can(role, "member") && !ws.archived) {
        e.preventDefault();
        navigate(wsPath(org, ws, "/new"));
      } else if (e.key === "/") {
        e.preventDefault();
        if (!/\/w\/[^/]+(\/search)?$/.test(location.pathname)) navigate(wsPath(org, ws));
        setTimeout(() => fire(APP_EVENTS.focusSearch), 0);
      } else if (e.key === "[") {
        fire(APP_EVENTS.toggleFilters);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, navigate, org, ws, role]);
}

export function useAppEvent(name: string, handler: () => void) {
  useEffect(() => {
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  }, [name, handler]);
}
