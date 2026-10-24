import { useParams } from "react-router-dom";
import type { MeResponse, OrgRole, Organization, Workspace } from "../api/contract";
import { useMe } from "../api/hooks";

export const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const can = (role: OrgRole | undefined, min: OrgRole) => !!role && ROLE_RANK[role] >= ROLE_RANK[min];

export interface OrgScope {
  me: MeResponse;
  org: Organization;
  role: OrgRole;
  workspaces: Workspace[];
}
export interface WorkspaceScope extends OrgScope {
  ws: Workspace;
}

/** Resolve `/o/:org` from the signed-in user's memberships. Undefined while loading or not a member. */
export function useOrgScope(): OrgScope | undefined {
  const { org: slug } = useParams();
  const { data: me } = useMe();
  const entry = me?.orgs.find((o) => o.org.slug === slug);
  if (!me || !entry) return undefined;
  return { me, org: entry.org, role: entry.role, workspaces: entry.workspaces };
}

export function useWorkspaceScope(): WorkspaceScope | undefined {
  const scope = useOrgScope();
  const { ws: slug } = useParams();
  const ws = scope?.workspaces.find((w) => w.slug === slug);
  return scope && ws ? { ...scope, ws } : undefined;
}

/** Same as useWorkspaceScope but for components that only render inside a resolved workspace. */
export function useWs(): WorkspaceScope {
  const s = useWorkspaceScope();
  if (!s) throw new Error("useWs used outside a resolved workspace route");
  return s;
}

export const wsPath = (org: Organization, ws: Workspace, rest = "") => `/o/${org.slug}/w/${ws.slug}${rest}`;

/** Where to send a signed-in user who has no specific destination (§W1.6: remember last used). */
export function homePath(me: MeResponse): string {
  const all = me.orgs.flatMap((o) => o.workspaces.filter((w) => !w.archived).map((w) => ({ org: o.org, ws: w })));
  const pick =
    all.find((x) => x.ws.id === me.lastWorkspaceId) ??
    all.find((x) => x.ws.id === me.preferences.defaultWorkspaceId) ??
    (me.orgs.length === 1 ? all[0] : undefined);
  if (pick) return wsPath(pick.org, pick.ws);
  if (me.orgs.length === 1) return `/o/${me.orgs[0].org.slug}`;
  if (me.orgs.length === 0) return "/new-org";
  return "/orgs";
}
