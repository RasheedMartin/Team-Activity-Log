import { AddRounded, CloseRounded, DeleteOutlineRounded } from "@mui/icons-material";
import { Autocomplete, Box, Button, Chip, Divider, Drawer, IconButton, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import type { ImageView } from "../../api/contract";
import { useUpdateImage } from "../../api/hooks";
import { useNotify } from "../../components/notify";
import { formatDay } from "../../lib/dates";
import { errorMessage } from "../../lib/format";

const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function Fact({ k, v }: { k: string; v?: string | number | null }) {
  if (v === undefined || v === null || v === "") return null;
  return (
    <Stack direction="row" spacing={1} sx={{ py: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 110, flexShrink: 0 }}>{k}</Typography>
      <Typography variant="caption" sx={{ wordBreak: "break-word", fontFamily: k === "SHA-256" ? "monospace" : undefined }}>{v}</Typography>
    </Stack>
  );
}

/**
 * §W2.3 metadata drawer. Author-provided fields save on blur (inline, no Save button);
 * extracted fields are read-only and fill in as the worker finishes.
 */
export function ImageMetadataDrawer({ orgId, image, open, onClose, readOnly }: { orgId: string; image: ImageView | null; open: boolean; onClose: () => void; readOnly?: boolean }) {
  const update = useUpdateImage(orgId);
  const notify = useNotify();
  const [f, setF] = useState({ caption: "", altText: "", figureLabel: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [fields, setFields] = useState<[string, string][]>([]);
  useEffect(() => {
    if (!image) return;
    setF({ caption: image.caption ?? "", altText: image.altText ?? "", figureLabel: image.figureLabel ?? "" });
    setTags(image.tags);
    setFields(Object.entries(image.customFields));
  }, [image]);
  if (!image) return null;
  const a = image.asset;
  const m = a.metadata;
  const save = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch, { onError: (e) => notify(errorMessage(e)) });
  const saveField = (k: keyof typeof f) => () => f[k] !== (image[k] ?? "") && save({ id: image.id, [k]: f[k].trim() || undefined });
  const saveCustom = (next: [string, string][]) => save({ id: image.id, customFields: Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])) });

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 400 } } } }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h3" sx={{ flex: 1 }}>Image details</Typography>
        <IconButton onClick={onClose} aria-label="Close image details"><CloseRounded /></IconButton>
      </Stack>
      <Box sx={{ p: 2, overflow: "auto" }}>
        <Box component="img" src={a.variants.find((v) => v.name === "small")?.url ?? a.variants[0]?.url} alt={image.altText ?? ""} sx={{ width: "100%", aspectRatio: `${a.width} / ${a.height}`, objectFit: "contain", bgcolor: a.dominantColors[0] ?? "action.hover", borderRadius: 1, border: 1, borderColor: "divider", mb: 2 }} />
        <Typography variant="overline" color="text.secondary">You provide</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField label="Caption" value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} onBlur={saveField("caption")} multiline disabled={readOnly} />
          <TextField label="Alt text" value={f.altText} onChange={(e) => setF({ ...f, altText: e.target.value })} onBlur={saveField("altText")} multiline disabled={readOnly} helperText={!f.altText ? "Describe the image for people using screen readers" : " "} />
          <TextField label="Figure label" placeholder="Fig. 3a" value={f.figureLabel} onChange={(e) => setF({ ...f, figureLabel: e.target.value })} onBlur={saveField("figureLabel")} disabled={readOnly} />
          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={tags}
            disabled={readOnly}
            onChange={(_, v) => {
              const clean = [...new Set((v as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean))];
              setTags(clean);
              save({ id: image.id, tags: clean });
            }}
            renderValue={(value, getTagProps) => value.map((t, i) => <Chip size="small" label={t} {...getTagProps({ index: i })} key={t} />)}
            renderInput={(p) => <TextField {...p} label="Image tags" placeholder="Type and press Enter" />}
          />
          <Box>
            <Typography variant="caption" color="text.secondary">Fields (run_id, sample, instrument…)</Typography>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {fields.map(([k, v], i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <TextField size="small" placeholder="key" value={k} disabled={readOnly} onChange={(e) => setFields(fields.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} onBlur={() => saveCustom(fields)} sx={{ flex: 1 }} inputProps={{ "aria-label": "Field name" }} />
                  <TextField size="small" placeholder="value" value={v} disabled={readOnly} onChange={(e) => setFields(fields.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} onBlur={() => saveCustom(fields)} sx={{ flex: 1.4 }} inputProps={{ "aria-label": "Field value" }} />
                  {!readOnly && (
                    <IconButton size="small" aria-label="Remove field" onClick={() => { const next = fields.filter((_, j) => j !== i); setFields(next); saveCustom(next); }}>
                      <DeleteOutlineRounded fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              ))}
              {!readOnly && <Button size="small" startIcon={<AddRounded />} onClick={() => setFields([...fields, ["", ""]])} sx={{ alignSelf: "flex-start" }}>Add field</Button>}
            </Stack>
          </Box>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Typography variant="overline" color="text.secondary">Extracted {a.processing === "pending" && "· processing…"}</Typography>
        <Box sx={{ mt: 0.5 }}>
          <Fact k="Dimensions" v={`${a.width} × ${a.height} px`} />
          <Fact k="Type" v={`${a.mime}${m.detectedType ? ` · looks like a ${m.detectedType}` : ""}`} />
          <Fact k="Size" v={fmtBytes(a.bytes)} />
          <Fact k="Filename" v={a.originalFilename} />
          <Fact k="Captured" v={m.exif?.capturedAt ? formatDay(m.exif.capturedAt.slice(0, 10)) : undefined} />
          <Fact k="Camera" v={[m.exif?.cameraMake, m.exif?.cameraModel].filter(Boolean).join(" ")} />
          <Fact k="Text in image" v={m.ocrState === "pending" ? "Reading…" : m.ocrText} />
          <Fact k="Source" v={m.sourceKind} />
          <Fact k="SHA-256" v={a.sha256.slice(0, 16) + "…"} />
          {a.dominantColors.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ py: 0.25 }} alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ width: 110 }}>Colors</Typography>
              {a.dominantColors.map((c) => <Box key={c} title={c} sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: c, border: 1, borderColor: "divider" }} />)}
            </Stack>
          )}
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>GPS data is removed on upload.</Typography>
        </Box>
      </Box>
    </Drawer>
  );
}
