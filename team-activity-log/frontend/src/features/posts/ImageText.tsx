import { EditOutlined } from "@mui/icons-material";
import { Box, Button, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import type { Asset, ID } from "../../api/contract";
import { useCorrectOcr } from "../../api/hooks";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";

const ENGINE: Record<string, string> = { tesseract: "Read by the built-in engine", google: "Read by Google Cloud Vision", azure: "Read by Azure AI Vision", aws: "Read by AWS Textract", person: "Corrected by a person", mock: "Sample text (mock mode doesn't read images)", textLayer: "Text from the PDF" };

/** "Text in this image": what OCR read (search uses it), with a way to correct it. */
export function ImageText({ orgId, asset, readOnly }: { orgId: ID; asset: Asset; readOnly: boolean }) {
  const m = asset.metadata;
  const correct = useCorrectOcr(orgId);
  const notify = useNotify();
  const [draft, setDraft] = useState<string | null>(null);
  const [shown, setShown] = useState<string | undefined>(m.ocrText); // updates at once after a correction
  const text = draft === null ? (correct.isSuccess ? shown : m.ocrText) : draft;
  const reading = m.ocrState === "pending" || m.ocrState === "running";

  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Text in this image</Typography>
        {!readOnly && draft === null && !reading && (
          <Button size="small" startIcon={<EditOutlined />} onClick={() => setDraft(text ?? "")}>
            {text ? "Correct" : "Add text"}
          </Button>
        )}
      </Stack>
      {draft !== null ? (
        <Stack spacing={1}>
          <TextField multiline minRows={3} maxRows={12} value={draft} onChange={(e) => setDraft(e.target.value)} inputProps={{ "aria-label": "Text in this image" }} autoFocus />
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              disabled={correct.isPending}
              onClick={() =>
                correct.mutate(
                  { assetId: asset.id, text: draft },
                  { onSuccess: (r) => (setShown(r.ocrText), setDraft(null), notify("Saved. Search uses the corrected text.")), onError: (e) => notify(errorMessage(e)) },
                )
              }
            >
              Save
            </Button>
            <Button size="small" onClick={() => setDraft(null)}>Cancel</Button>
          </Stack>
        </Stack>
      ) : reading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary" }}>
          <CircularProgress size={14} />
          <Typography variant="body2">Reading the text in this image…</Typography>
        </Stack>
      ) : text ? (
        <>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", p: 1, borderRadius: 1, bgcolor: "action.hover", fontSize: "0.85rem" }}>{text}</Typography>
          <Typography variant="caption" color="text.secondary">{ENGINE[correct.isSuccess ? "person" : (m.ocrEngine ?? "")] ?? "Read automatically"} · searchable</Typography>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {m.ocrState === "failed" ? `Couldn't read this image${m.ocrError ? `: ${m.ocrError}` : ""}.` : "No text found."}
        </Typography>
      )}
    </Box>
  );
}
