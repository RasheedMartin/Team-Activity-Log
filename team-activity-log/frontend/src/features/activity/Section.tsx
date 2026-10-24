import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** One Activity tab's body: a one-line explanation with the tab's actions beside it, then its list. */
export function ActivityPanel({ label, sub, actions, children }: { label: string; sub: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Box role="tabpanel" aria-label={label}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5, minHeight: 36, flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>{sub}</Typography>
        {actions}
      </Stack>
      {children}
    </Box>
  );
}
