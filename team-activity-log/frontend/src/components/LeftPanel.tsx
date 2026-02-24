import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
} from "@mui/material";
import { Av } from "./AvatarComponent";
import type {
  PostType,
  TagsType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";
import { useMemo } from "react";
import { Clear } from "@mui/icons-material";
import { sBtn } from "../utilities/helpers";

interface LeftSidebarType {
  filterUser: number | null;
  setFilterUser: React.Dispatch<React.SetStateAction<number | null>>;
  filterTags: string[];
  setFilterTags: React.Dispatch<React.SetStateAction<string[]>>;
  toggleTag: (t: string) => void;
  posts?: PostType[];
  users?: UserData[];
  tags?: TagsType[];
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  isMobile: boolean;
  isTablet: boolean;
}
// ─── LEFT SIDEBAR ─────────────────────────────────────────────────────────────
export const LeftPanel = ({
  filterUser,
  setFilterUser,
  filterTags,
  setFilterTags,
  toggleTag,
  posts,
  users,
  tags,
  search,
  setSearch,
  isMobile,
  isTablet,
}: LeftSidebarType) => {
  const activeFilters = filterTags.length + (filterUser ? 1 : 0);

  const tagCounts = useMemo(() => {
    if (!tags || !posts) return {};

    return tags.reduce<Record<string, number>>((acc, t) => {
      acc[t.label] = posts.filter((p) => p.tags.includes(t.label)).length;
      return acc;
    }, {});
  }, [tags, posts]);

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* TOP NAV */}
      <Box
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(11,15,24,.93)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid #ffffff0a",
          flexShrink: 0,
        }}
      >
        <Box
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "10px 24px",
            display: "flex",
            gap: 14,
            alignItems: "center",
          }}
        >
          {(isMobile || isTablet) && (
            <Box style={{ flexShrink: 0 }}>
              <Box
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: "#f59e0b",
                  fontWeight: 700,
                  letterSpacing: 3,
                  fontSize: ".85rem",
                }}
              >
                TEAM LOG
              </Box>
              <Box
                style={{
                  fontFamily: "monospace",
                  color: "#334155",
                  fontSize: ".58rem",
                }}
              >
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
      <Box sx={{ flex: 1, position: "relative", maxWidth: 500, mb: 1 }}>
        <TextField
          fullWidth
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs…"
          size="small"
          InputProps={{
            endAdornment: search && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setSearch("")}
                  aria-label="Clear"
                >
                  <Clear fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>
      {activeFilters > 0 && (
        <Button
          onClick={() => {
            setFilterUser(null);
            setFilterTags([]);
          }}
          sx={{
            ...sBtn,
            color: "#f87171",
            borderColor: "#f8717144",
            fontSize: ".75rem",
          }}
        >
          ✕ Clear {activeFilters} filter{activeFilters > 1 ? "s" : ""}
        </Button>
      )}
      {/* Team members */}
      <Box
        style={{
          background: "#171b26",
          border: "1px solid #ffffff0c",
          borderRadius: 10,
          padding: "14px",
          marginBottom: 10,
          marginTop: 10,
        }}
      >
        <Box
          style={{
            fontFamily: "monospace",
            fontSize: ".6rem",
            color: "#334155",
            letterSpacing: 2,
            marginBottom: 10,
          }}
        >
          TEAM MEMBERS
        </Box>
        {users &&
          users?.map((u) => (
            <Box
              key={u.id}
              onClick={() => setFilterUser(filterUser === u.id ? null : u.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 7,
                cursor: "pointer",
                marginBottom: 3,
                background:
                  filterUser === u.id ? `${u.color}18` : "transparent",
                border: `1px solid ${filterUser === u.id ? `${u.color}44` : "transparent"}`,
                transition: "all .15s",
              }}
            >
              <Av user={u} size={28} />
              <Box>
                <Box
                  style={{
                    fontSize: ".8rem",
                    fontWeight: 600,
                    color: filterUser === u.id ? u.color : "#e2e8f0",
                  }}
                >
                  {u.name}
                </Box>
                <Box
                  style={{
                    fontSize: ".65rem",
                    color: "#334155",
                    fontFamily: "monospace",
                  }}
                >
                  {u.role}
                </Box>
              </Box>
            </Box>
          ))}
      </Box>

      {/* Tags */}
      <Box
        style={{
          background: "#171b26",
          border: "1px solid #ffffff0c",
          borderRadius: 10,
          padding: "14px",
          marginBottom: 10,
        }}
      >
        <Box
          style={{
            fontFamily: "monospace",
            fontSize: ".6rem",
            color: "#334155",
            letterSpacing: 2,
            marginBottom: 10,
          }}
        >
          TAGS
        </Box>
        {tags?.map(({ label, color }) => {
          const c = color || "#94a3b8";
          const active = filterTags.includes(label);
          return (
            <Box
              key={label}
              onClick={() => toggleTag(label)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 8px",
                borderRadius: 5,
                cursor: "pointer",
                marginBottom: 2,
                background: active ? `${c}18` : "transparent",
                transition: "background .1s",
              }}
            >
              <span
                style={{
                  fontSize: ".78rem",
                  color: active ? c : "#64748b",
                  fontFamily: "monospace",
                }}
              >
                #{label}
              </span>
              <span
                style={{
                  fontSize: ".65rem",
                  color: "#334155",
                  background: "#ffffff08",
                  borderRadius: 10,
                  padding: "0 6px",
                }}
              >
                {tagCounts?.[label]}
              </span>
            </Box>
          );
        })}
      </Box>
    </aside>
  );
};
