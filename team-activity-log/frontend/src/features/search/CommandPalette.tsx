import { AddRounded, ArticleOutlined, BookmarkBorderRounded, SearchRounded, SlideshowOutlined, SwapHorizRounded } from "@mui/icons-material";
import { Box, Dialog, InputBase, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useLibrary, useSuggest, useTags } from "../../api/hooks";
import { toSearchParams, toggleFacetValue } from "../../lib/filterSpec";
import { can, useWs, wsPath } from "../../app/session";
import { APP_EVENTS, useAppEvent } from "../../app/shortcuts";
import { Kbd, TagDot } from "../../components/ui";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

/** §W4.12 Ctrl/Cmd+K: jump to a post, apply a saved view, toggle a tag, switch workspace, new post. */
export function CommandPalette() {
  const { me, org, ws, role } = useWs();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  useAppEvent(APP_EVENTS.palette, useCallback(() => setOpen((o) => !o), []));
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 120);
    return () => clearTimeout(t);
  }, [q]);
  const lib = useLibrary(org.id, ws.id, { kind: "view", q: debounced, limit: 5 }, open);
  const views = lib.data?.pages[0]?.items;
  const { data: tags } = useTags(org.id);
  const { data: suggest } = useSuggest(org.id, ws.id, debounced);

  const close = () => {
    setOpen(false);
    setQ("");
    setActive(0);
  };

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const base = wsPath(org, ws);
    const out: Item[] = [];
    if (can(role, "member") && match("new post")) out.push({ id: "new", group: "Actions", label: "New post", hint: "C", icon: <AddRounded />, run: () => navigate(`${base}/new`) });
    if (can(role, "member") && match("import slides powerpoint deck pptx")) out.push({ id: "import", group: "Actions", label: "Import slides", icon: <SlideshowOutlined />, run: () => navigate(`${base}/import`) });
    if (needle) out.push({ id: "search", group: "Actions", label: `Search for “${q.trim()}”`, icon: <SearchRounded />, run: () => navigate(`${base}/search?${toSearchParams({ q: q.trim() })}`) });
    for (const p of suggest?.posts ?? []) out.push({ id: `p-${p.id}`, group: "Posts", label: p.title, icon: <ArticleOutlined />, run: () => navigate(`${base}/p/${p.id}`) });
    for (const v of (views ?? []).slice(0, 5))
      out.push({ id: `v-${v.id}`, group: "Saved views", label: v.name, icon: <BookmarkBorderRounded />, run: () => navigate(`${base}/search?${toSearchParams(v.filterSpec ?? {})}&view=${v.id}`) });
    if (needle)
      for (const t of (tags?.tags ?? []).filter((t) => match(t.name)).slice(0, 5))
        out.push({ id: `t-${t.id}`, group: "Filter by tag", label: t.name, icon: <TagDot color={t.color} />, run: () => navigate(`${base}/search?${toSearchParams(toggleFacetValue({}, "tag", t.id, "include"))}`) });
    for (const o of me.orgs)
      for (const w of o.workspaces.filter((w) => !w.archived && w.id !== ws.id && match(`${w.name} ${o.org.name}`)).slice(0, 6))
        out.push({ id: `w-${w.id}`, group: "Switch workspace", label: w.name, hint: me.orgs.length > 1 ? o.org.name : undefined, icon: <SwapHorizRounded />, run: () => navigate(wsPath(o.org, w)) });
    return out;
  }, [q, suggest, views, tags, me, org, ws, role, navigate]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      items[active].run();
      close();
    }
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { position: "fixed", top: "12vh", m: 0, mx: 2, width: "calc(100% - 32px)" } } }} aria-label="Command palette">
      <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.25, borderBottom: 1, borderColor: "divider", gap: 1 }}>
        <SearchRounded sx={{ color: "text.secondary" }} />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Jump to a post, view, tag, or workspace…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          inputProps={{ "aria-activedescendant": items[active] ? `cmd-${items[active].id}` : undefined, "aria-controls": "cmd-list", role: "combobox", "aria-expanded": true }}
        />
        <Kbd>Esc</Kbd>
      </Box>
      <List id="cmd-list" ref={listRef} dense role="listbox" sx={{ maxHeight: "50vh", overflow: "auto", py: 0.5 }}>
        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
            No matches
          </Typography>
        )}
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? <ListSubheader key={`h-${it.group}`} sx={{ lineHeight: "26px", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{it.group}</ListSubheader> : null;
          lastGroup = it.group;
          return [
            header,
            <ListItemButton
              key={it.id}
              id={`cmd-${it.id}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => (it.run(), close())}
              sx={{ mx: 0.5, py: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 30, color: "text.secondary", "& svg": { fontSize: 18 } }}>{it.icon}</ListItemIcon>
              <ListItemText primary={it.label} slotProps={{ primary: { noWrap: true } }} />
              {it.hint && <Kbd>{it.hint}</Kbd>}
            </ListItemButton>,
          ];
        })}
      </List>
    </Dialog>
  );
}
