import { MenuBookOutlined, SavedSearchRounded, SlideshowOutlined } from "@mui/icons-material";
import type { ReactNode } from "react";
import type { LibraryKind } from "../../api/contract";

/**
 * The three things people save, named and drawn the same way everywhere (owner request: make
 * them obvious). API names stay as they are (`view`, saved-views, pins); only the words change.
 */
export const KINDS: Record<LibraryKind, { label: string; plural: string; icon: ReactNode; blurb: string }> = {
  view: { label: "Saved search", plural: "Saved searches", icon: <SavedSearchRounded />, blurb: "A search you rerun. New posts that match show up on their own." },
  // "collection" in the API: since the owner's decision, only imported slide decks.
  collection: { label: "Deck", plural: "Decks", icon: <SlideshowOutlined />, blurb: "Imported slide decks: one shared copy of each, reviewed and presented here." },
  notebook: { label: "Notebook", plural: "Notebooks", icon: <MenuBookOutlined />, blurb: "Posts in an order: write pages, pull posts in, follow a tag, present, share." },
};

/** Rail entries carry this id so a new favorite can be pointed out where it landed. */
export const favoriteDomId = (kind: LibraryKind, id: string) => `fav-${kind}-${id}`;
