import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { API_BASE_URL } from "../../api/client";
import type { ID, LiveEvent } from "../../api/contract";
import { qk } from "../../api/hooks";

/** Subscribe to the workspace event stream (SSE) and refresh what changed (§W3.8). */
export function useLiveEvents(orgId: ID, wsId: ID) {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource(`${API_BASE_URL}/orgs/${orgId}/workspaces/${wsId}/events`, { withCredentials: true });
    es.onmessage = (msg) => {
      let ev: LiveEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (ev.type === "comment") {
        qc.invalidateQueries({ queryKey: qk.comments(orgId, ev.postId) });
        qc.invalidateQueries({ queryKey: qk.post(orgId, ev.postId) });
      } else if (ev.type === "reaction" || ev.type === "post") {
        qc.invalidateQueries({ queryKey: qk.post(orgId, ev.postId) });
      } else if (ev.type === "notification") {
        qc.invalidateQueries({ queryKey: qk.notifications(orgId) });
      }
      // Feed cards show counts; refresh them without flashing (keepPreviousData).
      if (ev.type !== "notification") qc.invalidateQueries({ queryKey: qk.search(orgId, wsId), refetchType: "active" });
    };
    return () => es.close();
  }, [orgId, wsId, qc]);
}
