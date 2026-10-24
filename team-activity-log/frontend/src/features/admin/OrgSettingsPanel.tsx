import { Alert, Box, Button, LinearProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useRenameOrg } from "../../api/hooks";
import { can, useOrgScope } from "../../app/session";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";

export function OrgSettingsPanel() {
  const { org, role } = useOrgScope()!;
  const notify = useNotify();
  const [name, setName] = useState(org.name);
  const rename = useRenameOrg(org.id);
  const owner = can(role, "owner");
  return (
    <Stack spacing={2} sx={{ maxWidth: 640 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h4" sx={{ mb: 1.5 }}>Name</Typography>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} sx={{ flex: 1 }} helperText={`URL: /o/${org.slug} (can't be changed)`} />
          <Button variant="outlined" disabled={!owner || !name.trim() || name === org.name || rename.isPending} onClick={() => rename.mutate(name.trim(), { onSuccess: () => notify("Organization renamed") })}>
            Save
          </Button>
        </Stack>
        {!owner && <Typography variant="caption" color="text.secondary">Only owners can rename the organization.</Typography>}
        {rename.error && <Alert severity="error" sx={{ mt: 1 }}>{errorMessage(rename.error)}</Alert>}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Storage</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Images are deduplicated across the organization. Imported PowerPoint files are deleted after import (kept at most 7 days).
        </Typography>
        <Box>
          <LinearProgress variant="determinate" value={12} sx={{ height: 6, borderRadius: 3 }} />
          <Typography variant="caption" color="text.secondary">Usage accounting arrives with the storage backend (B-2).</Typography>
        </Box>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Ownership</Typography>
        <Typography variant="body2" color="text.secondary">
          To transfer ownership, open Members, choose a person's menu, and pick “Transfer ownership”. The last owner can't be removed.
        </Typography>
      </Paper>
    </Stack>
  );
}
