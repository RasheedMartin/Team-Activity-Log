import type { Collection, CollectionRole, ID } from "../../api/contract";
import { db } from "../db";
import { fail, type OrgCtx } from "../server";

// Mirrors backend/src/tal/collection_access.py: everyone in the workspace views; editors change
// contents; owners also share and delete. The creator is an owner; everyone else (admins too) views
// until an owner grants more. Grants live on the collection row (`members`, creator excluded).

const ROLES: CollectionRole[] = ["viewer", "editor", "owner"];
const granted = (c: Collection) => (db.t.collections.get(c.id)?.members ?? []).filter((m) => m.userId !== c.createdBy && m.role !== "viewer");

export function roleIn(ctx: Pick<OrgCtx, "user" | "role">, c: Collection): CollectionRole {
  if (c.createdBy === ctx.user.id) return "owner";
  if (ctx.role === "viewer") return "viewer";
  return granted(c).find((m) => m.userId === ctx.user.id)?.role ?? "viewer";
}

export function requireRole(ctx: Pick<OrgCtx, "user" | "role">, c: Collection, atLeast: CollectionRole) {
  if (ROLES.indexOf(roleIn(ctx, c)) < ROLES.indexOf(atLeast)) {
    const what = c.kind === "notebook" ? "notebook" : "collection";
    fail(403, "forbidden", atLeast === "editor" ? `You can view this ${what}; ask its owner to make you an editor` : `Only an owner of this ${what} can do that`);
  }
}

export const membersOf = (c: Collection) => [{ userId: c.createdBy, role: "owner" as CollectionRole }, ...granted(c)];

export function setMembers(c: Collection, members: { userId: ID; role: CollectionRole }[]) {
  db.t.collections.update(c.id, { members: members.filter((x) => x.userId !== c.createdBy && x.role !== "viewer") });
}
