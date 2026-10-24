import { ArticleOutlined, CloseRounded, HelpOutlineRounded, HistoryRounded, SearchRounded } from "@mui/icons-material";
import { Box, ClickAwayListener, IconButton, InputBase, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Paper, Popover, Popper, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { FilterSpec, Tag, User } from "../../api/contract";
import { useSuggest } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { APP_EVENTS, useAppEvent } from "../../app/shortcuts";
import { Kbd, TagDot, UserAvatar } from "../../components/ui";
import { applyOperators, toggleFacetValue } from "../../lib/filterSpec";
import { parseBoolean, usesBooleanSyntax } from "../../lib/query";

const RECENT_KEY = (userId: string) => `tal.recent-searches.${userId}`;
function readRecent(userId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY(userId)) ?? "[]");
  } catch {
    return [];
  }
}
function pushRecent(userId: string, q: string) {
  try {
    const next = [q, ...readRecent(userId).filter((x) => x !== q)].slice(0, 8);
    localStorage.setItem(RECENT_KEY(userId), JSON.stringify(next));
  } catch {
    // storage blocked: recents are a convenience only
  }
}

const SYNTAX: [string, string][] = [
  ["drift cooldown", "both words (AND is implied)"],
  ["drift OR noise", "either word"],
  ["drift -pump   ·   drift NOT pump", "exclude a word"],
  ['"detector b"', "exact phrase"],
  ["(gain OR offset) AND calib*", "group with parentheses; * matches the start of a word"],
  ['title:drift   comment:"pump"', "search one place: title, body, comment, image, tag"],
  ["tag:calibration  by:dana", "turn into filter chips"],
  ["after:2026-03-01  before:2026-09-30", "date range chips"],
  ["has:image  has:annotation  has:comments  is:question", "content filter chips"],
];

interface Item {
  key: string;
  group: string;
  label: ReactNode;
  icon: ReactNode;
  run: () => void;
}

interface Props {
  spec: FilterSpec;
  setSpec: (s: FilterSpec, opts?: { replace?: boolean }) => void;
  tags: Tag[];
  people: User[];
}

export function SearchBar({ spec, setSpec, tags, people }: Props) {
  const { org, ws, me } = useWs();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(spec.q ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [help, setHelp] = useState<HTMLElement | null>(null);
  const lastWord = text.split(/\s+/).pop() ?? "";
  const [debounced, setDebounced] = useState("");

  // Keep the box in sync when the URL changes elsewhere (chips removed, saved view applied).
  const specQ = spec.q ?? "";
  const lastPushed = useRef(specQ);
  useEffect(() => {
    if (specQ !== lastPushed.current) {
      setText(specQ);
      lastPushed.current = specQ;
    }
  }, [specQ]);

  // Typing updates results after ~150 ms (§A4: debounce, cancel in-flight, keep previous dimmed).
  const specRef = useRef(spec);
  specRef.current = spec;
  useEffect(() => {
    if (text === lastPushed.current) return;
    const t = setTimeout(() => {
      lastPushed.current = text;
      setSpec({ ...specRef.current, q: text || undefined, cursor: undefined }, { replace: true });
    }, 150);
    return () => clearTimeout(t);
  }, [text, setSpec]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(lastWord.replace(/^[-("]+|[)"*]+$/g, "")), 120);
    return () => clearTimeout(t);
  }, [lastWord]);

  useAppEvent(APP_EVENTS.focusSearch, useCallback(() => inputRef.current?.focus(), []));
  const arrivedToType = !!(useLocation().state as { focusSearch?: boolean } | null)?.focusSearch;
  useEffect(() => {
    if (arrivedToType) inputRef.current?.focus();
  }, [arrivedToType]);
  const { data: sug } = useSuggest(org.id, ws.id, open && !/:/.test(debounced) ? debounced : "");
  const parsed = useMemo(() => parseBoolean(text), [text]);

  const replaceLastWord = (s: FilterSpec) => {
    const words = text.trimEnd().split(/\s+/);
    words.pop();
    const rest = words.join(" ");
    setText(rest ? `${rest} ` : "");
    lastPushed.current = rest;
    setSpec({ ...s, q: rest || undefined, cursor: undefined });
  };

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (!text.trim()) {
      readRecent(me.user.id).forEach((q) =>
        out.push({ key: `r-${q}`, group: "Recent searches", label: q, icon: <HistoryRounded />, run: () => (setText(q), setSpec({ ...specRef.current, q, cursor: undefined })) }),
      );
      return out;
    }
    for (const t of sug?.tags ?? [])
      out.push({ key: `t-${t.id}`, group: "Tags", label: t.name, icon: <TagDot color={t.color} />, run: () => replaceLastWord(toggleFacetValue(specRef.current, "tag", t.id, "include")) });
    for (const p of sug?.people ?? [])
      out.push({ key: `p-${p.id}`, group: "People", label: p.name, icon: <UserAvatar user={p} size={20} />, run: () => replaceLastWord(toggleFacetValue(specRef.current, "author", p.id, "include")) });
    for (const p of sug?.posts ?? []) out.push({ key: `s-${p.id}`, group: "Posts", label: p.title, icon: <ArticleOutlined />, run: () => navigate(wsPath(org, ws, `/p/${p.id}`)) });
    return out;
    // replaceLastWord closes over text; recomputed when text changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, sug, me.user.id, org, ws, navigate, setSpec]);

  const commitOperators = () => {
    const { spec: next, text: left } = applyOperators(specRef.current, text, { tags, people });
    if (next !== specRef.current || left !== text.trim()) {
      setText(left ? `${left} ` : "");
      lastPushed.current = left;
      setSpec({ ...next, q: left || undefined, cursor: undefined });
      return true;
    }
    return false;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) {
        items[active].run();
        setOpen(false);
        setActive(-1);
        return;
      }
      commitOperators();
      if (text.trim()) pushRecent(me.user.id, text.trim());
      setOpen(false);
      // Enter on a settled query moves focus to the first result (j/k from there).
      (document.querySelector("[data-post-id]") as HTMLElement | null)?.focus();
    } else if (e.key === " " && /^(tag|by|after|before|has|is):\S+$/i.test(lastWord)) {
      if (commitOperators()) e.preventDefault();
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else if (text) {
        setText("");
        lastPushed.current = "";
        setSpec({ ...specRef.current, q: undefined, cursor: undefined });
      } else inputRef.current?.blur();
    }
  };

  let lastGroup = "";
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchorRef} sx={{ position: "relative", flex: 1, minWidth: 0 }}>
        <Paper variant="outlined" sx={{ display: "flex", alignItems: "center", px: 1.25, py: 0.25, borderRadius: 1.5, "&:focus-within": { borderColor: "primary.main", boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` } }}>
          <SearchRounded sx={{ color: "text.secondary", mr: 1 }} />
          <InputBase
            inputRef={inputRef}
            fullWidth
            placeholder="Search posts, tags, people…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            inputProps={{
              "aria-label": "Search",
              role: "combobox",
              "aria-expanded": open && items.length > 0,
              "aria-controls": "search-suggestions",
              "aria-activedescendant": active >= 0 ? `sug-${items[active]?.key}` : undefined,
              autoComplete: "off",
              spellCheck: false,
            }}
            sx={{ fontSize: "0.95rem", fontFamily: usesBooleanSyntax(text) ? "'IBM Plex Mono', monospace" : undefined }}
          />
          {text && (
            <IconButton size="small" aria-label="Clear search" onClick={() => (setText(""), (lastPushed.current = ""), setSpec({ ...spec, q: undefined, cursor: undefined }))}>
              <CloseRounded fontSize="small" />
            </IconButton>
          )}
          <IconButton size="small" aria-label="Search syntax help" onClick={(e) => setHelp(e.currentTarget)}>
            <HelpOutlineRounded fontSize="small" />
          </IconButton>
          {!text && <Kbd>/</Kbd>}
        </Paper>
        {parsed.errors.length > 0 && text.trim() && (
          <Typography variant="caption" color="warning.main" sx={{ position: "absolute", left: 40, bottom: -18 }} role="status">
            {parsed.errors[0]}. Searching what we can.
          </Typography>
        )}
        <Popper open={open && items.length > 0} anchorEl={anchorRef.current} placement="bottom-start" sx={{ zIndex: 1300, width: anchorRef.current?.clientWidth }}>
          <Paper variant="outlined" sx={{ mt: 0.5, boxShadow: 6, maxHeight: 380, overflow: "auto" }}>
            <List id="search-suggestions" role="listbox" dense disablePadding sx={{ py: 0.5 }}>
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? <ListSubheader key={`h-${it.group}`} sx={{ lineHeight: "26px", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{it.group}</ListSubheader> : null;
                lastGroup = it.group;
                return [
                  header,
                  <ListItemButton key={it.key} id={`sug-${it.key}`} role="option" aria-selected={i === active} selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => (it.run(), setOpen(false))} sx={{ py: 0.4 }}>
                    <ListItemIcon sx={{ minWidth: 30, color: "text.secondary", "& svg": { fontSize: 18 } }}>{it.icon}</ListItemIcon>
                    <ListItemText primary={it.label} slotProps={{ primary: { noWrap: true } }} />
                    {(it.group === "Tags" || it.group === "People") && <Typography variant="caption" color="text.disabled">add filter</Typography>}
                  </ListItemButton>,
                ];
              })}
            </List>
          </Paper>
        </Popper>
        <Popover open={!!help} anchorEl={help} onClose={() => setHelp(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
          <Box sx={{ p: 2, maxWidth: 480 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Search syntax</Typography>
            <Stack spacing={0.75}>
              {SYNTAX.map(([ex, what]) => (
                <Stack key={ex} direction={{ xs: "column", sm: "row" }} spacing={{ sm: 2 }}>
                  <Typography variant="body2" sx={{ fontFamily: "'IBM Plex Mono', monospace", minWidth: { sm: 230 }, fontSize: "0.8rem" }}>{ex}</Typography>
                  <Typography variant="body2" color="text.secondary">{what}</Typography>
                </Stack>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              Operators are UPPERCASE. Need more? Use <b>Advanced filters</b> to build nested AND / OR / NOT groups.
            </Typography>
          </Box>
        </Popover>
      </Box>
    </ClickAwayListener>
  );
}
