import { CallMergeRounded, CallSplitRounded, CheckCircleRounded, DownloadRounded, ErrorOutlineRounded, SearchRounded, UploadFileOutlined, WarningAmberRounded } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { ImportItem, ImportJob, ImportMode, SlideDesignMode } from "../../api/contract";
import { useImportAction, useImportJob, useStartImport } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { TagPicker } from "../../components/Pickers";
import { EmptyState, PageHeader } from "../../components/ui";
import { todayISO } from "../../lib/dates";
import { toSearchParams } from "../../lib/filterSpec";
import { errorMessage } from "../../lib/format";
import { uuidv7 } from "../../lib/ids";

const DESIGNS: { id: SlideDesignMode; title: string; body: string }[] = [
  { id: "auto", title: "Automatic", body: "Slides with pictures, shapes, or columns keep their design. Text slides become post text." },
  { id: "slides", title: "Keep the design", body: "Every slide looks like it does in PowerPoint." },
  { id: "text", title: "Text only", body: "Every slide becomes post text and images." },
];

const MODES: { id: ImportMode; title: string; body: string }[] = [
  { id: "per_slide", title: "One post per slide", body: "Best for dated lab logs where each slide is an entry." },
  { id: "whole_deck", title: "One post for the deck", body: "Best for talks. Slides become sections you can present." },
  { id: "by_section", title: "Group by section", body: "Slides under the same section header become one post." },
];

const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const slideRange = (s: number[]) => (s.length === 1 ? `${s[0]}` : `${s[0]}–${s[s.length - 1]}`);

function StartStep({ onStarted }: { onStarted: (job: ImportJob) => void }) {
  const { org, ws } = useWs();
  const start = useStartImport(org.id, ws.id);
  // A deck dropped elsewhere in the app arrives in router state.
  const dropped = (useLocation().state as { file?: File } | null)?.file ?? null;
  const [file, setFile] = useState<File | null>(dropped);
  const [mode, setMode] = useState<ImportMode>("per_slide");
  const [slideDesign, setSlideDesign] = useState<SlideDesignMode>("auto");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [guessDates, setGuessDates] = useState(true);
  const [baseDate, setBaseDate] = useState(todayISO());
  const [collectionName, setCollectionName] = useState(dropped?.name.replace(/\.pptx$/i, "") ?? "");
  const [drag, setDrag] = useState(false);
  const pick = (f?: File | null) => {
    if (!f) return;
    setFile(f);
    setCollectionName(f.name.replace(/\.pptx$/i, ""));
  };
  return (
    <Stack spacing={3}>
      <ButtonBase
        component="label"
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files[0]);
        }}
        sx={{ display: "flex", flexDirection: "column", gap: 1, p: 4, border: 2, borderStyle: "dashed", borderColor: drag ? "primary.main" : "divider", borderRadius: 2, bgcolor: drag ? "action.hover" : "background.paper", cursor: "pointer" }}
      >
        <UploadFileOutlined sx={{ fontSize: 36, color: "text.secondary" }} />
        {file ? (
          <>
            <Typography sx={{ fontWeight: 600 }}>{file.name}</Typography>
            <Typography variant="body2" color="text.secondary">{fmtBytes(file.size)} · click to choose a different file</Typography>
          </>
        ) : (
          <>
            <Typography sx={{ fontWeight: 600 }}>Drop a PowerPoint file here, or click to choose</Typography>
            <Typography variant="body2" color="text.secondary">.pptx (PowerPoint 2007 or newer)</Typography>
          </>
        )}
        <input hidden type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(e) => pick(e.target.files?.[0])} aria-label="PowerPoint file" />
      </ButtonBase>

      <Box>
        <Typography variant="h4" sx={{ mb: 1 }}>How should slides become posts?</Typography>
        <Box role="radiogroup" aria-label="Import mode" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
          {MODES.map((m) => (
            <ButtonBase key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)} sx={{ display: "block", textAlign: "left", p: 2, border: 2, borderColor: mode === m.id ? "primary.main" : "divider", borderRadius: 1.5, bgcolor: "background.paper" }}>
              <Typography sx={{ fontWeight: 600 }}>{m.title}</Typography>
              <Typography variant="body2" color="text.secondary">{m.body}</Typography>
            </ButtonBase>
          ))}
        </Box>
      </Box>

      <Box>
        <Typography variant="h4" sx={{ mb: 1 }}>Keep the slide design?</Typography>
        <Box role="radiogroup" aria-label="Slide design" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
          {DESIGNS.map((m) => (
            <ButtonBase key={m.id} role="radio" aria-checked={slideDesign === m.id} onClick={() => setSlideDesign(m.id)} sx={{ display: "block", textAlign: "left", p: 2, border: 2, borderColor: slideDesign === m.id ? "primary.main" : "divider", borderRadius: 1.5, bgcolor: "background.paper" }}>
              <Typography sx={{ fontWeight: 600 }}>{m.title}</Typography>
              <Typography variant="body2" color="text.secondary">{m.body}</Typography>
            </ButtonBase>
          ))}
        </Box>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h4" sx={{ mb: 1.5 }}>Defaults</Typography>
        <Stack spacing={2}>
          <TagPicker orgId={org.id} value={tagIds} onChange={setTagIds} label="Tags for every imported post" />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Work date</Typography>
            <RadioGroup value={guessDates ? "guess" : "fixed"} onChange={(e) => setGuessDates(e.target.value === "guess")}>
              <FormControlLabel value="guess" control={<Radio size="small" />} label="Guess from slide text; otherwise use the date below" />
              <FormControlLabel value="fixed" control={<Radio size="small" />} label="Use the date below for every post" />
            </RadioGroup>
            <TextField type="date" size="small" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} label="Date" sx={{ mt: 0.5 }} />
          </Box>
          <TextField label="Collection name" value={collectionName} onChange={(e) => setCollectionName(e.target.value)} helperText="Imported posts are grouped in this collection" />
        </Stack>
      </Paper>
      <Typography variant="caption" color="text.secondary">
        The original file is deleted once the import is committed (kept at most 7 days). Images are stored once and reused if they already exist.
      </Typography>
      {start.error && <Alert severity="error">{errorMessage(start.error)}</Alert>}
      <Box>
        <Button
          variant="contained"
          size="large"
          disabled={!file || start.isPending}
          onClick={() => file && start.mutate({ file, mode, defaults: { tagIds, baseDate, guessDates, collectionName: collectionName || file.name, slideDesign } }, { onSuccess: onStarted })}
        >
          Start import
        </Button>
      </Box>
    </Stack>
  );
}

function ReviewStep({ job }: { job: ImportJob }) {
  const { org } = useWs();
  const act = useImportAction(org.id, job.id);
  const notify = useNotify();
  const [items, setItems] = useState<ImportItem[]>(job.items);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setItems(job.items), [job.items]);
  // Edits save shortly after they stop (no Save button).
  const change = (next: ImportItem[]) => {
    setItems(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => act.mutate({ action: "items", items: next }), 400);
  };
  const setItem = (id: string, patch: Partial<ImportItem>) => change(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const included = items.filter((i) => i.included);
  const warnings = items.reduce((n, i) => n + i.warnings.length, 0);
  const guessed = items.filter((i) => i.dateSource !== "user").length;
  const selected = items.filter((i) => sel.has(i.id));
  const allSel = sel.size === items.length && items.length > 0;

  const merge = () => {
    const idx = items.map((i, k) => (sel.has(i.id) ? k : -1)).filter((k) => k >= 0);
    const first = items[idx[0]];
    const mergedItem: ImportItem = {
      ...first,
      id: uuidv7(),
      slideNumbers: idx.flatMap((k) => items[k].slideNumbers),
      imageCount: idx.reduce((n, k) => n + items[k].imageCount, 0),
      warnings: idx.flatMap((k) => items[k].warnings),
      included: true,
    };
    change([...items.slice(0, idx[0]), mergedItem, ...items.filter((_, k) => k > idx[0] && !idx.includes(k))]);
    setSel(new Set([mergedItem.id]));
  };
  const split = () => {
    const out: ImportItem[] = [];
    for (const i of items) {
      if (!sel.has(i.id) || i.slideNumbers.length < 2) {
        out.push(i);
        continue;
      }
      i.slideNumbers.forEach((n, k) => out.push({ ...i, id: uuidv7(), slideNumbers: [n], proposedTitle: k === 0 ? i.proposedTitle : `${i.proposedTitle} (slide ${n})`, imageCount: k === 0 ? i.imageCount : 0, warnings: k === 0 ? i.warnings : [] }));
    }
    change(out);
    setSel(new Set());
  };
  const canMerge = selected.length > 1;
  const canSplit = selected.some((i) => i.slideNumbers.length > 1);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Typography sx={{ fontWeight: 600 }}>
          {included.length} {included.length === 1 ? "post" : "posts"} from {job.slideCount} slides
        </Typography>
        {warnings > 0 && <Chip size="small" icon={<WarningAmberRounded />} label={`${warnings} warnings`} variant="outlined" color="warning" />}
        {guessed > 0 && <Chip size="small" label={`${guessed} dates guessed`} variant="outlined" />}
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={job.mode} onChange={(_, m) => m && act.mutate({ action: "mode", mode: m })} aria-label="Import mode">
          {MODES.map((m) => <ToggleButton key={m.id} value={m.id} sx={{ textTransform: "none" }}>{m.title}</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>

      {sel.size > 0 && (
        <Paper variant="outlined" sx={{ px: 1.5, py: 1, display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>{sel.size} selected</Typography>
          <Button size="small" startIcon={<CallMergeRounded />} disabled={!canMerge} onClick={merge}>Merge</Button>
          <Button size="small" startIcon={<CallSplitRounded />} disabled={!canSplit} onClick={split}>Split into slides</Button>
          <Button size="small" onClick={() => change(items.map((i) => (sel.has(i.id) ? { ...i, included: true } : i)))}>Include</Button>
          <Button size="small" onClick={() => change(items.map((i) => (sel.has(i.id) ? { ...i, included: false } : i)))}>Skip</Button>
          <TextField type="date" size="small" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} label="Set date" sx={{ width: 160 }} />
          <Button size="small" disabled={!bulkDate} onClick={() => change(items.map((i) => (sel.has(i.id) ? { ...i, proposedDate: bulkDate, dateSource: "user" } : i)))}>Apply date</Button>
        </Paper>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "60vh" }}>
        <Table size="small" stickyHeader aria-label="Posts to create">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" checked={allSel} indeterminate={sel.size > 0 && !allSel} onChange={() => setSel(allSel ? new Set() : new Set(items.map((i) => i.id)))} inputProps={{ "aria-label": "Select all" }} />
              </TableCell>
              <TableCell>Include</TableCell>
              <TableCell>Slides</TableCell>
              <TableCell sx={{ minWidth: 260 }}>Title</TableCell>
              <TableCell>Work date</TableCell>
              <TableCell align="right">Images</TableCell>
              <TableCell>Warnings</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id} hover selected={sel.has(i.id)} sx={{ opacity: i.included ? 1 : 0.5 }}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} inputProps={{ "aria-label": `Select slides ${slideRange(i.slideNumbers)}` }} />
                </TableCell>
                <TableCell>
                  <Checkbox size="small" checked={i.included} onChange={(e) => setItem(i.id, { included: e.target.checked })} inputProps={{ "aria-label": `Include slides ${slideRange(i.slideNumbers)}` }} />
                </TableCell>
                <TableCell sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{slideRange(i.slideNumbers)}</TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={i.proposedTitle}
                    placeholder={`Slide ${i.slideNumbers[0]} (no title)`}
                    onChange={(e) => setItem(i.id, { proposedTitle: e.target.value })}
                    error={!i.proposedTitle && i.included}
                    inputProps={{ "aria-label": `Title for slides ${slideRange(i.slideNumbers)}` }}
                  />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <TextField
                      variant="standard"
                      type="date"
                      value={i.proposedDate}
                      onChange={(e) => setItem(i.id, { proposedDate: e.target.value, dateSource: "user" })}
                      inputProps={{ "aria-label": `Date for slides ${slideRange(i.slideNumbers)}` }}
                      sx={{ width: 140, "& input": { color: i.dateSource !== "user" ? "warning.main" : undefined } }}
                    />
                    {i.dateSource !== "user" && (
                      <Tooltip title={i.dateSource === "guessed" ? "Guessed from the slide text" : "No date found; used the default"}>
                        <Chip size="small" label={i.dateSource === "guessed" ? "guessed" : "default"} variant="outlined" color="warning" sx={{ height: 18, fontSize: "0.65rem" }} />
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">{i.imageCount}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                    {i.warnings.map((w, k) => <Chip key={k} size="small" label={w} variant="outlined" sx={{ height: 20, fontSize: "0.68rem" }} />)}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          variant="contained"
          size="large"
          disabled={!included.length || act.isPending}
          onClick={() => {
            clearTimeout(saveTimer.current);
            act.mutateAsync({ action: "items", items }).then(() => act.mutate({ action: "commit" }, { onError: (e) => notify(errorMessage(e)) }));
          }}
        >
          Create {included.length} {included.length === 1 ? "draft" : "drafts"}
        </Button>
        <Typography variant="body2" color="text.secondary">Everything is created as drafts in “{job.defaults.collectionName}”. Nothing is published yet.</Typography>
      </Stack>
    </Stack>
  );
}

function DoneStep({ job, onNew }: { job: ImportJob; onNew: () => void }) {
  const { org, ws } = useWs();
  const act = useImportAction(org.id, job.id);
  const notify = useNotify();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [published, setPublished] = useState(false);
  const r = job.report;
  const downloadReport = () => {
    const lines = [
      `Import report: ${job.sourceFilename}`,
      `Mode: ${MODES.find((m) => m.id === job.mode)?.title}`,
      `Created: ${r?.created ?? 0} drafts · Skipped: ${r?.skipped ?? 0} · Warnings: ${r?.warnings ?? 0}`,
      "",
      ...job.items.map((i) => `${i.included ? "✓" : "–"} slides ${slideRange(i.slideNumbers)}\t${i.proposedTitle || "(untitled)"}\t${i.proposedDate}${i.dateSource !== "user" ? " (" + i.dateSource + ")" : ""}${i.warnings.length ? "\t⚠ " + i.warnings.join("; ") : ""}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${job.sourceFilename.replace(/\.pptx$/i, "")}-import-report.txt` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const collectionUrl = job.collectionId ? `${wsPath(org, ws, "/search")}?${toSearchParams({ all: [{ field: "collection", op: "in", value: [job.collectionId] }], sort: "oldest" })}` : wsPath(org, ws);
  return (
    <Stack spacing={2} alignItems="flex-start">
      <Alert icon={<CheckCircleRounded />} severity="success">
        Created {r?.created ?? 0} drafts from “{job.sourceFilename}”{r?.skipped ? `, skipped ${r.skipped}` : ""}{r?.warnings ? `, with ${r.warnings} warnings to review` : ""}.
      </Alert>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Button variant="contained" disabled={published || act.isPending} onClick={() => act.mutate({ action: "publishAll" }, { onSuccess: () => (setPublished(true), notify("All imported drafts published")) })}>
          {published ? "Published" : "Publish all"}
        </Button>
        <Button component={RouterLink} to={wsPath(org, ws, "/activity/drafts")}>Review drafts</Button>
        {published && <Button component={RouterLink} to={collectionUrl} startIcon={<SearchRounded />}>Search these slides</Button>}
        <Button startIcon={<DownloadRounded />} onClick={downloadReport}>Download report</Button>
        <Button onClick={onNew}>Import more slides</Button>
        <Button color="error" onClick={() => setConfirm(true)}>Delete this import</Button>
      </Stack>
      <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs">
        <DialogTitle>Delete this import?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">This removes all {r?.created ?? 0} posts it created (published or not) and their collection. Images no other post uses are cleaned up later.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => act.mutate({ action: "delete" }, { onSuccess: () => (setConfirm(false), notify("Import deleted"), navigate(wsPath(org, ws, "/import"))) })}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** §W5.3 import wizard. The job ID lives in the URL so the wizard resumes after a reload. */
export default function ImportPage() {
  const { org, role } = useWs();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job") ?? undefined;
  const job = useImportJob(org.id, jobId);
  const steps = ["Upload", "Processing", "Review", "Done"];
  const step = !jobId ? 0 : !job.data ? 1 : job.data.status === "review" ? 2 : job.data.status === "done" ? 3 : 1;
  if (!can(role, "member")) return <EmptyState title="Importing needs member access" />;
  return (
    <Box sx={{ maxWidth: 1100, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <PageHeader title="Import slides" sub="Every slide becomes a searchable post. Nothing is published until you say so." />
      <Stepper activeStep={step} sx={{ mb: 3, maxWidth: 640 }}>
        {steps.map((s) => (
          <Step key={s}>
            <StepLabel>{s}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {step === 0 && <StartStep onStarted={(j) => setParams({ job: j.id })} />}
      {step === 1 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          {job.data?.status === "failed" ? (
            <Stack spacing={2} alignItems="flex-start">
              <Alert severity="error" icon={<ErrorOutlineRounded />}>{job.data.error ?? "The import failed."}</Alert>
              <Button variant="contained" onClick={() => setParams({})}>Try another file</Button>
            </Stack>
          ) : job.error ? (
            <Stack spacing={2} alignItems="flex-start">
              <Alert severity="error">{errorMessage(job.error)}</Alert>
              <Button onClick={() => setParams({})}>Start over</Button>
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              <Typography sx={{ fontWeight: 600 }}>{job.data?.sourceFilename ?? "Uploading…"}</Typography>
              <LinearProgress variant={job.data ? "determinate" : "indeterminate"} value={(job.data?.progress ?? 0) * 100} />
              <Typography variant="body2" color="text.secondary">
                {job.data?.status === "uploading" ? "Uploading…" : `Reading slides, extracting images and text… ${Math.round((job.data?.progress ?? 0) * 100)}%`}
                {job.data && ` · ${job.data.slideCount} slides · ${fmtBytes(job.data.sourceBytes)}`}
              </Typography>
              <Typography variant="caption" color="text.disabled">You can leave this page; the import keeps going and this link brings you back.</Typography>
            </Stack>
          )}
        </Paper>
      )}
      {step === 2 && job.data && <ReviewStep job={job.data} />}
      {step === 3 && job.data && <DoneStep job={job.data} onNew={() => setParams({})} />}
    </Box>
  );
}
