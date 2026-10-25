import { DeleteOutlineRounded, ImageOutlined, SlideshowRounded } from "@mui/icons-material";
import { Box, Button, Checkbox, IconButton, Link, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type { DraftSummary } from "../../api/contract";
import { usePostAction } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";

/** Why a draft couldn't publish, in the words the publish checklist uses ("Add a title"). */
function publishProblem(e: unknown): string {
  const details = e instanceof ApiError ? (e.details as { problems?: string[] } | undefined) : undefined;
  return details?.problems?.join(", ") || errorMessage(e);
}

interface Props {
  drafts: DraftSummary[];
  /** Hide "From deck.pptx" on each row (the import's own page already says it). */
  hideSource?: boolean;
}

/**
 * Drafts with selection: pick some (or Select all) and publish or discard them together. Drafts
 * that can't publish yet stay selected, each with the reason, so they're easy to fix and retry.
 */
export function DraftList({ drafts, hideSource }: Props) {
  const { org, ws } = useWs();
  const action = usePostAction(org.id);
  const notify = useNotify();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const ids = useMemo(() => drafts.map((d) => d.id), [drafts]);
  const chosen = ids.filter((id) => selected.has(id)); // drafts that left the list drop out of the selection
  const all = chosen.length === ids.length && ids.length > 0;
  const some = chosen.length > 0 && !all;
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  const publish = async () => {
    setBusy(true);
    const results = await Promise.allSettled(chosen.map((id) => action.mutateAsync({ id, action: "publish" })));
    const failed: Record<string, string> = {};
    results.forEach((r, i) => r.status === "rejected" && (failed[chosen[i]] = publishProblem(r.reason)));
    const done = chosen.length - Object.keys(failed).length;
    setProblems(failed);
    setSelected(new Set(Object.keys(failed)));
    setBusy(false);
    const n = Object.keys(failed).length;
    notify(n ? `Published ${done}. ${n} need${n === 1 ? "s" : ""} attention before publishing.` : `Published ${done} post${done === 1 ? "" : "s"}`);
  };
  const discard = async () => {
    const gone = [...chosen];
    setBusy(true);
    await Promise.allSettled(gone.map((id) => action.mutateAsync({ id, action: "delete" })));
    setSelected(new Set());
    setBusy(false);
    notify(`Discarded ${gone.length} draft${gone.length === 1 ? "" : "s"}`, () => gone.forEach((id) => action.mutate({ id, action: "restore" })));
  };

  return (
    <Paper variant="outlined">
      <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", flexWrap: "wrap", minHeight: 48 }}>
        <Checkbox
          checked={all}
          indeterminate={some}
          onChange={() => setSelected(all ? new Set() : new Set(ids))}
          inputProps={{ "aria-label": all ? "Deselect all drafts" : "Select all drafts" }}
          size="small"
        />
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 120 }}>
          {chosen.length ? `${chosen.length} selected` : `${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}
        </Typography>
        {chosen.length > 0 && (
          <>
            <Button size="small" variant="contained" disabled={busy} onClick={() => void publish()}>
              Publish {chosen.length}
            </Button>
            <Button size="small" color="error" disabled={busy} onClick={() => void discard()}>
              Discard
            </Button>
          </>
        )}
      </Stack>
      <List disablePadding aria-label="Drafts">
        {drafts.map((d, i) => (
          <ListItem
            key={d.id}
            disablePadding
            divider={i < drafts.length - 1}
            secondaryAction={
              <Tooltip title="Discard draft">
                <IconButton
                  edge="end"
                  onClick={() => action.mutate({ id: d.id, action: "delete" }, { onSuccess: () => notify(`Discarded “${d.title || "Untitled"}”`, () => action.mutate({ id: d.id, action: "restore" })) })}
                  aria-label={`Discard ${d.title || "untitled draft"}`}
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            }
          >
            <ListItemIcon sx={{ minWidth: 0, pl: 1 }}>
              <Checkbox edge="start" size="small" checked={selected.has(d.id)} onChange={() => toggle(d.id)} inputProps={{ "aria-label": `Select ${d.title || "untitled draft"}` }} />
            </ListItemIcon>
            <ListItemButton onClick={() => navigate(wsPath(org, ws, `/p/${d.id}/edit`))} sx={{ pl: 1 }}>
              <ListItemText
                primary={d.title || <Typography component="span" color="text.disabled">Untitled</Typography>}
                secondary={
                  <Box component="span" sx={{ display: "flex", flexWrap: "wrap", columnGap: 1.5, rowGap: 0.25, alignItems: "center" }}>
                    {d.source && !hideSource && (
                      <Stack direction="row" spacing={0.5} component="span" alignItems="center">
                        <SlideshowRounded sx={{ fontSize: 14 }} />
                        <span>
                          {d.source.fileName} · slide {d.source.slide}
                        </span>
                      </Stack>
                    )}
                    {hideSource && d.source && <span>Slide {d.source.slide}</span>}
                    <span>Edited {timeAgo(d.updatedAt)}</span>
                    {d.imageCount > 0 && (
                      <Stack direction="row" spacing={0.25} component="span" alignItems="center">
                        <ImageOutlined sx={{ fontSize: 14 }} />
                        <span>{d.imageCount}</span>
                      </Stack>
                    )}
                    {problems[d.id] && (
                      <Box component="span" sx={{ color: "error.main" }}>
                        Can't publish yet: {problems[d.id]}
                      </Box>
                    )}
                  </Box>
                }
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      {!hideSource && drafts.some((d) => d.source) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 1, borderTop: 1, borderColor: "divider" }}>
          Imported drafts:{" "}
          {[...new Map(drafts.filter((d) => d.source).map((d) => [d.source!.importJobId, d.source!.fileName])).entries()].map(([job, file], i) => (
            <span key={job}>
              {i > 0 && " · "}
              <Link component={RouterLink} to={`${wsPath(org, ws, "/import")}?job=${job}`}>
                {file}
              </Link>
            </span>
          ))}
        </Typography>
      )}
    </Paper>
  );
}
