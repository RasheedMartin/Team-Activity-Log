import { InboxOutlined } from "@mui/icons-material";
import { Button, Stack } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { tags, users } from "../stories/fixtures";
import { EmptyState, ErrorState, Kbd, StatusPill, TagChip, UserAvatar } from "./ui";

const meta: Meta = { title: "Foundation/Primitives" };
export default meta;

export const Tags: StoryObj = {
  render: () => (
    <Stack direction="row" spacing={1} flexWrap="wrap">
      {tags.map((t) => <TagChip key={t.id} tag={t} />)}
      <TagChip tag={tags[0]} excluded />
      <TagChip tag={tags[1]} onDelete={() => {}} />
    </Stack>
  ),
};
export const Status: StoryObj = {
  render: () => (
    <Stack direction="row" spacing={1}>
      <StatusPill status="draft" />
      <StatusPill status="hidden" />
      <StatusPill status="deleted" />
      <StatusPill status="edited" />
    </Stack>
  ),
};
export const Avatars: StoryObj = {
  render: () => (
    <Stack direction="row" spacing={1} alignItems="center">
      {users.map((u) => <UserAvatar key={u.id} user={u} size={32} />)}
      <UserAvatar size={32} />
      <UserAvatar user={users[0]} size={18} />
    </Stack>
  ),
};
export const Keys: StoryObj = { render: () => <Stack direction="row" spacing={1}><Kbd>C</Kbd><Kbd>/</Kbd><Kbd>⌘K</Kbd></Stack> };
export const Empty: StoryObj = {
  render: () => <EmptyState icon={<InboxOutlined />} title="You're all caught up" body="Mentions and replies show up here." action={<Button variant="outlined">Go to feed</Button>} />,
};
export const Error: StoryObj = { render: () => <ErrorState error={new globalThis.Error("Search is temporarily unavailable")} onRetry={() => {}} /> };
