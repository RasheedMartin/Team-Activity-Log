import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { hit, tagMap, users } from "../../stories/fixtures";
import { PostCard } from "./PostCard";

const meta: Meta<typeof PostCard> = {
  title: "Posts/PostCard",
  component: PostCard,
  args: { href: "#", author: users[0], tags: tagMap },
  decorators: [(Story) => <Box sx={{ maxWidth: 900, border: 1, borderColor: "divider" }}><Story /></Box>],
};
export default meta;
type Story = StoryObj<typeof PostCard>;

export const Default: Story = { args: { hit: hit() } };
export const Comfortable: Story = { args: { hit: hit(), comfortable: true } };
export const Focused: Story = { args: { hit: hit(), focused: true } };
export const SearchMatch: Story = {
  args: {
    hit: hit({
      highlights: [
        { field: "title", snippet: "Detector B <mark>drift</mark> after cooldown" },
        { field: "comments", snippet: "…the <mark>drift</mark> correlates with hall temperature…" },
      ],
      matchedIn: ["title", "comment"],
    }),
  },
};
export const NoImages: Story = { args: { hit: hit({ images: [] }, { counts: { comments: 0, reactions: 0, images: 0 }, reactions: {} }) } };
export const Hidden: Story = { args: { hit: hit({}, { visibility: "hidden", hiddenReason: "Superseded" }) } };
export const Imported: Story = {
  args: { hit: hit({}, { workDateSource: "guessed", source: { kind: "import", importJobId: "j", fileName: "Lab_Notes_2022.pptx", fileSha256: "x", slide: 42, slideCount: 120 } }) },
};
export const LongTitleManyTags: Story = {
  args: {
    hit: hit({}, { title: "A very long title about the cryostat cooldown curve, the pump schedule, and why channel 12 is still noisy after shielding", tagIds: ["t1", "t2", "t3", "t4", "t5"], coAuthorIds: ["u2"] }),
  },
};
export const UnknownAuthorLoading: Story = { args: { hit: hit(), author: undefined } };
export const ManyImages: Story = {
  args: {
    hit: hit(
      { images: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ imageInstanceId: `m${n}`, thumbUrl: `/mock-assets/fig-0${(n % 4) + 1}-chart.svg`, width: 1200, height: 800, dominantColor: "#fff" })) },
      { counts: { comments: 4, reactions: 3, images: 7 } },
    ),
  },
};
export const NoImagesAlignedFooter: Story = {
  render: (args) => (
    <>
      <PostCard {...args} hit={hit()} />
      <PostCard {...args} hit={hit({ images: [] }, { counts: { comments: 12, reactions: 0, images: 0 }, reactions: {} })} />
    </>
  ),
};
