import type { Collection, CollectionRole, ID } from "../../api/contract";
import { db } from "../db";
import { fail, type OrgCtx } from "../server";

// Mirrors backend/src/tal/collection_access.py: everyone in the workspace views; editors change
// contents; owners also share and delete. The creator is an owner; everyone else (admins too) views
// until an owner grants more. Grants live on the collection row (`members`, creator excluded).

const ROLES: (CollectionRole | "none")[] = ["none", "viewer", "editor", "owner"];
const granted = (c: Collection) => (db.t.collections.get(c.id)?.members ?? []).filter((m) => m.userId !== c.createdBy);

/** "none": a collection shared with specific people, and you aren't one of them. */
export function roleIn(ctx: Pick<OrgCtx, "user" | "role">, c: Collection): CollectionRole | "none" {
  if (c.createdBy === ctx.user.id) return "owner";
  const g = granted(c).find((m) => m.userId === ctx.user.id)?.role ?? (c.visibility === "people" ? "none" : "viewer");
  return ctx.role === "viewer" && g !== "none" ? "viewer" : g;
}
export const sharedWith = (c: Collection, me: string) => c.createdBy !== me && granted(c).some((m) => m.userId === me);

export function requireRole(ctx: Pick<OrgCtx, "user" | "role">, c: Collection, atLeast: CollectionRole) {
  if (ROLES.indexOf(roleIn(ctx, c)) < ROLES.indexOf(atLeast)) {
    const what = c.kind === "notebook" ? "notebook" : "collection";
    fail(403, "forbidden", atLeast === "editor" ? `You can view this ${what}; ask its owner to make you an editor` : `Only an owner of this ${what} can do that`);
  }
}

export const membersOf = (c: Collection) => [{ userId: c.createdBy, role: "owner" as CollectionRole }, ...granted(c)];

export function setMembers(c: Collection, members: { userId: ID; role: CollectionRole }[]) {
  const visibility = db.t.collections.get(c.id)?.visibility;
  db.t.collections.update(c.id, { members: members.filter((x) => x.userId !== c.createdBy && (x.role !== "viewer" || visibility === "people")) });
}
