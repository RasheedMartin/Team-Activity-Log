import { Typography } from "@mui/material";
import type { ImageView, Post } from "../../api/contract";

// Placeholder until UI-4 (v3 Talk About It) lands the full threaded discussion.
export function ThreadView({ post }: { post: Post; images: ImageView[] }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {post.counts.comments} comment{post.counts.comments === 1 ? "" : "s"}. Threaded discussion arrives in milestone UI-4.
    </Typography>
  );
}
