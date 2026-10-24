import type { Post, SearchHit, Tag, User } from "../api/contract";
import { doc, paragraph } from "../lib/prosemirror";

// Hand-written fixtures for stories (the mock server's seed is for the running app).
export const users: User[] = [
  { id: "u1", name: "Dana Okafor", email: "dana@lab.example", title: "Group lead" },
  { id: "u2", name: "Marcus Lindqvist", email: "marcus@lab.example" },
];
export const tags: Tag[] = [
  { id: "t1", name: "calibration", color: "#2563eb" },
  { id: "t2", name: "detector-B", color: "#059669" },
  { id: "t3", name: "cooldown", color: "#ea580c" },
  { id: "t4", name: "in-progress", color: "#9333ea" },
  { id: "t5", name: "noise", color: "#dc2626" },
];
export const tagMap = new Map(tags.map((t) => [t.id, t]));

export const basePost: Post = {
  id: "p1",
  orgId: "o1",
  workspaceId: "w1",
  title: "Detector B drift after cooldown",
  summary: "Gain stayed within 1.8% after the first hour; drift concentrated on the east side.",
  workDate: "2026-09-12",
  workDateSource: "user",
  status: "published",
  visibility: "visible",
  authorId: "u1",
  coAuthorIds: [],
  tagIds: ["t1", "t2"],
  blocks: [{ id: "b1", type: "text", doc: doc(paragraph("Took 36 runs overnight.")) }],
  revision: 1,
  version: 1,
  createdAt: "2026-09-12T10:00:00Z",
  updatedAt: "2026-09-12T10:00:00Z",
  publishedAt: "2026-09-12T10:00:00Z",
  counts: { comments: 4, reactions: 3, images: 2 },
  reactions: { "👍": ["u1", "u2", "u3"] },
  collectionIds: [],
};

const img = (n: number, w = 1200, h = 800) => ({ imageInstanceId: `i${n}`, thumbUrl: `/mock-assets/fig-0${n}-chart.svg`, width: w, height: h, dominantColor: "#ffffff" });
export const hit = (over: Partial<SearchHit> = {}, post: Partial<Post> = {}): SearchHit => ({
  post: { ...basePost, ...post },
  highlights: [],
  matchedIn: [],
  images: [img(1), img(2)],
  ...over,
});
