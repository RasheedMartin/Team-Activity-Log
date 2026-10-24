import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, del, get, patch, post, put } from "./client";
import type {
  Collection,
  Comment,
  DevEmail,
  DraftSummary,
  FilterSpec,
  ID,
  ImageView,
  ImportItem,
  ImportJob,
  ImportMode,
  Invite,
  InviteLink,
  MeResponse,
  Membership,
  Notification,
  Organization,
  OrgRole,
  Post,
  PostDetail,
  PostPatch,
  PostRevision,
  SavedView,
  SearchResponse,
  Session,
  Shape,
  SuggestResponse,
  Tag,
  TagGroup,
  User,
  UserPreferences,
  Workspace,
} from "./contract";
import { normalize } from "../lib/filterSpec";

// Query keys: everything tenant-scoped starts with ["org", orgId] so switching orgs is clean.
export const qk = {
  me: ["me"] as const,
  org: (orgId: ID) => ["org", orgId] as const,
  people: (orgId: ID) => ["org", orgId, "people"] as const,
  members: (orgId: ID) => ["org", orgId, "members"] as const,
  invites: (orgId: ID) => ["org", orgId, "invites"] as const,
  inviteLinks: (orgId: ID) => ["org", orgId, "inviteLinks"] as const,
  workspaces: (orgId: ID) => ["org", orgId, "workspaces"] as const,
  tags: (orgId: ID) => ["org", orgId, "tags"] as const,
  post: (orgId: ID, id: ID) => ["org", orgId, "post", id] as const,
  revisions: (orgId: ID, id: ID) => ["org", orgId, "post", id, "revisions"] as const,
  comments: (orgId: ID, postId: ID) => ["org", orgId, "post", postId, "comments"] as const,
  drafts: (orgId: ID, wsId: ID) => ["org", orgId, "ws", wsId, "drafts"] as const,
  trash: (orgId: ID, wsId: ID) => ["org", orgId, "ws", wsId, "trash"] as const,
  search: (orgId: ID, wsId: ID, spec?: FilterSpec) =>
    spec ? (["org", orgId, "ws", wsId, "search", normalize(spec)] as const) : (["org", orgId, "ws", wsId, "search"] as const),
  suggest: (orgId: ID, wsId: ID, q: string) => ["org", orgId, "ws", wsId, "suggest", q] as const,
  views: (orgId: ID, wsId: ID) => ["org", orgId, "ws", wsId, "views"] as const,
  collections: (orgId: ID, wsId: ID) => ["org", orgId, "ws", wsId, "collections"] as const,
  notifications: (orgId: ID) => ["org", orgId, "notifications"] as const,
  image: (orgId: ID, id: ID) => ["org", orgId, "image", id] as const,
  importJob: (orgId: ID, id: ID) => ["org", orgId, "import", id] as const,
  sessions: ["me", "sessions"] as const,
};

const O = (orgId: ID) => `/orgs/${orgId}`;
const W = (orgId: ID, wsId: ID) => `/orgs/${orgId}/workspaces/${wsId}`;

// ---- identity ----

export const useMe = () =>
  useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => get<MeResponse>("/me", signal),
    retry: (n, err) => (err as { status?: number }).status !== 401 && n < 2,
    staleTime: 5 * 60_000,
  });

function useSetsMe<V>(fn: (v: V) => Promise<MeResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (me) => {
      // A different identity may now be signed in: drop all tenant data.
      qc.removeQueries({ queryKey: ["org"] });
      qc.setQueryData(qk.me, me);
    },
  });
}

export const useLogin = () => useSetsMe((v: { email: string; password: string }) => post<MeResponse>("/auth/login", v));
export const useRegister = () => useSetsMe((v: { name: string; email: string; password: string }) => post<MeResponse>("/auth/register", v));
export const useVerifyEmail = () => useSetsMe((token: string) => post<MeResponse>(`/auth/verify/${token}`));
export const useMagicSignIn = () => useSetsMe((token: string) => post<MeResponse>(`/auth/magic/${token}`));
export const useResetPassword = () => useSetsMe((v: { token: string; password: string }) => post<MeResponse>(`/auth/reset/${v.token}`, { password: v.password }));
export const useSignInAs = () => useSetsMe((userId: ID) => post<MeResponse>("/dev/sign-in-as", { userId }));
export const useMagicLink = () => useMutation({ mutationFn: (email: string) => post<void>("/auth/magic-link", { email }) });
export const useForgotPassword = () => useMutation({ mutationFn: (email: string) => post<void>("/auth/forgot", { email }) });

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<void>("/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(qk.me, null);
    },
  });
}

export const useUpdateProfile = () =>
  useSetsMe((v: Partial<Pick<User, "name" | "title" | "bio" | "pronouns" | "timezone" | "avatarUrl">>) => patch<MeResponse>("/me", v));

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: UserPreferences) => put<MeResponse>("/me/preferences", prefs),
    onMutate: async (prefs) => {
      // Theme and density apply immediately (§W1 done-when).
      await qc.cancelQueries({ queryKey: qk.me });
      const prev = qc.getQueryData<MeResponse>(qk.me);
      if (prev) qc.setQueryData(qk.me, { ...prev, preferences: prefs });
      return { prev };
    },
    onError: (_e, _v, c) => c?.prev && qc.setQueryData(qk.me, c.prev),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}

export const useChangePassword = () => useMutation({ mutationFn: (v: { current: string; next: string }) => put<void>("/me/password", v) });
export const useRememberWorkspace = () => useMutation({ mutationFn: (workspaceId: ID) => post<void>("/me/last-workspace", { workspaceId }) });
export const useSessions = () => useQuery({ queryKey: qk.sessions, queryFn: ({ signal }) => get<Session[]>("/me/sessions", signal) });
export function useRevokeSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: ID) => (id ? del(`/me/sessions/${id}`) : del("/me/sessions")),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}
export const useExportMyData = () => useMutation({ mutationFn: () => post<{ status: string }>("/me/export") });
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => del("/me"), onSuccess: () => (qc.clear(), qc.setQueryData(qk.me, null)) });
}

// ---- orgs, members, invites ----

export const useSlugAvailable = (slug: string) =>
  useQuery({
    queryKey: ["slug", slug],
    queryFn: ({ signal }) => get<{ slug: string; available: boolean }>(`/orgs/slug-available?slug=${encodeURIComponent(slug)}`, signal),
    enabled: slug.length > 0,
    staleTime: 10_000,
  });
export function useRenameOrg(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => patch<Organization>(`${O(orgId)}`, { name }), onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }) });
}
export const useCreateOrg = () => useSetsMe((v: { name: string; slug: string; workspaceName?: string }) => post<MeResponse>("/orgs", v));

export const usePeople = (orgId: ID) =>
  useQuery({ queryKey: qk.people(orgId), queryFn: ({ signal }) => get<User[]>(`${O(orgId)}/people`, signal), staleTime: 5 * 60_000 });
export const useMembers = (orgId: ID) =>
  useQuery({ queryKey: qk.members(orgId), queryFn: ({ signal }) => get<Membership[]>(`${O(orgId)}/members`, signal) });

export function useUpdateMember(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: ID; role?: OrgRole; status?: "active" | "deactivated"; workspaceIds?: ID[] }) =>
      patch<Membership>(`${O(orgId)}/members/${userId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(orgId) });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
export function useRemoveMember(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (userId: ID) => del(`${O(orgId)}/members/${userId}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(orgId) }) });
}
export function useTransferOwnership(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: ID) => post<void>(`${O(orgId)}/transfer`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(orgId) });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
export const useInvites = (orgId: ID, enabled = true) =>
  useQuery({ queryKey: qk.invites(orgId), queryFn: ({ signal }) => get<Invite[]>(`${O(orgId)}/invites`, signal), enabled });
export function useSendInvites(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invites: { email: string; name?: string; role: OrgRole; workspaceIds: ID[] }[]) =>
      post<{ email: string; invite?: Invite; error?: string }[]>(`${O(orgId)}/invites`, { invites }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(orgId) }),
  });
}
export function useInviteAction(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: ID; action: "resend" | "revoke" }): Promise<Invite | undefined> =>
      action === "resend" ? post<Invite>(`${O(orgId)}/invites/${id}/resend`) : del<undefined>(`${O(orgId)}/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(orgId) }),
  });
}
export const useInviteLinks = (orgId: ID, enabled = true) =>
  useQuery({ queryKey: qk.inviteLinks(orgId), queryFn: ({ signal }) => get<InviteLink[]>(`${O(orgId)}/invite-links`, signal), enabled });
export function useCreateInviteLink(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { roleCap: OrgRole; days: number }) => post<InviteLink>(`${O(orgId)}/invite-links`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.inviteLinks(orgId) }),
  });
}
export function useRevokeInviteLink(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: ID) => del(`${O(orgId)}/invite-links/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.inviteLinks(orgId) }) });
}

export interface InviteLookup {
  kind: "invite" | "link";
  org: Organization;
  email?: string;
  name?: string;
  role: OrgRole;
  status: Invite["status"];
  hasAccount?: boolean;
}
export const useInviteLookup = (token: string) =>
  useQuery({ queryKey: ["invite", token], queryFn: ({ signal }) => get<InviteLookup>(`/invites/${token}`, signal), retry: false });
export const useAcceptInvite = (token: string) =>
  useSetsMe((v: { name?: string; password?: string; email?: string }) => post<MeResponse>(`/invites/${token}/accept`, v));

export const useWorkspaces = (orgId: ID) =>
  useQuery({ queryKey: qk.workspaces(orgId), queryFn: ({ signal }) => get<Workspace[]>(`${O(orgId)}/workspaces`, signal) });
export function useSaveWorkspace(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Workspace> & { memberIds?: ID[] }) =>
      id ? patch<Workspace>(`${O(orgId)}/workspaces/${id}`, body) : post<Workspace>(`${O(orgId)}/workspaces`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.workspaces(orgId) });
      qc.invalidateQueries({ queryKey: qk.members(orgId) });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

// ---- tags ----

export const useTags = (orgId: ID) =>
  useQuery({
    queryKey: qk.tags(orgId),
    queryFn: ({ signal }) => get<{ tags: Tag[]; groups: TagGroup[] }>(`${O(orgId)}/tags`, signal),
    staleTime: 5 * 60_000,
  });
export function useCreateTag(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { name: string; groupId?: ID }) => post<Tag>(`${O(orgId)}/tags`, v), onSuccess: () => qc.invalidateQueries({ queryKey: qk.tags(orgId) }) });
}

// ---- posts ----

export const usePost = (orgId: ID, id: ID | undefined) =>
  useQuery({
    queryKey: qk.post(orgId, id ?? ""),
    queryFn: ({ signal }) => get<PostDetail>(`${O(orgId)}/posts/${id}`, signal),
    enabled: !!id,
    retry: (n, err) => ![403, 404].includes((err as { status?: number }).status ?? 0) && n < 2,
  });

/** Search caches embed post copies; after a post changes, refresh them (and re-fetch lists). */
export function invalidatePostLists(qc: QueryClient, orgId: ID) {
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "org" && q.queryKey[1] === orgId && (q.queryKey[4] === "search" || q.queryKey[4] === "drafts" || q.queryKey[4] === "trash") });
}

export function useCreateDraft(orgId: ID, wsId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seed?: Partial<Post>) => post<PostDetail>(`${W(orgId, wsId)}/posts`, seed ?? {}),
    onSuccess: (d) => {
      qc.setQueryData(qk.post(orgId, d.post.id), d);
      qc.invalidateQueries({ queryKey: qk.drafts(orgId, wsId) });
    },
  });
}

export function useUpdatePost(orgId: ID, id: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: PostPatch) => patch<PostDetail>(`${O(orgId)}/posts/${id}`, p),
    onSuccess: (d) => {
      qc.setQueryData(qk.post(orgId, id), d);
      if (d.post.status === "published") invalidatePostLists(qc, orgId);
    },
  });
}

// ---- optimistic overlay (§B6): just-published posts show at the top of the feed until search has them ----

const overlayKey = (orgId: ID, wsId: ID) => ["overlay", orgId, wsId] as const;
export function addToOverlay(qc: QueryClient, post: Post) {
  qc.setQueryData<Post[]>(overlayKey(post.orgId, post.workspaceId), (cur = []) => [post, ...cur.filter((p) => p.id !== post.id)]);
}
export function removeFromOverlay(qc: QueryClient, orgId: ID, wsId: ID, ids: ID[]) {
  qc.setQueryData<Post[]>(overlayKey(orgId, wsId), (cur = []) => cur.filter((p) => !ids.includes(p.id)));
}
export const useOverlay = (orgId: ID, wsId: ID) =>
  useQuery({ queryKey: overlayKey(orgId, wsId), queryFn: () => [] as Post[], initialData: [] as Post[], staleTime: Infinity, gcTime: Infinity });

export type PostAction = "publish" | "unpublish" | "hide" | "show" | "restore" | "delete";
export function usePostAction(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, reason, version }: { id: ID; action: PostAction; reason?: string; version?: number }): Promise<PostDetail | undefined> =>
      action === "delete" ? del<undefined>(`${O(orgId)}/posts/${id}`) : post<PostDetail>(`${O(orgId)}/posts/${id}/${action}`, { reason, version }),
    onSuccess: (d, v) => {
      if (d) qc.setQueryData(qk.post(orgId, v.id), d);
      else qc.invalidateQueries({ queryKey: qk.post(orgId, v.id) });
      if (d && v.action === "publish") addToOverlay(qc, d.post);
      if (v.action !== "publish") qc.setQueriesData<Post[]>({ queryKey: ["overlay", orgId] }, (cur) => cur?.filter((p) => p.id !== v.id));
      invalidatePostLists(qc, orgId);
    },
  });
}

export const useRevisions = (orgId: ID, id: ID, enabled: boolean) =>
  useQuery({ queryKey: qk.revisions(orgId, id), queryFn: ({ signal }) => get<PostRevision[]>(`${O(orgId)}/posts/${id}/revisions`, signal), enabled });
export const useDrafts = (orgId: ID, wsId: ID) =>
  useQuery({ queryKey: qk.drafts(orgId, wsId), queryFn: ({ signal }) => get<DraftSummary[]>(`${W(orgId, wsId)}/drafts`, signal) });
export const useTrash = (orgId: ID, wsId: ID) =>
  useQuery({ queryKey: qk.trash(orgId, wsId), queryFn: ({ signal }) => get<{ deleted: Post[]; hidden: Post[] }>(`${W(orgId, wsId)}/trash`, signal) });

// ---- assets & images ----

export function uploadImage(
  orgId: ID,
  file: Blob & { name?: string },
  onProgress?: (fraction: number) => void,
  sourceKind: "upload" | "paste" = "upload",
) {
  return (async () => {
    const filename = file.name || `pasted-${Date.now()}.png`;
    const { uploadId, uploadUrl } = await post<{ uploadId: ID; uploadUrl: string }>(`${O(orgId)}/uploads`, {
      filename,
      mime: file.type,
      bytes: file.size,
      sourceKind,
    });
    // XHR (not fetch) so the composer can show real upload progress.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
    onProgress?.(1);
    return post<import("./contract").Asset>(`${O(orgId)}/uploads/${uploadId}/complete`);
  })();
}

export const createImageInstance = (orgId: ID, body: { assetId: ID; postId?: ID; commentId?: ID }) =>
  post<ImageView>(`${O(orgId)}/image-instances`, body);

export function useImage(orgId: ID, id: ID | undefined) {
  return useQuery({ queryKey: qk.image(orgId, id ?? ""), queryFn: ({ signal }) => get<ImageView>(`${O(orgId)}/image-instances/${id}`, signal), enabled: !!id });
}

function patchImageInCaches(qc: QueryClient, orgId: ID, img: ImageView) {
  qc.setQueryData(qk.image(orgId, img.id), img);
  if (img.postId)
    qc.setQueryData<PostDetail>(qk.post(orgId, img.postId), (d) => (d ? { ...d, images: d.images.some((i) => i.id === img.id) ? d.images.map((i) => (i.id === img.id ? img : i)) : [...d.images, img] } : d));
}

export function useUpdateImage(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: ID } & Partial<Pick<ImageView, "caption" | "altText" | "figureLabel" | "tags" | "customFields" | "assetId">>) =>
      patch<ImageView>(`${O(orgId)}/image-instances/${id}`, body),
    onSuccess: (img) => patchImageInCaches(qc, orgId, img),
  });
}
export function useSaveAnnotation(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, shapes, version }: { id: ID; shapes: Shape[]; version: number }) => put<ImageView>(`${O(orgId)}/image-instances/${id}/annotation`, { shapes, version }),
    onSuccess: (img) => patchImageInCaches(qc, orgId, img),
  });
}
export { patchImageInCaches };

// ---- search ----

export function useSearch(orgId: ID, wsId: ID, spec: FilterSpec, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.search(orgId, wsId, spec),
    queryFn: ({ pageParam, signal }) =>
      post<SearchResponse>(`${W(orgId, wsId)}/search`, { ...normalize(spec), facets: ["tags", "authors", "imageTypes"], cursor: pageParam }, undefined).then((r) => {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return r;
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData, // previous results stay visible (dimmed) while loading (§A4)
    enabled,
    staleTime: 15_000,
  });
}

/** Result counts for several specs at once (zero-results suggestions). */
export const useSearchCounts = (orgId: ID, wsId: ID, specs: FilterSpec[], enabled: boolean) =>
  useQueries({
    queries: specs.map((s) => ({
      queryKey: ["org", orgId, "ws", wsId, "search-count", normalize(s)],
      queryFn: ({ signal }: { signal: AbortSignal }) => api<SearchResponse>("POST", `${W(orgId, wsId)}/search`, { ...normalize(s), limit: 1 }, { signal }).then((r) => r.total),
      enabled,
      staleTime: 30_000,
    })),
  });

export const useSuggest = (orgId: ID, wsId: ID, q: string) =>
  useQuery({
    queryKey: qk.suggest(orgId, wsId, q),
    queryFn: ({ signal }) => get<SuggestResponse>(`${W(orgId, wsId)}/suggest?q=${encodeURIComponent(q)}`, signal),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const useSavedViews = (orgId: ID, wsId: ID) =>
  useQuery({ queryKey: qk.views(orgId, wsId), queryFn: ({ signal }) => get<SavedView[]>(`${W(orgId, wsId)}/saved-views`, signal) });
export function useSaveView(orgId: ID, wsId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SavedView>) =>
      id ? patch<SavedView>(`${W(orgId, wsId)}/saved-views/${id}`, body) : post<SavedView>(`${W(orgId, wsId)}/saved-views`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.views(orgId, wsId) }),
  });
}
export function useDeleteView(orgId: ID, wsId: ID) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: ID) => del(`${W(orgId, wsId)}/saved-views/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.views(orgId, wsId) }) });
}
export const useCollections = (orgId: ID, wsId: ID) =>
  useQuery({ queryKey: qk.collections(orgId, wsId), queryFn: ({ signal }) => get<Collection[]>(`${W(orgId, wsId)}/collections`, signal) });
export function useCreateCollection(orgId: ID, wsId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; postIds: ID[]; kind?: Collection["kind"] }) => post<Collection>(`${W(orgId, wsId)}/collections`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.collections(orgId, wsId) }),
  });
}

// ---- discussion ----

export const useComments = (orgId: ID, postId: ID, enabled = true) =>
  useQuery({ queryKey: qk.comments(orgId, postId), queryFn: ({ signal }) => get<Comment[]>(`${O(orgId)}/posts/${postId}/comments`, signal), enabled });

export function useAddComment(orgId: ID, postId: ID, me: ID) {
  const qc = useQueryClient();
  const key = qk.comments(orgId, postId);
  return useMutation({
    mutationFn: (body: Partial<Comment>) => post<Comment>(`${O(orgId)}/posts/${postId}/comments`, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Comment[]>(key);
      const optimistic: Comment = {
        id: `optimistic-${Date.now()}`,
        postId,
        authorId: me,
        doc: body.doc,
        parentId: body.parentId,
        anchor: body.anchor,
        imageInstanceIds: body.imageInstanceIds ?? [],
        isQuestion: !!body.isQuestion,
        resolved: false,
        hidden: false,
        createdAt: new Date().toISOString(),
        reactions: {},
        version: 1,
      };
      qc.setQueryData<Comment[]>(key, (cur) => [...(cur ?? []), optimistic]);
      return { prev };
    },
    onError: (_e, _v, c) => c?.prev && qc.setQueryData(key, c.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: qk.post(orgId, postId) });
    },
  });
}

export function useCommentAction(orgId: ID, postId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: ID; action: "edit"; doc: unknown; version: number } | { id: ID; action: "delete" } | { id: ID; action: "hide"; hidden: boolean } | { id: ID; action: "resolve"; resolved: boolean; acceptedAnswerId?: ID } | { id: ID; action: "question"; isQuestion: boolean; version: number }): Promise<Comment | undefined> => {
      switch (v.action) {
        case "edit":
          return patch<Comment>(`${O(orgId)}/comments/${v.id}`, { doc: v.doc, version: v.version });
        case "question":
          return patch<Comment>(`${O(orgId)}/comments/${v.id}`, { isQuestion: v.isQuestion, version: v.version });
        case "hide":
          return patch<Comment>(`${O(orgId)}/comments/${v.id}`, { hidden: v.hidden });
        case "resolve":
          return post<Comment>(`${O(orgId)}/comments/${v.id}/resolve`, { resolved: v.resolved, acceptedAnswerId: v.acceptedAnswerId });
        case "delete":
          return del<undefined>(`${O(orgId)}/comments/${v.id}`);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.comments(orgId, postId) });
      qc.invalidateQueries({ queryKey: qk.post(orgId, postId) });
    },
  });
}

export function useToggleReaction(orgId: ID, me: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { targetType: "post" | "comment"; targetId: ID; postId: ID; emoji: string }) =>
      put<{ reactions: Record<string, ID[]> }>(`${O(orgId)}/reactions`, { targetType: v.targetType, targetId: v.targetId, emoji: v.emoji }),
    onMutate: async (v) => {
      const toggle = (r: Record<string, ID[]>) => {
        const cur = r[v.emoji] ?? [];
        const next = cur.includes(me) ? cur.filter((x) => x !== me) : [...cur, me];
        const out = { ...r, [v.emoji]: next };
        if (!next.length) delete out[v.emoji];
        return out;
      };
      if (v.targetType === "post") {
        const key = qk.post(orgId, v.postId);
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<PostDetail>(key);
        if (prev) qc.setQueryData<PostDetail>(key, { ...prev, post: { ...prev.post, reactions: toggle(prev.post.reactions) } });
        return { key, prev };
      }
      const key = qk.comments(orgId, v.postId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Comment[]>(key);
      if (prev) qc.setQueryData<Comment[]>(key, prev.map((c) => (c.id === v.targetId ? { ...c, reactions: toggle(c.reactions) } : c)));
      return { key, prev };
    },
    onError: (_e, _v, c) => c?.prev && qc.setQueryData(c.key, c.prev),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: v.targetType === "post" ? qk.post(orgId, v.postId) : qk.comments(orgId, v.postId) });
    },
  });
}

export const useNotifications = (orgId: ID) =>
  useQuery({ queryKey: qk.notifications(orgId), queryFn: ({ signal }) => get<Notification[]>(`${O(orgId)}/notifications`, signal), refetchInterval: 60_000 });
export function useMarkRead(orgId: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: ID[]) => post<void>(`${O(orgId)}/notifications/read`, { ids }),
    onMutate: async (ids) => {
      const key = qk.notifications(orgId);
      const prev = qc.getQueryData<Notification[]>(key);
      const t = new Date().toISOString();
      if (prev) qc.setQueryData<Notification[]>(key, prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? t } : n)));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications(orgId) }),
  });
}

// ---- import ----

export function useStartImport(orgId: ID, wsId: ID) {
  return useMutation({
    mutationFn: async (v: { file: File; mode: ImportMode; defaults: ImportJob["defaults"] }) => {
      const job = await post<ImportJob>(`${W(orgId, wsId)}/imports`, { filename: v.file.name, bytes: v.file.size, mode: v.mode, defaults: v.defaults });
      return put<ImportJob>(`${O(orgId)}/imports/${job.id}/upload`, v.file);
    },
  });
}
export const useImportJob = (orgId: ID, id: ID | undefined) =>
  useQuery({
    queryKey: qk.importJob(orgId, id ?? ""),
    queryFn: ({ signal }) => get<ImportJob>(`${O(orgId)}/imports/${id}`, signal),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ["uploading", "parsing", "committing"].includes(q.state.data.status) ? 400 : false),
  });
export function useImportAction(orgId: ID, id: ID) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { action: "items"; items: ImportItem[] } | { action: "mode"; mode: ImportMode } | { action: "commit" } | { action: "publishAll" } | { action: "delete" }): Promise<ImportJob | undefined> => {
      switch (v.action) {
        case "items":
          return patch<ImportJob>(`${O(orgId)}/imports/${id}`, { items: v.items });
        case "mode":
          return patch<ImportJob>(`${O(orgId)}/imports/${id}`, { mode: v.mode });
        case "commit":
          return post<ImportJob>(`${O(orgId)}/imports/${id}/commit`, {}, `commit-${id}`);
        case "publishAll":
          return post<ImportJob>(`${O(orgId)}/imports/${id}/publish-all`);
        case "delete":
          return del<undefined>(`${O(orgId)}/imports/${id}`);
      }
    },
    onSuccess: (job) => {
      if (job) qc.setQueryData(qk.importJob(orgId, id), job);
      invalidatePostLists(qc, orgId);
      qc.invalidateQueries({ queryKey: ["org", orgId, "ws"] });
    },
  });
}

// ---- dev ----

export const usePersonas = () =>
  useQuery({ queryKey: ["dev", "personas"], queryFn: ({ signal }) => get<{ user: User; roles: string[] }[]>("/dev/personas", signal) });
export const useDevEmails = () =>
  useQuery({ queryKey: ["dev", "emails"], queryFn: ({ signal }) => get<DevEmail[]>("/dev/emails", signal), refetchInterval: 3000 });
