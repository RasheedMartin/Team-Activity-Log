import Dexie from "dexie";
import type {
  Asset,
  Collection,
  Comment,
  DevEmail,
  ID,
  ImageInstance,
  ImportJob,
  Invite,
  InviteLink,
  Membership,
  Notification,
  Organization,
  Post,
  PostRevision,
  SavedView,
  Tag,
  TagGroup,
  User,
  UserPreferences,
  Workspace,
} from "../api/contract";

// The mock server's "Postgres": rows live in memory (fast search over 5,000 posts) and are
// written through to IndexedDB so everything survives reloads (§A3).

export interface UserRow extends User {
  password: string; // mock only — never stored like this for real
  verified: boolean;
  deactivatedAt?: string;
}
export interface PrefsRow extends UserPreferences {
  id: ID; // = userId
}
export interface MembershipRow extends Omit<Membership, "user"> {
  id: ID;
  userId: ID;
}
export interface TagRow extends Tag {
  orgId: ID;
}
export interface TagGroupRow extends TagGroup {
  orgId: ID;
}
export interface InviteRow extends Invite {
  token: string;
  name?: string;
}
export interface SessionRow {
  id: ID;
  userId: ID;
  device: string;
  ip: string;
  createdAt: string;
  revokedAt?: string;
}
export interface PostRow extends Post {
  /** Mock index lag: hidden from search until this time (§A3 mock-index-lag). */
  indexedAt?: number;
}
export interface RevisionRow extends PostRevision {
  id: ID;
  postId: ID;
}
export interface AssetRow extends Asset {
  orgId: ID;
  blob?: Blob; // uploaded files; served through object URLs regenerated on load
}
export interface CommentRow extends Comment {
  workspaceId: ID;
}
export interface NotificationRow extends Notification {
  userId: ID;
}
export interface MetaRow {
  id: string;
  value: unknown;
}
export interface ImportJobRow extends ImportJob {
  userId: ID;
  orgId: ID;
  /** The uploaded deck, in "temp storage" until commit (§W5.4: originals aren't retained). */
  sourceBlob?: Blob;
}
export interface DraftOrderRow {
  id: ID;
}

interface Rows {
  users: UserRow;
  prefs: PrefsRow;
  orgs: Organization;
  memberships: MembershipRow;
  workspaces: Workspace;
  invites: InviteRow;
  inviteLinks: InviteLink;
  sessions: SessionRow;
  tagGroups: TagGroupRow;
  tags: TagRow;
  posts: PostRow;
  revisions: RevisionRow;
  assets: AssetRow;
  images: ImageInstance;
  comments: CommentRow;
  notifications: NotificationRow;
  savedViews: SavedView;
  collections: Collection;
  importJobs: ImportJobRow;
  emails: DevEmail;
  meta: MetaRow;
}
export type TableName = keyof Rows;
const TABLES: TableName[] = [
  "users",
  "prefs",
  "orgs",
  "memberships",
  "workspaces",
  "invites",
  "inviteLinks",
  "sessions",
  "tagGroups",
  "tags",
  "posts",
  "revisions",
  "assets",
  "images",
  "comments",
  "notifications",
  "savedViews",
  "collections",
  "importJobs",
  "emails",
  "meta",
];

class Persist extends Dexie {
  constructor() {
    super("tal-mock");
    this.version(1).stores(Object.fromEntries(TABLES.map((t) => [t, "id"])));
  }
}

export class Table<T extends { id: string }> {
  readonly rows = new Map<string, T>();
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private readonly name: string;
  private readonly onChange: () => void;
  constructor(name: string, onChange: () => void) {
    this.name = name;
    this.onChange = onChange;
  }
  get(id: string | undefined) {
    return id ? this.rows.get(id) : undefined;
  }
  all() {
    return [...this.rows.values()];
  }
  filter(fn: (r: T) => boolean) {
    return this.all().filter(fn);
  }
  find(fn: (r: T) => boolean) {
    for (const r of this.rows.values()) if (fn(r)) return r;
    return undefined;
  }
  put(row: T) {
    this.rows.set(row.id, row);
    this.dirty.add(row.id);
    this.removed.delete(row.id);
    this.onChange();
    return row;
  }
  update(id: string, patch: Partial<T>) {
    const cur = this.rows.get(id);
    if (!cur) return undefined;
    return this.put({ ...cur, ...patch });
  }
  delete(id: string) {
    this.rows.delete(id);
    this.dirty.delete(id);
    this.removed.add(id);
    this.onChange();
  }
  /** Apply another tab's committed writes without re-persisting them. */
  applyRemote(puts: T[], dels: string[]) {
    for (const r of puts) this.rows.set(r.id, r);
    for (const id of dels) this.rows.delete(id);
  }
  /** Bulk load without marking dirty (used when hydrating from IndexedDB). */
  load(rows: T[]) {
    for (const r of rows) this.rows.set(r.id, r);
  }
  takeChanges() {
    const puts = [...this.dirty].map((id) => this.rows.get(id)!).filter(Boolean);
    const dels = [...this.removed];
    this.dirty.clear();
    this.removed.clear();
    return { puts, dels, name: this.name };
  }
}

type Tables = { [K in TableName]: Table<Rows[K]> };

type ChannelMsg =
  | { type: "changes"; changes: { name: TableName; puts: { id: string }[]; dels: string[] }[] }
  | { type: "event"; workspaceId: string; event: unknown }
  | { type: "reset" };

class MockDb {
  readonly persist = new Persist();
  readonly t: Tables;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  // Every tab runs its own copy of the mock server; this channel makes them act like one
  // shared server (writes and live events reach all tabs, a scenario switch reloads them).
  private channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tal-mock") : null;
  private remoteChange: ((name: TableName, ids: string[]) => void)[] = [];
  private remoteEvent: ((workspaceId: string, event: unknown) => void)[] = [];

  constructor() {
    const schedule = () => this.scheduleFlush();
    this.t = Object.fromEntries(TABLES.map((n) => [n, new Table(n, schedule)])) as unknown as Tables;
    if (this.channel)
      this.channel.onmessage = (e: MessageEvent<ChannelMsg>) => {
        const msg = e.data;
        if (msg.type === "reset") location.reload();
        else if (msg.type === "event") this.remoteEvent.forEach((fn) => fn(msg.workspaceId, msg.event));
        else
          for (const c of msg.changes) {
            (this.t[c.name] as Table<{ id: string }>).applyRemote(c.puts, c.dels);
            this.remoteChange.forEach((fn) => fn(c.name, [...c.puts.map((r) => r.id), ...c.dels]));
          }
      };
  }

  onRemoteChange(fn: (name: TableName, ids: string[]) => void) {
    this.remoteChange.push(fn);
  }
  onRemoteEvent(fn: (workspaceId: string, event: unknown) => void) {
    this.remoteEvent.push(fn);
  }
  broadcastEvent(workspaceId: string, event: unknown) {
    this.channel?.postMessage({ type: "event", workspaceId, event } satisfies ChannelMsg);
  }
  /** Tell other tabs the whole store was replaced (scenario switch). */
  announceReset() {
    this.channel?.postMessage({ type: "reset" } satisfies ChannelMsg);
  }

  async load() {
    await Promise.all(
      TABLES.map(async (n) => {
        const rows = await this.persist.table(n).toArray();
        (this.t[n] as Table<{ id: string }>).load(rows);
      }),
    );
  }

  isEmpty() {
    return this.t.users.rows.size === 0;
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 50);
  }

  async flush() {
    const changes = TABLES.map((n) => (this.t[n] as Table<{ id: string }>).takeChanges());
    // Dexie's PromiseExtended typing recurses too deeply for tsc here; a plain signature is enough.
    const tx = this.persist.transaction.bind(this.persist) as unknown as (mode: "rw", tables: string[], fn: () => Promise<void>) => Promise<void>;
    this.flushing = this.flushing.then(() =>
      tx("rw", TABLES, async () => {
        for (const c of changes) {
          if (c.puts.length) await this.persist.table(c.name).bulkPut(c.puts);
          if (c.dels.length) await this.persist.table(c.name).bulkDelete(c.dels);
        }
      }),
    );
    await this.flushing;
    const changed = changes.filter((c) => c.puts.length || c.dels.length);
    if (changed.length) this.channel?.postMessage({ type: "changes", changes: changed } as ChannelMsg);
  }

  async wipe() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const n of TABLES) {
      const table = this.t[n] as Table<{ id: string }>;
      table.rows.clear();
      table.takeChanges();
    }
    await Promise.all(TABLES.map((n) => this.persist.table(n).clear()));
  }

  meta<T>(key: string): T | undefined {
    return this.t.meta.get(key)?.value as T | undefined;
  }
  setMeta(key: string, value: unknown) {
    this.t.meta.put({ id: key, value });
  }
}

export const db = new MockDb();
