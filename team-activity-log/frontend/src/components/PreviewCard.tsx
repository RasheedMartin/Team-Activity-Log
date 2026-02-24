import { Comment } from "@mui/icons-material";
import { Box, Button, Chip } from "@mui/material";
import { forwardRef, useEffect, useState } from "react";
import { getUser, countComments, timeAgo } from "../utilities/helpers";
import { Av } from "./AvatarComponent";
import { Tag } from "./Tags";
import type {
  OpenPanel,
  PostType,
  TagsType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";
import { ImageStrip } from "./ImageStrip";

interface PreviewCardProps {
  post: PostType;
  onViewPost: (post: PostType) => void;
  users?: UserData[];
  tags?: TagsType[];
  isActive?: boolean;
  setOpenPanel: React.Dispatch<React.SetStateAction<OpenPanel>>;
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isMobile: boolean;
  isTablet: boolean;
}

export const PreviewCard = forwardRef<HTMLElement, PreviewCardProps>(
  (
    {
      post,
      onViewPost,
      users,
      tags,
      isActive,
      setOpenPanel,
      setRightOpen,
      isMobile,
      isTablet,
    },
    ref,
  ) => {
    const [user, setUser] = useState<UserData | null>(null);

    useEffect(() => {
      if (users) {
        setUser(getUser(users, post.userId));
      }
    }, [users, post.userId]);

    const commentCount = countComments(post.comments);

    // First text block plain text for preview
    const previewText = (() => {
      const firstText = post.blocks.find((b) => b.type === "text");
      if (!firstText || firstText.type !== "text") return "";
      return firstText.html.replace(/<[^>]+>/g, "");
    })();

    // First image block if any
    const firstImage = post.blocks.find((b) => b.type === "image");
    const imageBlocks = post.blocks
      .filter((b) => b.type === "image")
      .slice(0, 5);
    return (
      <article
        ref={ref}
        style={{
          background: "#171b26",
          border: `1px solid ${isActive ? "#f59e0b44" : "#ffffff0c"}`,
          borderRadius: 10,
          marginBottom: 12,
          overflow: "visible",
          transition: "border-color .2s",
        }}
        onMouseEnter={(e) =>
          !isActive && (e.currentTarget.style.borderColor = "#ffffff18")
        }
        onMouseLeave={(e) =>
          !isActive && (e.currentTarget.style.borderColor = "#ffffff0c")
        }
      >
        {/* Active indicator */}
        {isActive && (
          <Box
            style={{
              height: 2,
              background: "linear-gradient(90deg, #f59e0b, transparent)",
              borderRadius: "10px 10px 0 0",
            }}
          />
        )}

        {/* Header */}
        <Box
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            padding: "14px 16px 8px",
          }}
        >
          <Box style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Av user={user} size={34} />
            <Box>
              <Box style={{ display: "flex", gap: 7, alignItems: "center" }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: ".88rem",
                    color: "#f1f5f9",
                  }}
                >
                  {user?.name}
                </span>
                <span
                  style={{
                    fontSize: ".65rem",
                    padding: "1px 6px",
                    borderRadius: 3,
                    fontFamily: "monospace",
                    background: `${user?.color}22`,
                    color: user?.color ?? "#94a3b8",
                  }}
                >
                  {user?.role}
                </span>
              </Box>
              <span
                style={{
                  fontSize: ".68rem",
                  color: "#334155",
                  fontFamily: "monospace",
                }}
              >
                {timeAgo(post.timestamp)} ago
              </span>
            </Box>
          </Box>
          {/* Comment count */}
          <Box sx={{ borderRight: "1px solid #ffffff08", marginRight: 1 }}>
            <Chip
              icon={<Comment />}
              size="small"
              sx={{
                color: "text.secondary",
              }}
              label={`${commentCount} Comment${commentCount !== 1 ? "s" : ""}`}
            />
          </Box>
        </Box>

        {/* Preview content — fixed height with fade */}
        <Box style={{ position: "relative" }}>
          <Box
            style={{
              maxHeight: 120,
              height: 40,
              overflow: "hidden",
              padding: "0 16px",
              fontSize: ".88rem",
              lineHeight: 1.7,
              color: "#94a3b8",
            }}
          >
            {previewText || (
              <span style={{ fontStyle: "italic", color: "#475569" }}>
                {firstImage ? "📷 Image post" : "No content"}
              </span>
            )}
          </Box>
          {/* Fade overlay */}
          <Box
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 40,
              background: "linear-gradient(transparent, #171b26)",
              pointerEvents: "none",
            }}
          />
        </Box>
        {/* Title */}
        {post.title && (
          <Box
            sx={{
              px: 2,
              pb: 0.5,
              textAlign: "center",
            }}
          >
            <Box
              component="h3"
              sx={{
                margin: 0,
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "#e5e7eb",
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {post.title}
            </Box>
          </Box>
        )}

        {imageBlocks.length > 0 && <ImageStrip images={imageBlocks} />}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px 4px",
            gap: 2,
            marginBottom: 1,
          }}
        >
          {/* LEFT: Tags */}
          {post.tags.length > 0 && (
            <Box
              sx={{
                display: "flex",
                gap: 0.5,
                flexWrap: "wrap",
              }}
            >
              {tags &&
                post.tags.map((t: string) => (
                  <Tag
                    key={t}
                    tag={t}
                    active
                    color={
                      tags.find((item) => item.label === t)?.color ?? "#94a3b8"
                    }
                  />
                ))}
            </Box>
          )}

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              marginLeft: post.tags.length === 0 ? "auto" : 0,
            }}
          >
            {/* View Post */}
            <Button
              size="small"
              onClick={() => {
                onViewPost(post);
                setOpenPanel("fullpost");
                if (isMobile || isTablet) setRightOpen(true);
              }}
              sx={{
                color: isActive ? "#f59e0b" : "text.secondary",
                fontSize: ".75rem",
                fontWeight: isActive ? 700 : 400,
                "&:hover": {
                  color: "#f59e0b",
                  bgcolor: "rgba(245,158,11,0.06)",
                },
              }}
            >
              {isActive ? "● Viewing" : "View Post →"}
            </Button>
          </Box>
        </Box>
      </article>
    );
  },
);
