import { faker } from "@faker-js/faker/locale/en";
import type { Block, Comment, ID, ImageInstance, ImageType, OrgRole, Post, Shape } from "../api/contract";
import { addDays, todayISO } from "../lib/dates";
import { uuidv7 } from "../lib/ids";
import { bulletList, doc, paragraph, type PMNode } from "../lib/prosemirror";
import { db, type AssetRow, type CommentRow, type PostRow, type UserRow } from "./db";
import type { DataScenario } from "./devSettings";
import manifest from "./fixtures/assetManifest.json";

// Deterministic, physics-flavored seed data for each §A3 scenario.

export const PERSONA_PASSWORD = "password";

interface PersonSpec {
  name: string;
  title: string;
  role: OrgRole;
}
const PEOPLE: PersonSpec[] = [
  { name: "Dana Okafor", title: "Group lead", role: "owner" },
  { name: "Marcus Lindqvist", title: "Staff scientist", role: "admin" },
  { name: "Priya Raman", title: "Postdoc", role: "member" },
  { name: "Tomás Reyes", title: "Visiting collaborator", role: "viewer" },
  { name: "Yuki Tanaka", title: "Graduate student", role: "member" },
  { name: "Amara Nwosu", title: "Detector engineer", role: "member" },
  { name: "Felix Brandt", title: "Cryogenics engineer", role: "member" },
  { name: "Sofia Esposito", title: "Graduate student", role: "member" },
  { name: "Kwame Mensah", title: "DAQ developer", role: "member" },
  { name: "Lena Kowalski", title: "Postdoc", role: "member" },
  { name: "Arjun Mehta", title: "Research scientist", role: "member" },
  { name: "Hannah Cohen", title: "Technician", role: "member" },
];

export const TAG_COLORS = [
  "#2563eb",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#9333ea",
  "#4f46e5",
  "#0d9488",
  "#64748b",
];

const TAGS_BY_GROUP: Record<string, string[]> = {
  Project: ["aurora", "helix", "pathfinder", "cryo-upgrade", "beam-test-2026", "lumen"],
  Instrument: ["detector-A", "detector-B", "cryostat-2", "daq", "trigger", "laser-table", "sipm-array", "vacuum"],
  Status: ["in-progress", "blocked", "done", "needs-review"],
  Topic: ["calibration", "noise", "timing", "alignment", "firmware", "simulation", "analysis", "safety", "cooldown", "shielding"],
};
const EXTRA_TAG_STEMS = ["run", "module", "board", "sample", "scan", "batch", "crate", "channel", "fixture", "source"];

const SUBJECTS = [
  "Detector B",
  "Detector A",
  "Cryostat 2",
  "DAQ crate 3",
  "Trigger board",
  "Laser table",
  "Beamline 4",
  "Vacuum system",
  "SiPM array",
  "Readout firmware",
  "Co-60 source",
  "Pixel module 7",
];
const ACTIONS = [
  "gain drift after cooldown",
  "noise floor check",
  "calibration run",
  "timing scan",
  "leak test results",
  "firmware update",
  "threshold scan",
  "pedestal measurement",
  "alignment survey",
  "bias scan",
  "temperature cycling",
  "efficiency map",
];
const SENTENCES = [
  () => `Took ${faker.number.int({ min: 3, max: 40 })} runs overnight; gain stayed within ${faker.number.float({ min: 0.1, max: 2.5, fractionDigits: 1 })}% after the first hour.`,
  () => `Pedestal width dropped from ${faker.number.float({ min: 3, max: 6, fractionDigits: 2 })} to ${faker.number.float({ min: 1, max: 3, fractionDigits: 2 })} ADC counts once the ground strap was moved.`,
  () => `The cryostat reached ${faker.number.float({ min: 3.8, max: 4.5, fractionDigits: 2 })} K after ${faker.number.int({ min: 9, max: 30 })} hours; cooldown curve attached.`,
  () => `Channel ${faker.number.int({ min: 0, max: 63 })} is still noisy, probably the connector on the feedthrough.`,
  () => `Threshold set to ${faker.number.int({ min: 20, max: 80 })} mV for the next run plan.`,
  () => `Timing resolution came out at ${faker.number.int({ min: 40, max: 180 })} ps FWHM, consistent with the bench test.`,
  () => `Leak rate measured at ${faker.number.float({ min: 1, max: 9, fractionDigits: 1 })}e-9 mbar·l/s, within spec.`,
  () => `Updated the firmware to v${faker.number.int({ min: 1, max: 4 })}.${faker.number.int({ min: 0, max: 12 })}; trigger latency is now ${faker.number.int({ min: 80, max: 400 })} ns.`,
  () => `Calibration with the Co-60 source shows peaks at 1173 and 1332 keV, linearity residuals below ${faker.number.float({ min: 0.1, max: 0.9, fractionDigits: 1 })}%.`,
  () => `Alignment survey: offsets of ${faker.number.int({ min: 5, max: 90 })} µm in x and ${faker.number.int({ min: 5, max: 90 })} µm in y, corrected in the geometry file.`,
  () => `Next step is to repeat this with the shielding in place and compare the noise spectra.`,
  () => `Raw data is on the group drive under run ${faker.number.int({ min: 4000, max: 4999 })}.`,
  () => `Bias scan from ${faker.number.int({ min: 20, max: 40 })} V to ${faker.number.int({ min: 50, max: 80 })} V; breakdown around ${faker.number.int({ min: 45, max: 60 })} V.`,
];
const COMMENT_LINES = [
  "Nice. Did you check whether the drift correlates with the hall temperature?",
  "Can we get the raw numbers for the second plot?",
  "I saw the same thing on module 4 last month.",
  "Is this with the new firmware or the old one?",
  "Agree with the threshold choice.",
  "Could the noise be from the pump? It was running during that window.",
  "Looks good to me, let's include it in the weekly summary.",
  "Which source position was this?",
  "Following up: the connector has been replaced.",
  "Worth repeating with longer integration time.",
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const emailOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, ".") + "@halvorsen-lab.example";

function hashHex(s: string) {
  let h1 = 0x811c9dc5;
  let out = "";
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < s.length; i++) h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h1 = Math.imul(h1 ^ r, 16777619) >>> 0;
    out += h1.toString(16).padStart(8, "0");
  }
  return out;
}

interface SeedCtx {
  orgId: ID;
  users: UserRow[];
  roles: Map<ID, OrgRole>;
  tagIds: ID[];
  tagByName: Map<string, ID>;
  workspaceIds: ID[];
  assets: AssetRow[];
}

function seedUsers(specs: PersonSpec[]): UserRow[] {
  return specs.map((p) =>
    db.t.users.put({
      id: uuidv7(),
      name: p.name,
      email: emailOf(p.name),
      title: p.title,
      timezone: "UTC",
      password: PERSONA_PASSWORD,
      verified: true,
    }),
  );
}

function seedPrefs(userId: ID) {
  db.t.prefs.put({
    id: userId,
    theme: "system",
    density: "compact",
    histogramDateField: "workDate",
    shortcuts: true,
    digest: "off",
    reducedMotion: false,
    timezone: "UTC",
  });
}

function seedOrg(name: string, slug: string) {
  return db.t.orgs.put({ id: uuidv7(), name, slug });
}

function seedTags(orgId: ID, extra: number) {
  const ids: ID[] = [];
  const byName = new Map<string, ID>();
  let color = 0;
  for (const [groupName, names] of Object.entries(TAGS_BY_GROUP)) {
    const g = db.t.tagGroups.put({ id: uuidv7(), orgId, name: groupName });
    const all = groupName === "Project" && extra ? [...names, ...Array.from({ length: extra }, (_, i) => `${EXTRA_TAG_STEMS[i % EXTRA_TAG_STEMS.length]}-${String.fromCharCode(97 + Math.floor(i / EXTRA_TAG_STEMS.length))}${(i % 9) + 1}`)] : names;
    for (const n of all) {
      const t = db.t.tags.put({ id: uuidv7(), orgId, name: n, color: TAG_COLORS[color++ % TAG_COLORS.length], groupId: g.id });
      ids.push(t.id);
      byName.set(n, t.id);
    }
  }
  return { ids, byName };
}

function seedAssets(orgId: ID): AssetRow[] {
  return manifest.map((m) => {
    const url = `/mock-assets/${m.file}`;
    const scale = (w: number) => ({ width: w, height: Math.round((m.height * w) / m.width) });
    return db.t.assets.put({
      id: uuidv7(),
      orgId,
      kind: "image",
      mime: "image/svg+xml",
      bytes: m.bytes,
      width: m.width,
      height: m.height,
      sha256: hashHex(m.file),
      originalFilename: `${m.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.png`,
      dominantColors: m.dominantColors,
      variants: [
        { name: "thumb", url, ...scale(320) },
        { name: "small", url, ...scale(640) },
        { name: "medium", url, ...scale(1280) },
        { name: "original", url, width: m.width, height: m.height },
      ],
      processing: "ready",
      metadata: {
        ocrText: m.ocrText,
        ocrState: "ready",
        ocrEngine: "mock",
        detectedType: m.type as ImageType,
        sourceKind: "upload",
        ...(m.type === "photo" ? { exif: { capturedAt: faker.date.past({ years: 2 }).toISOString(), cameraMake: "Canon", cameraModel: "EOS R6" } } : {}),
      },
    });
  });
}

/** Work dates over ~3 years with bursts around deadlines so the histogram looks alive. */
function makeDateSampler(years: number) {
  const today = todayISO();
  const span = Math.round(years * 365);
  const bursts = Array.from({ length: Math.round(years * 5) }, () => faker.number.int({ min: 10, max: span - 1 }));
  return (): string => {
    let back: number;
    if (faker.number.float() < 0.4) {
      const c = faker.helpers.arrayElement(bursts);
      back = Math.round(c + faker.number.float({ min: -1, max: 1 }) * faker.number.float({ min: 0, max: 12 }));
    } else {
      // more recent work is denser: a team that grows into the tool
      back = Math.floor(span * Math.pow(faker.number.float(), 1.4));
    }
    back = Math.max(0, Math.min(span, back));
    let d = addDays(today, -back);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if ((dow === 0 || dow === 6) && faker.number.float() < 0.8) d = addDays(d, dow === 0 ? -2 : -1);
    return d;
  };
}

function randomShapes(n: number): Shape[] {
  const tools: Shape["tool"][] = ["rect", "ellipse", "arrow", "text", "pen"];
  return Array.from({ length: n }, () => {
    const tool = faker.helpers.arrayElement(tools);
    const x = faker.number.float({ min: 0.15, max: 0.7 });
    const y = faker.number.float({ min: 0.2, max: 0.7 });
    const points: [number, number][] =
      tool === "pen"
        ? Array.from({ length: 12 }, (_, i) => [x + i * 0.01, y + Math.sin(i / 2) * 0.03])
        : [
            [x, y],
            [x + faker.number.float({ min: 0.08, max: 0.25 }), y + faker.number.float({ min: 0.06, max: 0.2 })],
          ];
    return {
      id: uuidv7(),
      tool,
      color: faker.helpers.arrayElement(["#ef4444", "#f59e0b", "#2563eb"]),
      opacity: 1,
      size: 0.004,
      points,
      ...(tool === "text" ? { text: faker.helpers.arrayElement(["peak", "drift here", "noisy ch", "check this", "cut"]) } : {}),
    };
  });
}

function bodyDoc(): PMNode {
  const paras = Array.from({ length: faker.number.int({ min: 1, max: 4 }) }, () =>
    paragraph(
      Array.from({ length: faker.number.int({ min: 1, max: 3 }) }, () => faker.helpers.arrayElement(SENTENCES)()).join(" "),
    ),
  );
  if (faker.number.float() < 0.25)
    paras.push(bulletList(Array.from({ length: 3 }, () => faker.helpers.arrayElement(SENTENCES)())));
  return doc(...paras);
}

function makeTitle() {
  const r = faker.number.float();
  const subject = faker.helpers.arrayElement(SUBJECTS);
  const action = faker.helpers.arrayElement(ACTIONS);
  if (r < 0.08) return `Question: why does ${subject} show ${action.split(" ")[0]} issues?`;
  if (r < 0.15) return `Fixed: ${subject} ${action}`;
  if (r < 0.2) return `Weekly summary: ${subject}`;
  return cap(`${subject} ${action}`);
}

interface PostOpts {
  workspaceId: ID;
  author: UserRow;
  workDate: string;
  imageProbability: number;
  status?: Post["status"];
  title?: string;
}

function makePost(ctx: SeedCtx, o: PostOpts): PostRow {
  const id = uuidv7(new Date(`${o.workDate}T12:00:00Z`).getTime());
  const status = o.status ?? "published";
  const blocks: Block[] = [{ id: uuidv7(), type: "text", doc: bodyDoc() }];
  let imageCount = 0;
  if (faker.number.float() < o.imageProbability) {
    const n = faker.number.int({ min: 1, max: 3 });
    for (let i = 0; i < n; i++) {
      const asset = faker.helpers.arrayElement(ctx.assets);
      const inst: ImageInstance = {
        id: uuidv7(),
        assetId: asset.id,
        postId: id,
        caption: faker.number.float() < 0.7 ? `${faker.helpers.arrayElement(SUBJECTS)}, run ${faker.number.int({ min: 4000, max: 4999 })}` : undefined,
        altText: faker.number.float() < 0.5 ? `Plot of ${asset.metadata.ocrText?.split(" ").slice(0, 4).join(" ")}` : undefined,
        figureLabel: faker.number.float() < 0.4 ? `Fig. ${i + 1}${faker.helpers.arrayElement(["", "a", "b"])}` : undefined,
        tags: [],
        customFields: faker.number.float() < 0.5 ? { run_id: String(faker.number.int({ min: 4000, max: 4999 })), instrument: faker.helpers.arrayElement(["DET-A", "DET-B", "CRYO-2"]) } : {},
        annotation: faker.number.float() < 0.3 ? { shapes: randomShapes(faker.number.int({ min: 1, max: 3 })), version: 1 } : undefined,
      };
      db.t.images.put(inst);
      blocks.push({ id: uuidv7(), type: "image", imageInstanceId: inst.id });
      imageCount++;
      if (faker.number.float() < 0.4) blocks.push({ id: uuidv7(), type: "text", doc: doc(paragraph(faker.helpers.arrayElement(SENTENCES)())) });
    }
  }
  const createdAt = new Date(`${o.workDate}T${String(faker.number.int({ min: 8, max: 19 })).padStart(2, "0")}:${String(faker.number.int({ min: 0, max: 59 })).padStart(2, "0")}:00Z`);
  const publishedAt = new Date(Math.min(Date.now(), createdAt.getTime() + faker.number.int({ min: 0, max: 3 }) * 86_400_000 + faker.number.int({ min: 0, max: 3_600_000 })));
  const tagIds = faker.helpers.arrayElements(ctx.tagIds.slice(0, Math.min(ctx.tagIds.length, 24 + Math.floor(faker.number.float() * ctx.tagIds.length))), faker.number.int({ min: 0, max: 3 }));
  const reactors = faker.number.float() < 0.4 ? faker.helpers.arrayElements(ctx.users, faker.number.int({ min: 1, max: 4 })).map((u) => u.id) : [];
  const reactions: Record<string, ID[]> = reactors.length ? { [faker.helpers.arrayElement(["👍", "🎉", "👀", "🔥"])]: reactors } : {};
  const others = ctx.users.filter((u) => u.id !== o.author.id);
  const coAuthorIds = others.length && faker.number.float() < 0.1 ? [faker.helpers.arrayElement(others).id] : [];
  const post: PostRow = {
    id,
    orgId: ctx.orgId,
    workspaceId: o.workspaceId,
    title: o.title ?? makeTitle(),
    summary: faker.number.float() < 0.3 ? faker.helpers.arrayElement(SENTENCES)() : undefined,
    workDate: o.workDate,
    workDateSource: "user",
    status,
    visibility: "visible",
    authorId: o.author.id,
    coAuthorIds,
    tagIds,
    blocks,
    revision: status === "published" ? 1 : 0,
    version: 1,
    createdAt: createdAt.toISOString(),
    updatedAt: (status === "published" ? publishedAt : createdAt).toISOString(),
    publishedAt: status === "published" ? publishedAt.toISOString() : undefined,
    counts: { comments: 0, reactions: reactors.length, images: imageCount },
    reactions,
    collectionIds: [],
  };
  return db.t.posts.put(post);
}

function makeComment(post: PostRow, author: UserRow, minutesAfter: number, text: string, parentId?: ID, extra: Partial<Comment> = {}): CommentRow {
  const createdAt = new Date(Math.min(Date.now() - 60_000, new Date(post.publishedAt ?? post.createdAt).getTime() + minutesAfter * 60_000)).toISOString();
  const c = db.t.comments.put({
    id: uuidv7(new Date(createdAt).getTime()),
    postId: post.id,
    workspaceId: post.workspaceId,
    parentId,
    authorId: author.id,
    doc: doc(paragraph(text)),
    imageInstanceIds: [],
    isQuestion: false,
    resolved: false,
    hidden: false,
    createdAt,
    reactions: {},
    version: 1,
    ...extra,
  });
  return c;
}

function mentionDoc(text: string, user: UserRow, after: string): PMNode {
  return doc({
    type: "paragraph",
    content: [{ type: "text", text }, { type: "mention", attrs: { id: user.id, label: user.name } }, { type: "text", text: after }],
  });
}

function seedComments(ctx: SeedCtx, posts: PostRow[], probability: number) {
  // Viewers can react but not comment (§A2), so only members and up author comments.
  const commenters = ctx.users.filter((u) => ctx.roles.get(u.id) !== "viewer");
  for (const post of posts) {
    if (post.status !== "published" || faker.number.float() > probability) continue;
    const n = faker.number.int({ min: 1, max: 6 });
    const made: CommentRow[] = [];
    for (let i = 0; i < n; i++) {
      const author = faker.helpers.arrayElement(commenters);
      const parent = made.length && faker.number.float() < 0.4 ? faker.helpers.arrayElement(made) : undefined;
      const question = !parent && i === 0 && faker.number.float() < 0.3;
      made.push(makeComment(post, author, (i + 1) * faker.number.int({ min: 5, max: 600 }), faker.helpers.arrayElement(COMMENT_LINES), parent?.id, { isQuestion: question, resolved: question && faker.number.float() < 0.5 }));
    }
    post.counts.comments = made.length;
  }
}

function membership(orgId: ID, userId: ID, role: OrgRole, workspaceIds: ID[]) {
  db.t.memberships.put({ id: uuidv7(), orgId, userId, role, status: "active", workspaceIds });
}

function signIn(userId: ID) {
  const s = db.t.sessions.put({ id: uuidv7(), userId, device: "This browser", ip: "127.0.0.1", createdAt: new Date().toISOString() });
  return s.id;
}

/** Seed a scenario into an empty db. Returns the session to start signed in with, if any. */
export function seedScenario(scenario: DataScenario): { sessionId?: ID } {
  faker.seed(20261023);
  const busy = scenario === "busy";
  const empty = scenario === "empty";

  const org = seedOrg("Halvorsen Lab", "halvorsen-lab");
  const people = empty ? PEOPLE.slice(0, 1) : busy ? PEOPLE : PEOPLE.slice(0, 6);
  const users = seedUsers(people);
  users.forEach((u) => seedPrefs(u.id));
  const roles = new Map(users.map((u, i) => [u.id, people[i].role]));

  if (empty) {
    const ws = db.t.workspaces.put({ id: uuidv7(), orgId: org.id, name: "General", slug: "general", archived: false, allOrgMembers: true });
    membership(org.id, users[0].id, "owner", [ws.id]);
    seedTags(org.id, 0);
    return { sessionId: signIn(users[0].id) };
  }

  const detector = db.t.workspaces.put({ id: uuidv7(), orgId: org.id, name: "Detector Group", slug: "detector", description: "Detector development, calibration, and beam tests", archived: false, allOrgMembers: true });
  const cryo = db.t.workspaces.put({ id: uuidv7(), orgId: org.id, name: "Cryogenics", slug: "cryo", description: "Cryostat operations and upgrades", archived: false, allOrgMembers: false });
  const general = db.t.workspaces.put({ id: uuidv7(), orgId: org.id, name: "General", slug: "general", archived: false, allOrgMembers: true });
  db.t.workspaces.put({ id: uuidv7(), orgId: org.id, name: "Beam Test 2024", slug: "beam-2024", archived: true, allOrgMembers: true });

  const cryoMembers = new Set(users.filter((_, i) => [0, 1, 4, 6].includes(i)).map((u) => u.id));
  users.forEach((u) => membership(org.id, u.id, roles.get(u.id)!, cryoMembers.has(u.id) ? [cryo.id] : []));

  const tags = seedTags(org.id, busy ? 32 : 0);
  const assets = seedAssets(org.id);
  const ctx: SeedCtx = { orgId: org.id, users, roles, tagIds: tags.ids, tagByName: tags.byName, workspaceIds: [detector.id, cryo.id, general.id], assets };

  const authors = users.filter((u) => roles.get(u.id) !== "viewer");
  const sampleDate = makeDateSampler(busy ? 3 : 0.25);
  const total = busy ? 5000 : 20;
  const posts: PostRow[] = [];
  for (let i = 0; i < total; i++) {
    const r = faker.number.float();
    const ws = r < 0.7 ? detector : r < 0.9 ? cryo : general;
    const pool = ws.id === cryo.id ? authors.filter((u) => cryoMembers.has(u.id)) : authors;
    posts.push(makePost(ctx, { workspaceId: ws.id, author: faker.helpers.arrayElement(pool), workDate: sampleDate(), imageProbability: busy ? 0.08 : 0.6 }));
  }

  // States: a few hidden, deleted, and drafts (drafts belong to their author only).
  faker.helpers.arrayElements(posts, busy ? 60 : 1).forEach((p) => {
    p.visibility = "hidden";
    p.hiddenReason = "Superseded by a later run";
    p.hiddenBy = users[1].id;
    p.hiddenAt = new Date().toISOString();
  });
  faker.helpers.arrayElements(posts.filter((p) => p.visibility === "visible"), busy ? 20 : 1).forEach((p) => (p.deletedAt = new Date(Date.now() - 2 * 86_400_000).toISOString()));
  for (const u of authors.slice(0, 3)) {
    makePost(ctx, { workspaceId: detector.id, author: u, workDate: todayISO(), imageProbability: 0.5, status: "draft", title: `Draft: ${faker.helpers.arrayElement(SUBJECTS)} notes` });
  }

  seedComments(ctx, posts, busy ? 0.2 : 0.5);

  // Hand-written discussion fixtures on the most recent visible posts (§A6 v3 mock supplies).
  const visible = posts.filter((p) => p.visibility === "visible" && !p.deletedAt).sort((a, b) => b.workDate.localeCompare(a.workDate));
  const [deepPost, bigPost, pinPost] = visible.filter((p) => p.workspaceId === detector.id);
  const [dana, marcus, priya] = users;
  if (deepPost) {
    let parent: CommentRow | undefined;
    const lines = ["Why is the drift larger on the east side?", "Probably the cold head is closer there.", "Then we should see it in the temperature log too.", "We do, about 0.2 K difference.", "Can we model that in the simulation?", "Yes, I'll add it this week."];
    lines.forEach((t, i) => {
      parent = makeComment(deepPost, authors[i % authors.length], (i + 1) * 30, t, parent?.id, { isQuestion: i === 0 });
    });
    const m = makeComment(deepPost, marcus, 400, "", undefined);
    db.t.comments.update(m.id, { doc: mentionDoc("Looping in ", priya, " since this touches the calibration constants.") });
    db.t.notifications.put({ id: uuidv7(), userId: priya.id, kind: "mention", postId: deepPost.id, commentId: m.id, actorId: marcus.id, workspaceId: deepPost.workspaceId, createdAt: m.createdAt });
    deepPost.counts.comments += lines.length + 1;
  }
  if (bigPost && !busy) {
    for (let i = 0; i < 200; i++) {
      makeComment(bigPost, authors[i % authors.length], i * 3, `${faker.helpers.arrayElement(COMMENT_LINES)} (${i + 1})`);
    }
    bigPost.counts.comments += 200;
  }
  if (pinPost) {
    const imgBlock = pinPost.blocks.find((b) => b.type === "image");
    if (imgBlock && imgBlock.type === "image") {
      makeComment(pinPost, dana, 60, "This bump is where the pump kicked in.", undefined, { anchor: { imageInstanceId: imgBlock.imageInstanceId, x: 0.42, y: 0.35 } });
      pinPost.counts.comments += 1;
    }
  }
  const reply = deepPost ? db.t.comments.find((c) => c.postId === deepPost.id && c.authorId !== priya.id && !!c.parentId) : undefined;
  if (reply && deepPost) db.t.notifications.put({ id: uuidv7(), userId: priya.id, kind: "reply", postId: deepPost.id, commentId: reply.id, actorId: reply.authorId, workspaceId: deepPost.workspaceId, createdAt: reply.createdAt });

  // An imported deck collection (§W5.4 provenance).
  const deckPosts = visible.filter((p) => p.workspaceId === detector.id).slice(-6);
  const coll = db.t.collections.put({ id: uuidv7(), workspaceId: detector.id, name: "Lab_Notes_2022.pptx", kind: "deck_import", postIds: deckPosts.map((p) => p.id), createdBy: dana.id, updatedAt: new Date(Date.now() - 86_400_000 * 30).toISOString() });
  deckPosts.forEach((p, i) => {
    p.collectionIds = [coll.id];
    p.source = { kind: "import", importJobId: uuidv7(), fileName: "Lab_Notes_2022.pptx", fileSha256: hashHex("deck"), slide: i + 1, slideCount: deckPosts.length };
    p.workDateSource = i % 2 ? "guessed" : "import_fallback";
  });

  // Saved views, collections, notebooks — with realistic volume in the busy scenario (scale), and
  // per-user pins for the rail.
  const t0 = Date.now();
  const calib = tags.byName.get("calibration");
  if (calib) {
    db.t.savedViews.put({ id: uuidv7(), workspaceId: detector.id, ownerId: dana.id, name: "Calibration, last 90 days", filterSpec: { all: [{ field: "tag", op: "in", value: [calib] }, { field: "workDate", op: "between", value: { preset: "last_90_days" } }] }, shared: true, pinned: false, updatedAt: new Date(t0 - 3_600_000).toISOString() });
  }
  db.t.savedViews.put({ id: uuidv7(), workspaceId: detector.id, ownerId: dana.id, name: "Open questions", filterSpec: { all: [{ field: "unansweredQuestion", op: "eq", value: true }] }, shared: true, pinned: false, updatedAt: new Date(t0 - 7_200_000).toISOString() });
  if (busy) {
    const visibleIds = visible.filter((p) => p.workspaceId === detector.id).map((p) => p.id);
    tags.ids.slice(0, 50).forEach((tagId, i) => {
      const author = authors[i % authors.length];
      const name = db.t.tags.get(tagId)!.name;
      db.t.savedViews.put({ id: uuidv7(), workspaceId: detector.id, ownerId: author.id, name: `${name} ${["this quarter", "last 30 days", "with images", "questions", "this year"][i % 5]}`, filterSpec: { all: [{ field: "tag", op: "in", value: [tagId] }] }, shared: i % 3 !== 0, pinned: false, updatedAt: new Date(t0 - i * 86_400_000 * 2).toISOString() });
    });
    for (let i = 0; i < 110; i++) {
      const notebook = i < 30;
      const postIds = faker.helpers.arrayElements(visibleIds, faker.number.int({ min: 3, max: notebook ? 60 : 25 }));
      const c = db.t.collections.put({
        id: uuidv7(),
        workspaceId: detector.id,
        name: notebook ? `${faker.helpers.arrayElement(SUBJECTS)} notebook ${i + 1}` : `${faker.helpers.arrayElement(["Group meeting", "Review", "Beam test", "Paper figures", "Run plan"])} ${2024 + (i % 3)}-${String((i % 12) + 1).padStart(2, "0")}`,
        kind: "notebook", // hand-picked groups are notebooks (owner decision)
        postIds,
        createdBy: authors[i % authors.length].id,
        updatedAt: new Date(t0 - i * 86_400_000).toISOString(),
      });
      postIds.forEach((pid) => {
        const p = db.t.posts.get(pid);
        if (p) p.collectionIds = [...(p.collectionIds ?? []), c.id];
      });
    }
  }
  // Everyone starts with the two shared views and the imported deck pinned.
  const sharedViews = db.t.savedViews.filter((v) => v.workspaceId === detector.id && (v.name === "Calibration, last 90 days" || v.name === "Open questions")).map((v) => ({ kind: "view" as const, id: v.id }));
  users.forEach((u) => db.setMeta(`pins:${u.id}:${detector.id}`, [...sharedViews, { kind: "collection", id: coll.id }]));

  // Invites for the v1 flows: valid, expired, revoked.
  const inviteBase = { orgId: org.id, role: "member" as OrgRole, workspaceIds: [detector.id], invitedBy: dana.id, createdAt: new Date().toISOString() };
  db.t.invites.put({ ...inviteBase, id: uuidv7(), email: "jordan.blake@halvorsen-lab.example", name: "Jordan Blake", token: "demo-invite", status: "pending", expiresAt: addDays(todayISO(), 7) + "T00:00:00Z" });
  db.t.invites.put({ ...inviteBase, id: uuidv7(), email: "old.invite@halvorsen-lab.example", token: "expired-invite", status: "pending", expiresAt: addDays(todayISO(), -3) + "T00:00:00Z" });
  db.t.invites.put({ ...inviteBase, id: uuidv7(), email: "revoked@halvorsen-lab.example", token: "revoked-invite", status: "revoked", expiresAt: addDays(todayISO(), 7) + "T00:00:00Z" });

  // Persist mutated rows (counts, states) — makePost/makeComment already put the originals.
  posts.forEach((p) => db.t.posts.put(p));

  if (scenario === "multiOrg") {
    const org2 = seedOrg("Northfield Cryogenics", "northfield");
    const ws2 = db.t.workspaces.put({ id: uuidv7(), orgId: org2.id, name: "Test Stand", slug: "test-stand", archived: false, allOrgMembers: true });
    membership(org2.id, priya.id, "member", [ws2.id]);
    const t2 = seedTags(org2.id, 0);
    const assets2 = seedAssets(org2.id);
    const ctx2: SeedCtx = { ...ctx, orgId: org2.id, users: [priya], tagIds: t2.ids, tagByName: t2.byName, workspaceIds: [ws2.id], assets: assets2 };
    for (let i = 0; i < 8; i++) makePost(ctx2, { workspaceId: ws2.id, author: priya, workDate: sampleDate(), imageProbability: 0.5 });
    db.setMeta(`lastWs:${priya.id}`, detector.id);
    return { sessionId: signIn(priya.id) };
  }
  if (scenario === "viewer") return { sessionId: signIn(users[3].id) };
  return { sessionId: signIn(dana.id) };
}
