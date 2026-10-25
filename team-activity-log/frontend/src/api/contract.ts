// The frontend contract (§A7). The mock server and the real API both implement this.
// When it changes, update the mock, docs/DESIGN, and the contract tests in the same PR.

export type ID = string; // UUIDv7
export type ISODateTime = string;
export type ISODate = string; // YYYY-MM-DD (no timezone)

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type PostStatus = "draft" | "published";
export type Visibility = "visible" | "hidden";

// ---- Identity & tenancy (v1) ----

export interface User {
  id: ID;
  name: string;
  email: string;
  avatarUrl?: string;
  title?: string;
  bio?: string;
  pronouns?: string;
  timezone?: string;
}
export interface UserPreferences {
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable";
  defaultWorkspaceId?: ID;
  histogramDateField: DateField;
  shortcuts: boolean;
  digest: "off" | "daily" | "weekly";
  reducedMotion: boolean;
  timezone: string;
}
export interface Organization {
  id: ID;
  name: string;
  slug: string;
}
export interface Membership {
  orgId: ID;
  user: User;
  role: OrgRole;
  status: "active" | "invited" | "deactivated";
  workspaceIds: ID[];
}
export interface Workspace {
  id: ID;
  orgId: ID;
  name: string;
  slug: string;
  description?: string;
  archived: boolean;
  allOrgMembers: boolean;
}
export interface Invite {
  id: ID;
  orgId: ID;
  email: string;
  role: OrgRole;
  workspaceIds: ID[];
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: ISODateTime;
  invitedBy: ID;
  createdAt: ISODateTime;
}
export interface InviteLink {
  id: ID;
  orgId: ID;
  token: string;
  roleCap: OrgRole;
  expiresAt: ISODateTime;
}
export interface Session {
  id: ID;
  device: string;
  ip: string;
  createdAt: ISODateTime;
  current: boolean;
}

/** GET /me — who I am, where I can go, and my preferences. */
export interface MeResponse {
  user: User;
  preferences: UserPreferences;
  orgs: { org: Organization; role: OrgRole; workspaces: Workspace[] }[];
  lastWorkspaceId?: ID;
}

// ---- Posts, tags, assets (v2) ----

export interface Tag {
  id: ID;
  name: string;
  color: string;
  groupId?: ID;
}
export interface TagGroup {
  id: ID;
  name: string;
}

export type Block =
  | { id: ID; type: "text"; doc: unknown /* ProseMirror JSON */ }
  | { id: ID; type: "image"; imageInstanceId: ID }
  | { id: ID; type: "table"; doc: unknown }
  | { id: ID; type: "slide_break"; notes?: string }
  | { id: ID; type: "slide"; design: SlideDesign; notes?: string };

/**
 * A designed slide: elements placed on a fixed canvas (units are points; 960×540 is 16:9), the
 * way PowerPoint lays one out. Text elements hold ProseMirror docs, so their text is indexed like
 * any other post text; image elements reference image instances, so search and comments work.
 */
export interface SlideDesign {
  size: { w: number; h: number };
  background?: string; // #rrggbb
  fonts?: { heading?: string; body?: string };
  elements: SlideElement[];
}
interface SlideElementBase {
  id: ID;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number; // degrees
  decorative?: boolean; // template art from the master/layout (logos, bars, footers): not searched
}
export type SlideShape = "rect" | "roundRect" | "ellipse" | "triangle" | "line" | "arrow";
export interface SlideBox {
  doc?: unknown; // ProseMirror JSON
  fontSize?: number; // points; runs inherit it
  color?: string; // default text color
  valign?: "top" | "middle" | "bottom";
  role?: "title" | "body"; // title uses the heading font
}
export type SlideElement =
  | (SlideElementBase & SlideBox & { kind: "text"; fill?: string; line?: string })
  | (SlideElementBase & SlideBox & { kind: "shape"; shape: SlideShape; fill?: string; line?: string; lineWidth?: number; flipH?: boolean; flipV?: boolean })
  | (SlideElementBase & { kind: "image"; imageInstanceId: ID })
  /** Drawn from the data table in its doc (header row: series names; first column: categories),
   *  so editing the table redraws the chart and its numbers are searchable. */
  | (SlideElementBase & SlideBox & { kind: "chart"; chartType: ChartType; colors?: (string | null)[] });
export type ChartType = "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";

/** How automatic slides look when presenting (designed slides keep their own design). */
export interface SlideTheme {
  name?: string;
  background?: string; // #rrggbb
  heading?: string;
  text?: string;
  accent?: string;
  headingFont?: string;
  bodyFont?: string;
}
/** A post's or notebook's presentation settings; `deck` keeps an imported deck's own look. */
export interface Presentation {
  theme?: SlideTheme;
  deck?: SlideTheme;
}

export interface PostSource {
  kind: "import";
  importJobId: ID;
  fileName: string;
  fileSha256: string;
  slide: number;
  slideCount: number;
}

export interface Post {
  id: ID;
  orgId: ID;
  workspaceId: ID;
  title: string;
  summary?: string;
  workDate: ISODate;
  workDateSource: "user" | "guessed" | "import_fallback";
  status: PostStatus;
  visibility: Visibility;
  hiddenReason?: string;
  hiddenBy?: ID;
  hiddenAt?: ISODateTime;
  authorId: ID;
  coAuthorIds: ID[];
  tagIds: ID[];
  blocks: Block[];
  revision: number;
  version: number; // optimistic concurrency token
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  publishedAt?: ISODateTime;
  deletedAt?: ISODateTime;
  counts: { comments: number; reactions: number; images: number };
  reactions: Record<string, ID[]>;
  collectionIds: ID[];
  source?: PostSource;
  presentation?: Presentation;
}

/** Image metadata (§B10): what the author provides lives on ImageInstance; this is extracted. */
export interface ImageMetadata {
  exif?: { capturedAt?: ISODateTime; cameraMake?: string; cameraModel?: string };
  ocrText?: string;
  ocrState: "pending" | "ready" | "failed" | "none";
  detectedType?: ImageType;
  dpi?: number;
  colorSpace?: string;
  hasAlpha?: boolean;
  sourceKind: "upload" | "paste" | "screenshot" | "pptx_import";
}
export type ImageType = "chart" | "photo" | "screenshot" | "diagram" | "table";

export interface Asset {
  id: ID;
  kind: "image";
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  originalFilename?: string;
  blurhash?: string;
  dominantColors: string[];
  variants: {
    name: "thumb" | "small" | "medium" | "original";
    url: string;
    width: number;
    height: number;
  }[];
  processing: "pending" | "ready" | "failed";
  metadata: ImageMetadata;
}

export type ShapeTool =
  | "pen"
  | "line"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "highlight";
/** Annotation shapes in normalized image coordinates (0..1), so they survive any display size. */
export interface Shape {
  id: string;
  tool: ShapeTool;
  color: string;
  opacity: number;
  size: number; // stroke width relative to image width (fraction)
  points: [number, number][]; // pen/highlight: path; others: [start, end]
  text?: string;
}

export interface ImageInstance {
  // an asset as used in one post or comment
  id: ID;
  assetId: ID;
  postId?: ID;
  commentId?: ID;
  caption?: string;
  altText?: string;
  figureLabel?: string;
  tags: string[];
  customFields: Record<string, string>;
  annotation?: { shapes: Shape[]; version: number };
}
/** An image instance joined with its asset — what the UI renders. */
export interface ImageView extends ImageInstance {
  asset: Asset;
}

export interface PostRevision {
  revision: number;
  editedBy: ID;
  editedAt: ISODateTime;
  title: string;
  blocks: Block[];
}

/** GET /posts/:id — the post plus everything needed to render it in one round trip. */
export interface PostDetail {
  post: Post;
  images: ImageView[];
}

export interface DraftSummary {
  id: ID;
  title: string;
  updatedAt: ISODateTime;
  imageCount: number;
  workspaceId: ID;
  /** Drafts made by importing slides: which import, file, and slide. */
  source?: Pick<PostSource, "importJobId" | "fileName" | "slide" | "slideCount">;
}

/** A post an import created, drafts and published alike (the import page's two lists). */
export interface ImportPost extends DraftSummary {
  status: "draft" | "published";
}

export interface PostPatch {
  version: number;
  title?: string;
  summary?: string;
  workDate?: ISODate;
  tagIds?: ID[];
  coAuthorIds?: ID[];
  blocks?: Block[];
  presentation?: Presentation | null; // not a content edit: no new revision
}

// ---- Discussion (v3) ----

export interface Comment {
  id: ID;
  postId: ID;
  parentId?: ID;
  authorId: ID;
  doc: unknown;
  imageInstanceIds: ID[];
  anchor?: { imageInstanceId: ID; x: number; y: number; annotationShapeId?: string }; // 0..1
  isQuestion: boolean;
  resolved: boolean;
  acceptedAnswerId?: ID;
  hidden: boolean;
  createdAt: ISODateTime;
  editedAt?: ISODateTime;
  deletedAt?: ISODateTime;
  reactions: Record<string, ID[]>;
  version: number;
}

export interface Notification {
  id: ID;
  kind: "mention" | "reply";
  postId: ID;
  commentId: ID;
  actorId: ID;
  workspaceId: ID;
  createdAt: ISODateTime;
  readAt?: ISODateTime;
  /** Hydrated by the server so Activity renders in one request. */
  postTitle?: string;
  excerpt?: string;
}

/** Live events (SSE in production; timers in the mock). */
export type LiveEvent =
  | { type: "comment"; postId: ID; commentId: ID }
  | { type: "reaction"; postId: ID }
  | { type: "notification" }
  | { type: "post"; postId: ID };

// ---- Search (v4): ONE schema used by the URL, saved views, the mock engine, and the real API ----

export type DateField = "workDate" | "publishedAt" | "updatedAt";
export type Interval = "auto" | "day" | "week" | "month" | "quarter" | "year";
export type Sort =
  | "relevance"
  | "newest"
  | "oldest"
  | "workDate"
  | "mostDiscussed"
  | "recentActivity";

/** Nested boolean filter tree for the advanced builder (owner request; maps to ES bool queries). */
export interface FilterGroup {
  op: "and" | "or" | "not"; // "not" = none of the items match
  items: (Condition | FilterGroup)[];
}
export const isFilterGroup = (x: Condition | FilterGroup): x is FilterGroup => "items" in x;

export interface FilterSpec {
  /** Boolean search text: AND/OR/NOT/-, parentheses, "phrases", prefix*, field scopes (src/lib/query.ts). */
  q?: string;
  all?: Condition[]; // AND
  any?: Condition[]; // OR (one level)
  none?: Condition[]; // NOT
  /** Advanced filters, ANDed with all/any/none. */
  where?: FilterGroup;
  sort?: Sort;
  view?: "posts" | "gallery";
  /** `bounds` is the zoomed view window ("Zoom to selection"); it never filters results. */
  histogram?: { field: DateField; interval: Interval; bounds?: { from: ISODate; to: ISODate } };
  facets?: ("tags" | "authors" | "imageTypes")[];
  cursor?: string;
  limit?: number;
}
export type ConditionOp =
  | "in"
  | "in_all"
  | "not_in"
  | "eq"
  | "between"
  | "contains"
  | "gte"
  | "lte";
export interface Condition {
  field: FilterField;
  op: ConditionOp;
  value: unknown;
}
export type FilterField =
  | "author"
  | "coAuthor"
  | "tag"
  | DateField
  | "hasImages"
  | "hasAnnotations"
  | "hasComments"
  | "unansweredQuestion"
  | "resolved"
  | "mentionsMe"
  | "iCommented"
  | "iReacted"
  | "mine"
  | "collection"
  | "status"
  | "visibility"
  | "importedFrom"
  | "workDateGuessed"
  | "image.ocrText"
  | "image.type"
  | "image.figureLabel"
  | "image.filename"
  | "image.capturedAt"
  | "image.minWidth"
  | "image.minHeight"
  | "image.custom"
  | "image.annotationText";

/** Relative dates are allowed as { preset } values and resolved at query time. */
export type DatePreset =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_quarter"
  | "this_year";
export type DateRangeValue = { from?: ISODate; to?: ISODate } | { preset: DatePreset };

export interface FacetBucket {
  value: string;
  label?: string;
  count: number;
  selected?: boolean;
}
export interface HistogramBucket {
  start: ISODateTime;
  end: ISODateTime;
  count: number;
  topTags?: { tagId: ID; count: number }[];
}

export interface SearchHit {
  post: Post;
  highlights: { field: string; snippet: string }[];
  matchedIn: string[];
  imageHits?: { imageInstanceId: ID; thumbUrl: string }[];
  images: { imageInstanceId: ID; thumbUrl: string; blurhash?: string; width: number; height: number; dominantColor?: string }[];
}
export interface GalleryImage {
  imageInstanceId: ID;
  postId: ID;
  postTitle: string;
  thumbUrl: string;
  width: number;
  height: number;
  blurhash?: string;
  dominantColor?: string;
  caption?: string;
  figureLabel?: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  images?: GalleryImage[]; // gallery view
  facets: { tags: FacetBucket[]; authors: FacetBucket[]; imageTypes: FacetBucket[] };
  histogram?: {
    field: DateField;
    interval: Exclude<Interval, "auto">;
    buckets: HistogramBucket[];
    selectedRange?: { from: ISODateTime; to: ISODateTime };
  };
  total: number;
  nextCursor?: string;
  tookMs: number;
}

/** Explore (owner request): discovery shelves grouped by tag, newest activity first.
 *  Backend: ES terms agg on tags.id (filtered like search) with a top_hits sub-agg. */
export interface ExploreShelf {
  tag: Tag;
  groupName?: string;
  count: number;
  imageCount: number;
  lastActivity: ISODateTime;
  posts: { id: ID; title: string; workDate: ISODate; authorId: ID; excerpt?: string; imageCount: number; commentCount: number; thumbUrl?: string; dominantColor?: string }[];
  images: GalleryImage[];
  /** The notebook made from this tag, if one exists. */
  notebookId?: ID;
}
export interface ExploreResponse {
  shelves: ExploreShelf[];
  recent: GalleryImage[];
  /** Newest posts across all tags: Home's first row, the bridge into Search. */
  latest: ExploreShelf["posts"];
}

export interface SuggestResponse {
  tags: Tag[];
  people: User[];
  posts: { id: ID; title: string }[];
}

export interface SavedView {
  id: ID;
  workspaceId: ID;
  ownerId: ID;
  name: string;
  filterSpec: FilterSpec;
  shared: boolean;
  /** Pinned by the *caller* (pins are per user; see /pins). */
  pinned: boolean;
  updatedAt?: ISODateTime;
}

export interface Collection {
  id: ID;
  workspaceId: ID;
  name: string;
  /** "notebook" (owner request): posts stitched into one continuous document, ordered by the user. */
  kind: "manual" | "deck_import" | "saved_selection" | "notebook";
  postIds: ID[];
  createdBy: ID;
  updatedAt?: ISODateTime;
  /** Notebooks made from a tag remember it, so there is one per tag even after a rename. */
  sourceTagId?: ID;
  presentation?: Presentation;
}

// ---- Library (scale): everything a person can save, searchable and paged ----

export type LibraryKind = "view" | "notebook" | "collection";
export interface LibraryItem {
  kind: LibraryKind;
  id: ID;
  name: string;
  ownerId: ID;
  shared: boolean;
  /** Pinned by the caller. */
  pinned: boolean;
  updatedAt: ISODateTime;
  postCount?: number;
  collectionKind?: Collection["kind"];
  filterSpec?: FilterSpec;
}
export interface LibraryPage {
  items: LibraryItem[];
  nextCursor?: string;
  total: number;
  counts: Record<LibraryKind, number>;
}
export interface PinRef {
  kind: LibraryKind;
  id: ID;
}

/** Lightweight table-of-contents row for a collection/notebook (no post bodies). */
export interface CollectionEntry {
  id: ID;
  title: string;
  workDate: ISODate;
  authorId: ID;
}

// ---- Import (v5) ----

export type ImportMode = "per_slide" | "whole_deck" | "by_section";
/** auto: slides whose layout carries meaning (pictures, shapes, columns) stay designed; text slides become post text. */
export type SlideDesignMode = "auto" | "slides" | "text";
export interface ImportItem {
  id: ID;
  slideNumbers: number[];
  proposedTitle: string;
  proposedDate: ISODate;
  dateSource: "user" | "guessed" | "import_fallback";
  imageCount: number;
  warnings: string[];
  included: boolean;
  postId?: ID;
}
export interface ImportJob {
  id: ID;
  workspaceId: ID;
  status: "uploading" | "parsing" | "review" | "committing" | "done" | "failed";
  progress: number; // 0..1
  mode: ImportMode;
  sourceFilename: string;
  sourceBytes: number;
  slideCount: number;
  defaults: { tagIds: ID[]; baseDate?: ISODate; guessDates: boolean; collectionName: string; slideDesign?: SlideDesignMode };
  items: ImportItem[];
  collectionId?: ID;
  error?: string;
  report?: { created: number; skipped: number; warnings: number };
}

// ---- Plans (docs/PRICING.md; enforced by the server) ----

export interface PlanInfo {
  plan: "free" | "team" | "business" | "enterprise";
  name: string;
  /** null = unlimited */
  limits: { members: number | null; workspaces: number | null; privateWorkspaces: boolean; storageBytes: number | null; importsPerMonth: number | null };
  usage: { members: number; pendingInvites: number; workspaces: number; storageBytes: number; importsThisMonth: number };
}

// ---- Errors & dev ----

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface DevEmail {
  id: ID;
  to: string;
  subject: string;
  body: string;
  link?: string;
  sentAt: ISODateTime;
}
