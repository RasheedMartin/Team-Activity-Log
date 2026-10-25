import { ArrowBackRounded, CallMergeRounded, CallSplitRounded, CheckCircleRounded, ErrorOutlineRounded, UploadFileOutlined, WarningAmberRounded } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
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
import { Link as RouterLink, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { deckHref, importHome } from "../collections/libraryLinks";
import type { ImportFileKind, ImportItem, ImportJob, ImportMode, ImportSummary, SlideDesignMode } from "../../api/contract";
import { useImportAction, useImportJob, useLibrary, useMyImports, useStartImport } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { TagPicker } from "../../components/Pickers";
import { EmptyState, PageHeader } from "../../components/ui";
import { formatDay, timeAgo, todayISO } from "../../lib/dates";
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

// Documents (owner request): PDF and Word become notebooks, with their own ways to split.
const DOC_MODES: Record<"pdf" | "docx" | "any", { id: ImportMode; title: string; body: string }[]> = {
  pdf: [
    { id: "per_slide", title: "A page per PDF page", body: "Each page keeps its layout as a picture; its text is searchable." },
    { id: "whole_deck", title: "One page for the whole PDF", body: "Best for short documents." },
    { id: "by_section", title: "A page per bookmark section", body: "Uses the PDF's bookmarks, when it has them." },
  ],
  docx: [
    { id: "per_slide", title: "A page per section", body: "Each top-level heading starts a new notebook page." },
    { id: "whole_deck", title: "One page for the whole document", body: "Best for short documents." },
  ],
  // Before a file is chosen on Import a document.
  any: [
    { id: "per_slide", title: "A page per page or section", body: "PDF: each page. Word: each top-level heading." },
    { id: "whole_deck", title: "One page for the whole document", body: "Best for short documents." },
  ],
};
const kindOfFile = (name: string): ImportFileKind | undefined => (/\.pptx$/i.test(name) ? "pptx" : /\.pdf$/i.test(name) ? "pdf" : /\.docx$/i.test(name) ? "docx" : undefined);
const baseName = (name: string) => name.replace(/\.(pptx|pdf|docx)$/i, "");

const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const slideRange = (s: number[]) => (s.length === 1 ? `${s[0]}` : `${s[0]}–${s[s.length - 1]}`);

/** What one unit of the file is called: slides, PDF pages, or Word sections. */
const UNIT: Record<ImportFileKind, { one: string; many: string }> = { pptx: { one: "slide", many: "slides" }, pdf: { one: "page", many: "pages" }, docx: { one: "section", many: "sections" } };

type ImportFor = "slides" | "document" | "any";
const ACCEPT: Record<ImportFor, string> = {
  slides: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
  document: ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  any: ".pptx,.pdf,.docx,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function StartStep({ onStarted, scope, onScope }: { onStarted: (job: ImportJob) => void; scope: ImportFor; onScope: (s: ImportFor) => void }) {
  const { org, ws, me } = useWs();
  const start = useStartImport(org.id, ws.id);
  // A deck dropped elsewhere in the app arrives in router state.
  const dropped = (useLocation().state as { file?: File } | null)?.file ?? null;
  const [file, setFile] = useState<File | null>(dropped);
  const [mode, setMode] = useState<ImportMode>("per_slide");
  const [slideDesign, setSlideDesign] = useState<SlideDesignMode>("auto");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [guessDates, setGuessDates] = useState(true);
  const [baseDate, setBaseDate] = useState(todayISO());
  const [collectionName, setCollectionName] = useState(dropped ? baseName(dropped.name) : "");
  const [drag, setDrag] = useState(false);
  const kind = file ? kindOfFile(file.name) : undefined;
  // Words follow where the import started until a file says otherwise (owner request).
  const isDoc = kind ? kind !== "pptx" : scope === "document";
  const modes = kind === "pdf" || kind === "docx" ? DOC_MODES[kind] : isDoc ? DOC_MODES.any : MODES;
  const into = isDoc ? "notebook" : "deck";
  // Extend an existing deck/notebook (owner request): yours, or shared with you.
  const [params] = useSearchParams();
  const [intoId, setInto] = useState<string | null>(params.get("into"));
  const lib = useLibrary(org.id, ws.id, { kind: into === "deck" ? "collection" : "notebook", sort: "name", limit: 200 });
  const intoOptions = (lib.data?.pages.flatMap((pg) => pg.items) ?? []).filter((it) => it.ownerId === me.user.id || it.sharedWithMe || it.id === intoId);
  const pick = (f?: File | null) => {
    if (!f) return;
    setFile(f);
    setMode("per_slide");
    setCollectionName(baseName(f.name));
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
            <Typography variant="body2" color="text.secondary">
              {kind ? `${fmtBytes(file.size)} · becomes a ${into}` : "This kind of file can't be imported yet"} · click to choose a different file
            </Typography>
          </>
        ) : (
          <>
            <Typography sx={{ fontWeight: 600 }}>{scope === "slides" ? "Drop a PowerPoint file here, or click to choose" : scope === "document" ? "Drop a PDF or Word file here, or click to choose" : "Drop a file here, or click to choose"}</Typography>
            <Typography variant="body2" color="text.secondary">
              {scope === "slides" ? ".pptx (PowerPoint 2007 or newer) · becomes a deck" : scope === "document" ? ".pdf or .docx · becomes a notebook" : "PowerPoint (.pptx) becomes a deck · PDF or Word (.docx) becomes a notebook"}
            </Typography>
          </>
        )}
        <input hidden type="file" accept={ACCEPT[scope]} onChange={(e) => pick(e.target.files?.[0])} aria-label="File to import" />
      </ButtonBase>

      {file && kind && scope !== "any" && (scope === "slides") !== (kind === "pptx") && (
        // Strict (owner request): each section imports its own kind of file.
        <Alert severity="warning" action={<Button size="small" color="inherit" onClick={() => (onScope(scope === "slides" ? "document" : "slides"), setInto(null))}>{scope === "slides" ? "Import a document" : "Import slides"}</Button>}>
          {scope === "slides" ? "Import slides takes PowerPoint (.pptx) files. A PDF or Word file goes into a notebook: use Import a document." : "Import a document takes PDF or Word (.docx) files. A PowerPoint file becomes a deck: use Import slides."}
        </Alert>
      )}
      <Box>
        <Typography variant="h4" sx={{ mb: 1 }}>{into === "deck" ? "How should slides become posts?" : "How should the document become pages?"}</Typography>
        <Box role="radiogroup" aria-label="Import mode" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
          {modes.map((m) => (
            <ButtonBase key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)} sx={{ display: "block", textAlign: "left", p: 2, border: 2, borderColor: mode === m.id ? "primary.main" : "divider", borderRadius: 1.5, bgcolor: "background.paper" }}>
              <Typography sx={{ fontWeight: 600 }}>{m.title}</Typography>
              <Typography variant="body2" color="text.secondary">{m.body}</Typography>
            </ButtonBase>
          ))}
        </Box>
      </Box>

      {into === "deck" && (
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
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h4" sx={{ mb: 1.5 }}>Defaults</Typography>
        <Stack spacing={2}>
          <TagPicker orgId={org.id} value={tagIds} onChange={setTagIds} label="Tags for every imported post" />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Work date</Typography>
            <RadioGroup value={guessDates ? "guess" : "fixed"} onChange={(e) => setGuessDates(e.target.value === "guess")}>
              <FormControlLabel value="guess" control={<Radio size="small" />} label="Guess from the file's text; otherwise use the date below" />
              <FormControlLabel value="fixed" control={<Radio size="small" />} label="Use the date below for every post" />
            </RadioGroup>
            <TextField type="date" size="small" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} label="Date" sx={{ mt: 0.5 }} />
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Add to</Typography>
            <RadioGroup value={intoId ? "existing" : "new"} onChange={(e) => (e.target.value === "new" ? setInto(null) : setInto(intoOptions[0]?.id ?? ""))}>
              <FormControlLabel value="new" control={<Radio size="small" />} label={`A new ${into}`} />
              <FormControlLabel value="existing" control={<Radio size="small" />} disabled={!intoOptions.length} label={`An existing ${into}${intoOptions.length ? "" : ` (you have none yet)`}`} />
            </RadioGroup>
            {intoId !== null ? (
              <TextField select size="small" label={into === "deck" ? "Deck" : "Notebook"} value={intoId} onChange={(e) => setInto(e.target.value)} sx={{ minWidth: 280, mt: 0.5 }}>
                {intoOptions.map((o) => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
              </TextField>
            ) : (
              <TextField label={into === "deck" ? "Deck name" : "Notebook name"} value={collectionName} onChange={(e) => setCollectionName(e.target.value)} helperText={into === "deck" ? "The slides are grouped in this deck" : "The pages go into this notebook"} sx={{ mt: 0.5 }} fullWidth />
            )}
          </Box>
        </Stack>
      </Paper>
      <Typography variant="caption" color="text.secondary">
        The original file is kept with the {into}, so anyone who can see it can download it. Images are stored once and reused if they already exist.
      </Typography>
      {start.error && <Alert severity="error">{errorMessage(start.error)}</Alert>}
      <Box>
        <Button
          variant="contained"
          size="large"
          disabled={!file || !kind || start.isPending || (scope !== "any" && (scope === "slides") !== (kind === "pptx")) || intoId === ""}
          onClick={() => file && start.mutate({ file, mode, defaults: { tagIds, baseDate, guessDates, collectionName: collectionName || file.name, slideDesign, ...(intoId ? { intoId } : {}) } }, { onSuccess: onStarted })}
        >
          Start import
        </Button>
      </Box>
    </Stack>
  );
}

/** One source of truth per deck (owner request): this exact file was imported here before. */
function DuplicateNotice({ job }: { job: ImportJob }) {
  const { org, ws } = useWs();
  const [dismissed, setDismissed] = useState(false);
  const d = job.duplicateOf;
  if (!d || dismissed) return null;
  const who = d.by === "you" ? "You" : d.by;
  const when = formatDay(d.at.slice(0, 10));
  const text = d.collectionId
    ? `${who} already imported this deck on ${when}.`
    : d.private
      ? `${who} already imported this deck on ${when} and kept it to themselves. Ask them to share it.`
      : `${who} imported this deck on ${when} and is still reviewing it. Ask them to publish or share it.`;
  return (
    <Alert
      severity="info"
      sx={{ width: "100%" }}
      action={
        <Stack direction="row" spacing={1}>
          {d.collectionId && <Button size="small" variant="contained" component={RouterLink} to={deckHref(wsPath(org, ws), d.collectionId)}>Open the deck</Button>}
          <Button size="small" color="inherit" onClick={() => setDismissed(true)}>Import a copy anyway</Button>
        </Stack>
      }
    >
      {text}
    </Alert>
  );
}

function ReviewStep({ job }: { job: ImportJob }) {
  const { org } = useWs();
  const u = UNIT[job.defaults.fileKind ?? "pptx"];
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
  // Owner request: imported decks are the workspace's source of truth, so shared by default.
  const [shareDeck, setShareDeck] = useState(true);
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
      i.slideNumbers.forEach((n, k) => out.push({ ...i, id: uuidv7(), slideNumbers: [n], proposedTitle: k === 0 ? i.proposedTitle : `${i.proposedTitle} (${u.one} ${n})`, imageCount: k === 0 ? i.imageCount : 0, warnings: k === 0 ? i.warnings : [] }));
    }
    change(out);
    setSel(new Set());
  };
  const canMerge = selected.length > 1;
  const canSplit = selected.some((i) => i.slideNumbers.length > 1);

  return (
    <Stack spacing={2}>
      <DuplicateNotice job={job} />
      <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Typography sx={{ fontWeight: 600 }}>
          {included.length} {included.length === 1 ? "post" : "posts"} from {job.slideCount} {u.many}
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
          <Button size="small" startIcon={<CallSplitRounded />} disabled={!canSplit} onClick={split}>Split into {u.many}</Button>
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
              <TableCell>{{ pptx: "Slides", pdf: "Pages", docx: "Sections" }[job.defaults.fileKind ?? "pptx"]}</TableCell>
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
                  <Checkbox size="small" checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} inputProps={{ "aria-label": `Select ${u.many} ${slideRange(i.slideNumbers)}` }} />
                </TableCell>
                <TableCell>
                  <Checkbox size="small" checked={i.included} onChange={(e) => setItem(i.id, { included: e.target.checked })} inputProps={{ "aria-label": `Include ${u.many} ${slideRange(i.slideNumbers)}` }} />
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
                    inputProps={{ "aria-label": `Title for ${u.many} ${slideRange(i.slideNumbers)}` }}
                  />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <TextField
                      variant="standard"
                      type="date"
                      value={i.proposedDate}
                      onChange={(e) => setItem(i.id, { proposedDate: e.target.value, dateSource: "user" })}
                      inputProps={{ "aria-label": `Date for ${u.many} ${slideRange(i.slideNumbers)}` }}
                      sx={{ width: 140, "& input": { color: i.dateSource !== "user" ? "warning.main" : undefined } }}
                    />
                    {i.dateSource !== "user" && (
                      <Tooltip title={i.dateSource === "guessed" ? `Guessed from the ${u.one} text` : "No date found; used the default"}>
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
            act.mutateAsync({ action: "items", items }).then(() => act.mutate({ action: "commit", visibility: shareDeck ? "workspace" : "people" }, { onSuccess: (j) => notify(`Created ${j?.report?.created ?? included.length} drafts from “${job.sourceFilename}”. Review them here.`), onError: (e) => notify(errorMessage(e)) }));
          }}
        >
          Create {included.length} {included.length === 1 ? "draft" : "drafts"}
        </Button>
        <Typography variant="body2" color="text.secondary">Everything is created as drafts in “{job.defaults.collectionName}”. Nothing is published yet.</Typography>
      </Stack>
      <FormControlLabel
        control={<Checkbox checked={shareDeck} onChange={(e) => setShareDeck(e.target.checked)} />}
        label={shareDeck ? "Share this deck with the workspace (people find it instead of importing it again)" : "Keep this deck to myself (you can share it later)"}
      />
    </Stack>
  );
}

/** Drafts are created: the deck is where they're reviewed (owner request), so go there. */
function DoneStep({ job, onNew }: { job: ImportJob; onNew: () => void }) {
  const { org, ws } = useWs();
  if (job.collectionId) return <Navigate replace to={importHome(wsPath(org, ws), job.collectionId, job.defaults.fileKind, true)} />;
  return (
    <Stack spacing={2} alignItems="flex-start">
      <Alert icon={<CheckCircleRounded />} severity="success">Created {job.report?.created ?? 0} drafts from “{job.sourceFilename}”. Find them in Activity → Drafts.</Alert>
      <Button onClick={onNew}>Import another file</Button>
    </Stack>
  );
}

/** Where each recent import got to, unfinished ones first: one click goes back into it. */
function YourImports({ onOpen }: { onOpen: (id: string) => void }) {
  const { org, ws } = useWs();
  const navigate = useNavigate();
  const list = useMyImports(org.id, ws.id).data ?? [];
  if (!list.length) return null;
  const state = (i: ImportSummary): { label: string; open: boolean } =>
    i.status === "review"
      ? { label: "Ready to review: nothing created yet", open: true }
      : i.status !== "done"
        ? { label: "Processing", open: true }
        : i.drafts > 0
          ? { label: `${i.published} of ${i.published + i.drafts} published · ${i.drafts} left to review`, open: true }
          : { label: i.published ? `All ${i.published} published` : "Everything discarded", open: false };
  const sorted = [...list].sort((a, b) => Number(state(b).open) - Number(state(a).open));
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1 }}>Your imports</Typography>
      <Paper variant="outlined">
        <List disablePadding aria-label="Your imports">
          {sorted.map((i, k) => {
            const st = state(i);
            return (
              <ListItem key={i.id} disablePadding divider={k < sorted.length - 1}>
                <ListItemButton onClick={() => (i.status === "done" && i.collectionId ? navigate(importHome(wsPath(org, ws), i.collectionId, i.fileKind, i.drafts > 0)) : onOpen(i.id))}>
                  <ListItemText
                    primary={i.sourceFilename}
                    secondary={
                      <Box component="span" sx={{ display: "flex", flexWrap: "wrap", columnGap: 1.5 }}>
                        <Box component="span" sx={{ color: st.open ? "warning.main" : "text.secondary", fontWeight: st.open ? 600 : 400 }}>{st.label}</Box>
                        <span>{i.slideCount ? `${i.slideCount} ${UNIT[i.fileKind ?? "pptx"].many} · ` : ""}{timeAgo(i.createdAt)}</span>
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Paper>
    </Box>
  );
}

/** §W5.3 import wizard. The job ID lives in the URL so the wizard resumes after a reload. */
export default function ImportPage() {
  const { org, ws, role } = useWs();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job") ?? undefined;
  const job = useImportJob(org.id, jobId);
  const steps = ["Upload", "Processing", "Review", "Done"];
  const step = !jobId ? 0 : !job.data ? 1 : job.data.status === "review" ? 2 : job.data.status === "done" ? 3 : 1;
  // Where the import started (owner decision): Decks → slides, Notebooks → documents; a dropped
  // file (or no hint) takes either. A running import knows its own kind.
  const known = job.data?.defaults.fileKind;
  const scope: ImportFor = known ? (known === "pptx" ? "slides" : "document") : params.get("for") === "slides" ? "slides" : params.get("for") === "document" ? "document" : "any";
  const home = scope === "document" ? { to: "/notebooks", label: "Notebooks" } : { to: "/collections", label: "Decks" };
  if (!can(role, "member")) return <EmptyState title="Importing needs member access" />;
  return (
    <Box sx={{ maxWidth: 1100, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      {/* Back to Decks (owner request); leaving mid-import is safe: Your imports brings it back. */}
      <Button size="small" startIcon={<ArrowBackRounded />} component={RouterLink} to={wsPath(org, ws, home.to)} sx={{ color: "text.secondary", ml: -0.5, mb: 1 }}>
        {home.label}
      </Button>
      <PageHeader
        title={scope === "slides" ? "Import slides" : scope === "document" ? "Import a document" : "Import a file"}
        sub={scope === "slides" ? "Every slide becomes a searchable post in a deck. Nothing is published until you say so." : scope === "document" ? "Each page or section becomes a searchable notebook page. Nothing is published until you say so." : "Slides become a deck; PDF and Word documents become a notebook. Nothing is published until you say so."}
      />
      <Stepper activeStep={step} sx={{ mb: 3, maxWidth: 640 }}>
        {steps.map((s) => (
          <Step key={s}>
            <StepLabel>{s}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {step === 0 && (
        <Stack spacing={4}>
          <StartStep onStarted={(j) => setParams({ job: j.id })} scope={scope} onScope={(sc) => setParams(sc === "any" ? {} : { for: sc }, { replace: true })} />
          <YourImports onOpen={(id) => setParams({ job: id })} />
        </Stack>
      )}
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
              {job.data && <DuplicateNotice job={job.data} />}
              <Typography sx={{ fontWeight: 600 }}>{job.data?.sourceFilename ?? "Uploading…"}</Typography>
              <LinearProgress variant={job.data ? "determinate" : "indeterminate"} value={(job.data?.progress ?? 0) * 100} />
              <Typography variant="body2" color="text.secondary">
                {job.data?.status === "uploading" ? "Uploading…" : `Reading ${UNIT[job.data?.defaults.fileKind ?? "pptx"].many}, extracting images and text… ${Math.round((job.data?.progress ?? 0) * 100)}%`}
                {job.data && ` · ${job.data.slideCount} ${UNIT[job.data.defaults.fileKind ?? "pptx"].many} · ${fmtBytes(job.data.sourceBytes)}`}
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
