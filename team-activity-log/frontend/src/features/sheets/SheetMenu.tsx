import { CheckRounded, DeleteOutlineRounded, DriveFileRenameOutlineRounded, FileDownloadOutlined, GroupsOutlined, MoreHorizRounded, SyncRounded, TableViewOutlined } from "@mui/icons-material";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Tooltip, Typography } from "@mui/material";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Sheet, SheetRows } from "../../api/contract";
import { downloadFile } from "../../api/client";
import { useDeleteSheet, usePatchSheet, useReplaceSheet } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { downloadText, toCsv } from "../../lib/csv";
import { errorMessage } from "../../lib/format";
import { SHEET_TYPES } from "./SheetsPage";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The sheet's actions: downloads, a new version of the file, who edits, rename, delete. */
export function SheetMenu({ sheet, tabName, data }: { sheet: Sheet; tabName?: string; data?: SheetRows }) {
  const { org, ws } = useWs();
  const navigate = useNavigate();
  const notify = useNotify();
  const patch = usePatchSheet(org.id, sheet.id);
  const replace = useReplaceSheet(org.id, sheet.id);
  const del = useDeleteSheet(org.id, ws.id);
  const file = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<"rename" | "replace" | "delete" | null>(null);
  const [name, setName] = useState(sheet.name);
  const close = () => setAnchor(null);
  const csvName = `${sheet.name}${sheet.tabList.length > 1 && tabName ? ` - ${tabName}` : ""}.csv`;

  return (
    <>
      <Tooltip title="More">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Sheet actions"><MoreHorizRounded /></IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <MenuItem disabled={!data} onClick={() => (close(), data && downloadText(toCsv(data.columns, data.rows), csvName))}>
          <ListItemIcon><TableViewOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="Download as CSV" secondary={sheet.tabList.length > 1 ? "This tab, as it is now" : "As it is now"} />
        </MenuItem>
        {sheet.hasOriginal && (
          <MenuItem onClick={() => (close(), void downloadFile(`/orgs/${org.id}/sheets/${sheet.id}/original`, sheet.filename ?? "sheet").catch((e) => notify(e.message)))}>
            <ListItemIcon><FileDownloadOutlined fontSize="small" /></ListItemIcon>
            <ListItemText primary="Download original" secondary={sheet.filename} />
          </MenuItem>
        )}
        {sheet.canEdit && (
          <MenuItem onClick={() => (close(), setDialog("replace"))}>
            <ListItemIcon><SyncRounded fontSize="small" /></ListItemIcon>
            Replace data with a new file…
          </MenuItem>
        )}
        {sheet.canDelete && (
          <MenuItem
            onClick={() => {
              close();
              const editAccess = sheet.editAccess === "workspace" ? "owner" : "workspace";
              patch.mutate({ editAccess }, { onSuccess: () => notify(editAccess === "workspace" ? "Everyone in the workspace can edit this sheet" : "Only you and admins can edit this sheet now"), onError: (e) => notify(errorMessage(e)) });
            }}
          >
            <ListItemIcon>{sheet.editAccess === "workspace" ? <CheckRounded fontSize="small" /> : <GroupsOutlined fontSize="small" />}</ListItemIcon>
            <ListItemText primary="Let everyone edit" secondary={sheet.editAccess === "workspace" ? "On: anyone in the workspace (not viewers)" : "Off: only you and admins"} />
          </MenuItem>
        )}
        {sheet.canEdit && (
          <MenuItem onClick={() => (close(), setName(sheet.name), setDialog("rename"))}>
            <ListItemIcon><DriveFileRenameOutlineRounded fontSize="small" /></ListItemIcon>
            Rename
          </MenuItem>
        )}
        {sheet.canDelete && (
          <MenuItem onClick={() => (close(), setDialog("delete"))} sx={{ color: "error.main" }}>
            <ListItemIcon><DeleteOutlineRounded fontSize="small" color="error" /></ListItemIcon>
            Delete sheet
          </MenuItem>
        )}
      </Menu>

      <input
        ref={file}
        type="file"
        hidden
        accept={SHEET_TYPES}
        aria-label="New version of the file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setDialog(null);
          replace.mutate({ file: f, tabName }, {
            onSuccess: (r) => {
              const notes = [r.removedCharts ? `${plural(r.removedCharts, "chart")} on removed tabs ${r.removedCharts === 1 ? "was" : "were"} deleted` : "", r.brokenCharts.length ? `${r.brokenCharts.map((n) => `“${n}”`).join(", ")} need${r.brokenCharts.length === 1 ? "s" : ""} a column that's gone` : ""].filter(Boolean);
              notify(`Data replaced from ${f.name}${notes.length ? `. ${notes.join("; ")}.` : ""}`);
            },
            onError: (err) => notify(errorMessage(err)),
          });
        }}
      />

      <Dialog open={dialog === "replace"} onClose={() => setDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Replace the data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>Choose a new version of the spreadsheet. Its data replaces what's here, including edits made in the app.</Typography>
          <Typography variant="body2" color="text.secondary">Tabs and columns are matched by name, so charts and the posts showing them keep working. Tabs that aren't in the new file are removed with their charts. A CSV replaces just {tabName ? `“${tabName}”` : "this tab"}.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" disabled={replace.isPending} onClick={() => file.current?.click()}>{replace.isPending ? "Replacing…" : "Choose file"}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === "rename"} onClose={() => setDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename sheet</DialogTitle>
        <DialogContent>
          <TextField fullWidth autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim() || patch.isPending} onClick={() => patch.mutate({ name: name.trim() }, { onSuccess: () => setDialog(null), onError: (e) => notify(errorMessage(e)) })}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === "delete"} onClose={() => setDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this sheet?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">“{sheet.name}” and its saved charts are deleted for everyone. Posts that show one of its charts will say the chart is no longer available.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={del.isPending} onClick={() => del.mutateAsync(sheet.id).then(() => (notify("Sheet deleted"), navigate(wsPath(org, ws, "/sheets"))), (e) => notify(errorMessage(e)))}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
