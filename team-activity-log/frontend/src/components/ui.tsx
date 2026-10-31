import { Avatar, Box, Button, Chip, Stack, Typography, useTheme, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";
import type { Tag, User } from "../api/contract";
import { errorMessage, initials } from "../lib/format";
import { tint } from "../theme/theme";

// ---- avatar ----

const AVATAR_HUES = [210, 160, 30, 280, 340, 190, 100, 250, 15, 300];
const hueFor = (id: string) => AVATAR_HUES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_HUES.length];

export function UserAvatar({ user, size = 24, sx }: { user?: Pick<User, "id" | "name" | "avatarUrl">; size?: number; sx?: SxProps<Theme> }) {
  const theme = useTheme();
  const hue = user ? hueFor(user.id) : 0;
  const dark = theme.palette.mode === "dark";
  return (
    <Avatar
      src={user?.avatarUrl}
      alt=""
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        fontWeight: 600,
        bgcolor: `hsl(${hue} ${dark ? 35 : 55}% ${dark ? 30 : 88}%)`,
        color: `hsl(${hue} ${dark ? 60 : 50}% ${dark ? 85 : 30}%)`,
        ...sx,
      }}
    >
      {user ? initials(user.name) : "?"}
    </Avatar>
  );
}

// ---- tags ----

export function TagChip({
  tag,
  onDelete,
  onClick,
  excluded,
  size = "small",
}: {
  tag: Pick<Tag, "name" | "color">;
  onDelete?: (event: React.SyntheticEvent) => void;
  onClick?: () => void;
  excluded?: boolean;
  size?: "small" | "medium";
}) {
  const theme = useTheme();
  return (
    <Chip
      size={size}
      label={tag.name}
      onDelete={onDelete}
      onClick={onClick}
      sx={{
        height: size === "small" ? 20 : 24,
        fontSize: "0.72rem",
        fontFamily: "'IBM Plex Mono', monospace",
        bgcolor: tint(tag.color, theme.palette.mode),
        color: theme.palette.mode === "light" ? tag.color : theme.palette.getContrastText(theme.palette.background.paper),
        textDecoration: excluded ? "line-through" : undefined,
        "& .MuiChip-label": { px: 0.75 },
        "& .MuiChip-deleteIcon": { fontSize: 14, color: "inherit", opacity: 0.6 },
      }}
    />
  );
}

export function TagDot({ color, size = 8 }: { color: string; size?: number }) {
  return <Box component="span" sx={{ width: size, height: size, borderRadius: "50%", bgcolor: color, display: "inline-block", flexShrink: 0 }} />;
}

// ---- states ----

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 8, px: 2, textAlign: "center", color: "text.secondary" }}>
      {icon && <Box sx={{ color: "text.disabled", "& svg": { fontSize: 36 } }}>{icon}</Box>}
      <Typography variant="h4" color="text.primary">
        {title}
      </Typography>
      {body && (
        <Typography variant="body2" sx={{ maxWidth: 420 }}>
          {body}
        </Typography>
      )}
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Couldn't load this"
      body={errorMessage(error)}
      action={onRetry && <Button variant="outlined" onClick={onRetry}>Try again</Button>}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        fontSize: "0.68rem",
        px: 0.5,
        py: 0.1,
        borderRadius: 0.5,
        border: 1,
        borderColor: "currentColor",
        color: "inherit",
        opacity: 0.6,
        lineHeight: 1.4,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {children}
    </Box>
  );
}

/** Status pill for draft/hidden/deleted (the only other place color is allowed, §A4). */
export function StatusPill({ status }: { status: "draft" | "hidden" | "deleted" | "edited" }) {
  const theme = useTheme();
  const colors = { draft: theme.palette.warning.main, hidden: theme.palette.text.secondary, deleted: theme.palette.error.main, edited: theme.palette.text.disabled };
  const c = colors[status];
  return (
    <Box
      component="span"
      sx={{
        fontSize: "0.68rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: c,
        bgcolor: status === "edited" ? "transparent" : tint(c, theme.palette.mode),
        px: status === "edited" ? 0 : 0.6,
        py: 0.1,
        borderRadius: 0.5,
      }}
    >
      {status}
    </Box>
  );
}

export function PageHeader({ title, actions, sub }: { title: ReactNode; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" spacing={2} useFlexGap sx={{ mb: 2, flexWrap: "wrap", rowGap: 1.5 }}>
      {/* On a phone the actions wrap below the title rather than squeezing it into a column. */}
      <Box sx={{ flex: "1 1 280px", minWidth: 0 }}>
        <Typography variant="h2">{title}</Typography>
        {sub && (
          <Typography variant="body2" color="text.secondary">
            {sub}
          </Typography>
        )}
      </Box>
      {actions}
    </Stack>
  );
}
