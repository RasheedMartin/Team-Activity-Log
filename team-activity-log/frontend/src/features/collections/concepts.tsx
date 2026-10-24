import { CollectionsBookmarkOutlined, MenuBookOutlined, SavedSearchRounded } from "@mui/icons-material";
import type { ReactNode } from "react";
import type { LibraryKind } from "../../api/contract";

/**
 * The three things people save, named and drawn the same way everywhere (owner request: make
 * them obvious). API names stay as they are (`view`, saved-views, pins); only the words change.
 */
export const KINDS: Record<LibraryKind, { label: string; plural: string; icon: ReactNode; blurb: string }> = {
  view: { label: "Saved search", plural: "Saved searches", icon: <SavedSearchRounded />, blurb: "A search you rerun. New posts that match show up on their own." },
  collection: { label: "Collection", plural: "Collections", icon: <CollectionsBookmarkOutlined />, blurb: "Posts you picked by hand." },
  notebook: { label: "Notebook", plural: "Notebooks", icon: <MenuBookOutlined />, blurb: "Posts in an order, read start to finish." },
};

/** Rail entries carry this id so a new favorite can be pointed out where it landed. */
export const favoriteDomId = (kind: LibraryKind, id: string) => `fav-${kind}-${id}`;
