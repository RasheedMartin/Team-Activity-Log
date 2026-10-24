import { Box, Button, Skeleton, Stack, TextField } from "@mui/material";
import { useMemo, useState } from "react";
import { usePeople, useSearch, useTags } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { EmptyState, ErrorState } from "../../components/ui";
import { PostCard } from "../posts/PostCard";
import { OnboardingChecklist } from "./Onboarding";

// Interim feed (UI-0). Replaced by the full Find It screen in UI-3.
export function SearchPage() {
  const { org, ws, me } = useWs();
  const [q, setQ] = useState("");
  const search = useSearch(org.id, ws.id, { q });
  const { data: people } = usePeople(org.id);
  const { data: tagData } = useTags(org.id);
  const peopleById = useMemo(() => new Map(people?.map((p) => [p.id, p])), [people]);
  const tags = useMemo(() => new Map(tagData?.tags.map((t) => [t.id, t])), [tagData]);
  const hits = search.data?.pages.flatMap((p) => p.hits) ?? [];
  return (
    <Box sx={{ maxWidth: 960, width: "100%", mx: "auto", p: 2 }}>
      <TextField fullWidth placeholder="Search posts…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ mb: 2 }} />
      {!q && search.data && search.data.pages[0].total < 3 && <OnboardingChecklist hasPosts={hits.length > 0} />}
      {search.isPending ? (
        <Stack spacing={1}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} variant="rounded" height={72} />)}</Stack>
      ) : search.error ? (
        <ErrorState error={search.error} onRetry={() => search.refetch()} />
      ) : hits.length === 0 ? (
        <EmptyState title="Nothing here yet" body={`Welcome, ${me.user.name.split(" ")[0]}. Press C to write the first post.`} />
      ) : (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", opacity: search.isPlaceholderData ? 0.6 : 1 }}>
          {hits.map((h) => (
            <PostCard key={h.post.id} hit={h} href={wsPath(org, ws, `/p/${h.post.id}`)} author={peopleById.get(h.post.authorId)} tags={tags} />
          ))}
        </Box>
      )}
      {search.hasNextPage && (
        <Button fullWidth sx={{ mt: 1 }} onClick={() => search.fetchNextPage()} disabled={search.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </Box>
  );
}
