import { Box, Button, Stack, Typography } from "@mui/material";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

/** Last-resort error screen for anything that escapes a page (instead of the router's dev page). */
export function ErrorScreen() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : "Unknown error";
  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 3, bgcolor: "background.default" }}>
      <Stack spacing={1.5} sx={{ maxWidth: 480, textAlign: "center" }}>
        <Typography variant="h2">Something went wrong</Typography>
        <Typography color="text.secondary">This page hit an unexpected error. Your drafts are saved; reloading usually fixes it.</Typography>
        <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "monospace", wordBreak: "break-word" }}>{message}</Typography>
        <Stack direction="row" spacing={1} justifyContent="center" sx={{ pt: 1 }}>
          <Button variant="contained" onClick={() => location.reload()}>Reload</Button>
          <Button onClick={() => location.assign("/")}>Back to the log</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
