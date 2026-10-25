import { Box, LinearProgress } from "@mui/material";
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { API_MODE, ApiError } from "./api/client";
import { useMe } from "./api/hooks";
import { AppShell } from "./app/AppShell";
import { homePath, useOrgScope, useWorkspaceScope } from "./app/session";
import { ErrorState } from "./components/ui";
import {
  CreateOrgPage,
  MagicPage,
  RegisterPage,
  ResetPage,
  SignInPage,
  VerifyPage,
  VerifySentPage,
} from "./features/auth/AuthPages";
import { AcceptInvitePage } from "./features/orgs/AcceptInvitePage";
import { OrgHomePage, OrgPickerPage } from "./features/orgs/OrgHomePage";
import { SearchPage } from "./features/search/SearchPage";

const ComposerPage = lazy(() => import("./features/posts/ComposerPage"));
const PostDetailPage = lazy(() => import("./features/posts/PostDetailPage"));
const ActivityPage = lazy(() => import("./features/activity/ActivityPage"));
const MentionsTab = lazy(() => import("./features/activity/Mentions"));
const DraftsTab = lazy(() => import("./features/activity/Drafts"));
const RecycleBinTab = lazy(() => import("./features/activity/RecycleBin"));
const PresentPage = lazy(() => import("./features/present/PresentPage"));
const ImportPage = lazy(() => import("./features/import/ImportPage"));
const AdminPage = lazy(() => import("./features/admin/AdminPage"));
const UserPanelPage = lazy(() => import("./features/me/UserPanelPage"));
const DevPage = lazy(() => import("./features/dev/DevPage"));
const ExplorePage = lazy(() => import("./features/explore/ExplorePage"));
const LandingPage = lazy(() => import("./features/landing/LandingPage"));
const NotebookPage = lazy(() => import("./features/collections/NotebookPage"));
const CollectionPage = lazy(() => import("./features/collections/CollectionPage"));
const LibraryPage = lazy(() => import("./features/collections/LibraryPage"));

export const Loading = () => <LinearProgress sx={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 2000, height: 2 }} />;

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Loading />;
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401)) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function OrgRoute({ children }: { children: ReactNode }) {
  const scope = useOrgScope();
  if (!scope) return <Navigate to="/orgs" replace />;
  return <>{children}</>;
}

function WorkspaceRoute() {
  const scope = useWorkspaceScope();
  const org = useOrgScope();
  if (!org) return <Navigate to="/orgs" replace />;
  if (!scope) return <Navigate to={`/o/${org.org.slug}`} replace />;
  return <AppShell />;
}

/** `/`: the landing page for visitors; signed-in people go straight to their workspace. */
function FrontDoor() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.data) return <Navigate to={homePath(me.data)} replace />;
  return page(<LandingPage />);
}

const page = (el: ReactNode) => (
  <Suspense fallback={<Loading />}>
    <Box sx={{ display: "contents" }}>{el}</Box>
  </Suspense>
);

export function App() {
  return (
    <Routes>
      <Route path="/" element={<FrontDoor />} />
      <Route path="/about" element={page(<LandingPage />)} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-sent" element={<VerifySentPage />} />
      <Route path="/verify/:token" element={<VerifyPage />} />
      <Route path="/magic/:token" element={<MagicPage />} />
      <Route path="/reset/:token" element={<ResetPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
      {/* Dev tools: mock mode, or the dev server against a DEV_MODE backend; never in a production build. */}
      {(API_MODE === "mock" || import.meta.env.DEV) && <Route path="/dev" element={page(<DevPage />)} />}
      <Route path="/new-org" element={<RequireAuth><CreateOrgPage /></RequireAuth>} />
      <Route path="/orgs" element={<RequireAuth><OrgPickerPage /></RequireAuth>} />
      <Route path="/me/*" element={<RequireAuth>{page(<UserPanelPage />)}</RequireAuth>} />
      <Route path="/o/:org" element={<RequireAuth><OrgRoute><OrgHomePage /></OrgRoute></RequireAuth>} />
      <Route path="/o/:org/admin/*" element={<RequireAuth><OrgRoute>{page(<AdminPage />)}</OrgRoute></RequireAuth>} />
      <Route path="/o/:org/w/:ws" element={<RequireAuth><WorkspaceRoute /></RequireAuth>}>
        <Route index element={page(<ExplorePage />)} />
        <Route path="search" element={<SearchPage />} />
        <Route path="explore" element={<Navigate to=".." replace relative="path" />} />
        <Route path="notebooks/:id" element={page(<NotebookPage />)} />
        <Route path="collections/:id" element={page(<CollectionPage />)} />
        <Route path="library" element={page(<LibraryPage />)} />
        <Route path="new" element={page(<ComposerPage />)} />
        <Route path="p/:postId" element={page(<PostDetailPage />)} />
        <Route path="p/:postId/edit" element={page(<ComposerPage />)} />
        <Route path="p/:postId/present" element={page(<PresentPage />)} />
        {/* Drafts and the recycle bin are Activity tabs; old links (and the old Inbox) land on them. */}
        <Route path="drafts" element={<Navigate to="../activity/drafts" replace relative="path" />} />
        <Route path="trash" element={<Navigate to="../activity/recycle-bin" replace relative="path" />} />
        <Route path="inbox" element={<Navigate to="../activity" replace relative="path" />} />
        <Route path="activity" element={page(<ActivityPage />)}>
          <Route index element={page(<MentionsTab />)} />
          <Route path="drafts" element={page(<DraftsTab />)} />
          <Route path="recycle-bin" element={page(<RecycleBinTab />)} />
        </Route>
        <Route path="import" element={page(<ImportPage />)} />
        <Route path="present" element={page(<PresentPage />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
