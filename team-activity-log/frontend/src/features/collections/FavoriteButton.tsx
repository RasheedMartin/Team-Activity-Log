import { StarBorderRounded, StarRounded } from "@mui/icons-material";
import { IconButton, Tooltip } from "@mui/material";
import type { LibraryKind } from "../../api/contract";
import { usePins, useTogglePin } from "../../api/hooks";
import { useWs } from "../../app/session";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";
import { favoriteDomId } from "./concepts";

/**
 * Star a saved search, collection, or notebook into the sidebar's Favorites (per person; the API
 * calls these pins). Says where it went, and briefly highlights it there.
 */
export function FavoriteButton({ kind, id, name, size = "medium" }: { kind: LibraryKind; id: string; name: string; size?: "small" | "medium" }) {
  const { org, ws, me } = useWs();
  const { data: pins = [] } = usePins(org.id, ws.id);
  const toggle = useTogglePin(org.id, ws.id);
  const notify = useNotify();
  const on = pins.some((p) => p.kind === kind && p.id === id);
  const click = () =>
    toggle.mutate(
      { item: { kind, id, name, ownerId: me.user.id, shared: false, pinned: on, updatedAt: new Date().toISOString() }, pinned: !on },
      {
        onSuccess: () => {
          notify(on ? `Removed “${name}” from Favorites` : `Added “${name}” to Favorites in the sidebar`);
          if (!on) requestAnimationFrame(() => document.getElementById(favoriteDomId(kind, id))?.animate?.([{ backgroundColor: "rgba(52,81,209,0.22)" }, { backgroundColor: "transparent" }], { duration: 1800, easing: "ease-out" }));
        },
        onError: (e) => notify(errorMessage(e)),
      },
    );
  return (
    <Tooltip title={on ? "Remove from Favorites" : "Add to Favorites (left sidebar)"}>
      <IconButton
        size={size}
        aria-label={on ? `Remove ${name} from Favorites` : `Add ${name} to Favorites`}
        aria-pressed={on}
        onClick={(e) => (e.stopPropagation(), e.preventDefault(), click())}
        sx={{ color: on ? "primary.main" : "text.disabled" }}
      >
        {on ? <StarRounded fontSize="small" /> : <StarBorderRounded fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
