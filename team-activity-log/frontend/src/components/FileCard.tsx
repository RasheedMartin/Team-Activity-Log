import { DeleteOutlineRounded, DescriptionOutlined, FileDownloadOutlined, InsertDriveFileOutlined, PictureAsPdfOutlined, TableChartOutlined } from "@mui/icons-material";
import { Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { AttachmentView } from "../api/contract";
import { downloadFile } from "../api/client";
import { useNotify } from "./notify";

const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const icon = (name: string) => {
  const e = ext(name);
  if (e === "pdf") return <PictureAsPdfOutlined />;
  if (["doc", "docx", "txt", "md", "rtf"].includes(e)) return <DescriptionOutlined />;
  if (["xls", "xlsx", "csv", "tsv"].includes(e)) return <TableChartOutlined />;
  return <InsertDriveFileOutlined />;
};
const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);

/** An attached file in a post: what it is, how big, whether its text is searchable, and Download. */
export function FileCard({ file, onRemove }: { file?: AttachmentView; onRemove?: () => void }) {
  const notify = useNotify();
  if (!file) {
    return <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5, color: "text.secondary" }}>File unavailable</Box>;
  }
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", breakInside: "avoid" }}>
      <Box sx={{ color: "primary.main", display: "flex" }} aria-hidden>{icon(file.filename)}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }} noWrap>{file.filename}</Typography>
        <Typography variant="caption" color="text.secondary">
          {ext(file.filename).toUpperCase() || "File"} · {fmtSize(file.bytes)}
          {file.searchable && " · its text is searchable"}
        </Typography>
      </Box>
      <Button size="small" startIcon={<FileDownloadOutlined />} onClick={() => void downloadFile(file.url.replace(/^\/v1/, ""), file.filename).catch((e) => notify(e.message))} aria-label={`Download ${file.filename}`}>
        Download
      </Button>
      {onRemove && (
        <Tooltip title="Remove from this post (the file stays available elsewhere)">
          <IconButton size="small" onClick={onRemove} aria-label={`Remove ${file.filename}`}><DeleteOutlineRounded fontSize="small" /></IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
