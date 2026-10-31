import type { AlertMode, ID } from "../api/contract";
import { uuidv7 } from "../lib/ids";
import { db } from "./db";
import { sendEmail } from "./handlers/auth";
import { engine, roleAtLeast } from "./server";

// Mirrors backend/src/tal/alerts.py: follow a saved search; posts published since the last check
// that match it (run as the subscriber, your own posts excluded) become an Activity item, plus an
// email digest for daily and weekly alerts. The mock runs a round whenever Activity is fetched
// (the app polls it every minute), in place of the server's background loop.

interface AlertRow {
  viewId: ID;
  userId: ID;
  mode: AlertMode;
  checkedAt: string;
  recentIds: ID[];
}

const KEY = "searchAlerts";
const DAY = 86_400_000;
const EVERY: Record<AlertMode, number> = { instant: 0, daily: DAY, weekly: 7 * DAY };
const LAG = 10 * 60_000;
const MAX_LISTED = 10;

const all = () => db.meta<AlertRow[]>(KEY) ?? [];
const save = (rows: AlertRow[]) => db.setMeta(KEY, rows);

export const alertFor = (viewId: ID, userId: ID): AlertMode | undefined => all().find((a) => a.viewId === viewId && a.userId === userId)?.mode;

export function setAlert(viewId: ID, userId: ID, mode: AlertMode | "off") {
  const rest = all().filter((a) => !(a.viewId === viewId && a.userId === userId));
  const cur = all().find((a) => a.viewId === viewId && a.userId === userId);
  if (mode === "off") return save(rest);
  save([...rest, cur ? { ...cur, mode } : { viewId, userId, mode, checkedAt: new Date().toISOString(), recentIds: [] }]);
}

/** One round over the alerts that are due. Returns how many new posts were reported. */
export function runAlerts(at = new Date()): number {
  let total = 0;
  const rows = all();
  // Like the server: only workspaces with something published lately are searched at all.
  const latest = new Map<ID, string>();
  for (const p of db.t.posts.rows.values()) if (p.status === "published" && !p.deletedAt && p.publishedAt && p.publishedAt > (latest.get(p.workspaceId) ?? "")) latest.set(p.workspaceId, p.publishedAt);
  const next = rows.map((a) => {
    if (at.getTime() - Date.parse(a.checkedAt) < EVERY[a.mode]) return a;
    const v = db.t.savedViews.get(a.viewId);
    const user = db.t.users.get(a.userId);
    const ws = v ? db.t.workspaces.get(v.workspaceId) : undefined;
    const since = new Date(Date.parse(a.checkedAt) - LAG).toISOString();
    const done = { ...a, checkedAt: at.toISOString() };
    if (!v || !user || !ws || !(latest.get(ws.id)! > since)) return { ...done, recentIds: [] };
    const m = db.t.memberships.find((x) => x.orgId === ws.orgId && x.userId === user.id && x.status === "active");
    const canSee = !!m && (v.shared || v.ownerId === user.id) && (roleAtLeast(m.role, "admin") || ws.allOrgMembers || m.workspaceIds.includes(ws.id));
    if (!canSee) return done;
    const { cursor: _c, ...spec } = v.filterSpec;
    void _c;
    const hits = engine
      .search({ ...spec, sort: "newest", limit: 100 }, { orgId: ws.orgId, workspaceIds: [ws.id], me: user.id, canSeeHidden: roleAtLeast(m!.role, "admin"), now: at })
      .hits.map((h) => h.post)
      .filter((p) => (p.publishedAt ?? "") > since && p.authorId !== user.id && !p.coAuthorIds.includes(user.id));
    const fresh = hits.filter((p) => !a.recentIds.includes(p.id));
    done.recentIds = hits.filter((p) => (p.publishedAt ?? "") > new Date(at.getTime() - LAG).toISOString()).map((p) => p.id);
    if (!fresh.length) return done;
    total += fresh.length;
    db.t.notifications.put({ id: uuidv7(), userId: user.id, kind: "alert", postId: fresh[0].id, savedViewId: v.id, count: fresh.length, workspaceId: ws.id, createdAt: at.toISOString() });
    if (a.mode !== "instant") {
      const org = db.t.orgs.get(ws.orgId);
      const lines = [`${fresh.length} new post${fresh.length === 1 ? "" : "s"} ${a.mode === "daily" ? "today" : "this week"} match your saved search “${v.name}”:`, "", ...fresh.slice(0, MAX_LISTED).map((p) => `• ${p.title || "Untitled"}`)];
      if (fresh.length > MAX_LISTED) lines.push(`…and ${fresh.length - MAX_LISTED} more.`);
      lines.push("", `Change or stop this alert from the saved search in ${ws.name}.`);
      sendEmail(user.email, `${fresh.length} new in “${v.name}”`, lines.join("\n"), `/o/${org?.slug}/w/${ws.slug}/search?view=${v.id}`);
    }
    return done;
  });
  save(next);
  return total;
}
