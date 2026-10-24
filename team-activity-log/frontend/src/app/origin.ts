import { useLocation } from "react-router-dom";

/**
 * Where a post was opened from, carried in router state so the post's back button can say
 * "Back to <place>" and return there (scroll position is restored by ScrollRestoration).
 */
export interface Origin {
  from: string;
  label: string;
}

export function useOrigin(label: string): Origin {
  const loc = useLocation();
  return { from: loc.pathname + loc.search + loc.hash, label };
}
