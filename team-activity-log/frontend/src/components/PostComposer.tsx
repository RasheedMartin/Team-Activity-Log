import {
  Add,
  Brush,
  Send,
  Tag as TagIcon,
  Image as ImageIcon,
} from "@mui/icons-material";
import {
  Paper,
  Stack,
  Typography,
  Button,
  Collapse,
  Box,
  Divider,
  Chip,
  alpha,
  Tooltip,
  IconButton,
  Menu,
} from "@mui/material";
import Placeholder from "@tiptap/extension-placeholder";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState, useRef, useMemo } from "react";
import { Av } from "./AvatarComponent";
import { EditorToolbar } from "./EditorToolbar";
import { ImageAnnotator } from "./ImageAnnotator";
import type {
  PostRequest,
  UserData,
  TagsType,
  BlockType,
} from "../interfaces/TeamActivityLogInterfaces";

interface PostComposerProps {
  onPost: ({ title, blocks, tags }: PostRequest) => void;
  users?: UserData[];
  tags?: TagsType[];
}

import { Image as TiptapImage } from "@tiptap/extension-image";

// Top of PostComposer.tsx, outside the component
const createAnnotatableImage = (
  onClickImage: (src: string, pos: number) => void,
) =>
  TiptapImage.extend({
    addNodeView() {
      return ({ node, getPos }) => {
        const img = document.createElement("img");
        img.src = node.attrs.src;
        img.style.cursor = "pointer";
        img.style.maxWidth = "100%";
        img.style.width = "600px"; // ← consistent display size
        img.style.borderRadius = "8px";
        img.style.display = "block";

        img.addEventListener("click", () => {
          onClickImage(node.attrs.src, getPos() as number);
        });

        return { dom: img };
      };
    },
  });
// ─── POST COMPOSER ────────────────────────────────────────────────────────────
export const PostComposer = ({ onPost, users, tags }: PostComposerProps) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagAnchor, setTagAnchor] = useState<HTMLDivElement | null>(null);
  const [annotatingImg, setAnnotatingImg] = useState<{
    src: string;
    pos: number;
  } | null>(null);

  const currentUser = users ? users[0] : null;

  const fileRef = useRef<HTMLInputElement | null>(null);
  // Stable reference — only created once
  const AnnotatableImage = useMemo(
    () => createAnnotatableImage((src, pos) => setAnnotatingImg({ src, pos })),
    [], // no deps — setAnnotatingImg is stable
  );
  const editor = useEditor({
    extensions: [
      StarterKit,
      AnnotatableImage,
      Placeholder.configure({
        placeholder: "What did you ship, fix, or learn today?",
      }),
    ],
    content: `<p></p>`,
    editorProps: {
      handlePaste(_view, event) {
        const imageItems = Array.from(event.clipboardData?.items || []).filter(
          (i) => i.type.startsWith("image"),
        );

        if (imageItems.length === 0) return false;

        imageItems.forEach((item) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            editor
              .chain()
              .focus()
              .setImage({ src: ev.target?.result as string }) // ← into the doc, not state
              .run();
          };
          reader.readAsDataURL(item.getAsFile()!);
        });
        return true;
      },
    },
  });
  const editorState = useEditorState({
    editor,
    selector: ({ editor }) => ({
      isEmpty: editor.isEmpty,
    }),
  });

  // Load files → base64
  const loadFiles = (files: FileList) => {
    Array.from(files).forEach((file) => {
      if (!file || !file.type.startsWith("image/")) return;

      const reader = new FileReader();

      reader.onload = (ev: ProgressEvent<FileReader>) => {
        const result = ev.target?.result;
        if (typeof result === "string") {
          editor?.chain().focus().setImage({ src: result, width: 600 }).run();
        }
      };

      reader.readAsDataURL(file);
    });
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const submit = () => {
    const html = editor.getHTML();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const blocks: BlockType[] = [];
    doc.body.childNodes.forEach((node, i) => {
      if (node.nodeName === "IMG") {
        blocks.push({
          type: "image",
          src: (node as HTMLImageElement).src,
          position: i,
        });
      } else {
        const outerHTML = (node as HTMLElement).outerHTML;
        if (outerHTML)
          blocks.push({ type: "text", html: outerHTML, position: i });
      }
    });

    onPost({ title: title.trim(), blocks, tags: selectedTags });
    setTitle("");

    editor.commands.clearContent();
    setSelectedTags([]);
  };

  return (
    <Paper sx={{ mb: 2, overflow: "hidden" }}>
      {/* Collapsed trigger */}
      {!open && (
        <Stack
          direction="row"
          alignItems="center"
          gap={2}
          sx={{ p: 2, cursor: "pointer" }}
          onClick={() => setOpen(true)}
        >
          {currentUser && <Av user={currentUser} size={34} />}

          <Typography
            sx={{ color: "text.secondary", fontSize: "0.9rem", flex: 1 }}
          >
            What did you work on today?
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<Add />}
            sx={{ borderRadius: 2 }}
          >
            Log Activity
          </Button>
        </Stack>
      )}

      {/* Expanded editor */}
      <Collapse in={open}>
        <Box
          sx={{
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {/* Toolbar */}
          <Stack
            direction="row"
            gap={0.5}
            sx={{ px: 2, pt: 1.5, pb: 1, flexWrap: "wrap" }}
          >
            <EditorToolbar editor={editor} />
          </Stack>
          {/* Title */}
          <Box sx={{ px: 2, pt: 1 }}>
            <Typography
              component="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              sx={{
                width: "100%",
                border: "none",
                outline: "none",
                bgcolor: "transparent",
                fontSize: "1.1rem",
                fontWeight: 600,
                color: "text.primary",
                "::placeholder": {
                  color: "text.secondary",
                  fontWeight: 400,
                },
              }}
            />
          </Box>
          <Divider />
        </Box>
        {/* Editor area */}
        <Box
          sx={{
            position: "relative",
            margin: 2,
            height: 800,
            overflowY: "auto",
          }}
        >
          <EditorContent editor={editor} />
          {/* Placeholder style */}
        </Box>
        {/* Per-image annotator */}
        {annotatingImg && (
          <ImageAnnotator
            imageSrc={annotatingImg.src}
            onSave={(dataUrl: string) => {
              if (annotatingImg.pos === -1) {
                editor.chain().focus().setImage({ src: dataUrl }).run();
              } else {
                editor
                  .chain()
                  .focus()
                  .setNodeSelection(annotatingImg.pos)
                  .setImage({ src: dataUrl })
                  .run();
              }
              setAnnotatingImg(null);
            }}
            onClose={() => setAnnotatingImg(null)}
            onDelete={() => {
              editor
                .chain()
                .focus()
                .setNodeSelection(annotatingImg.pos)
                .deleteSelection()
                .run();
              setAnnotatingImg(null);
            }}
          />
        )}
        {/* Tag selector */}
        <Box sx={{ px: 2, pb: 1 }}>
          <Stack direction="row" gap={0.5} flexWrap="wrap">
            {tags &&
              selectedTags.map((tag) => {
                const color = tags.find((item) => item.label === tag)?.color;
                return (
                  <Chip
                    key={tag}
                    label={`#${tag}`}
                    size="small"
                    onDelete={() => toggleTag(tag)}
                    sx={{
                      bgcolor: alpha(color || "#666", 0.15),
                      color: color || "#fff",
                      borderColor: alpha(color || "#666", 0.3),
                      border: "1px solid",
                    }}
                  />
                );
              })}
            <Chip
              icon={<TagIcon sx={{ fontSize: "0.8rem !important" }} />}
              label="Add tag"
              size="small"
              onClick={(e) => setTagAnchor(e.currentTarget)}
              sx={{
                bgcolor: "transparent",
                color: "text.secondary",
                border: "1px dashed rgba(255,255,255,0.15)",
                cursor: "pointer",
                "&:hover": {
                  borderColor: "primary.main",
                  color: "primary.main",
                },
              }}
            />
          </Stack>
        </Box>
        <Divider />
        {/* Bottom toolbar */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ px: 2, py: 1 }}
        >
          <Stack direction="row" gap={0.5}>
            <Tooltip title="Attach Image">
              <IconButton
                size="small"
                onClick={() => fileRef.current?.click()}
                sx={{
                  color: "text.secondary",
                  "&:hover": { color: "primary.main" },
                }}
              >
                <ImageIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Draw">
              <IconButton
                size="small"
                onClick={() => setAnnotatingImg({ src: "", pos: -1 })}
                sx={{
                  color: annotatingImg ? "primary.main" : "text.secondary",
                  "&:hover": { color: "primary.main" },
                }}
              >
                <Brush fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Stack direction="row" gap={1}>
            <Button
              size="small"
              onClick={() => {
                setOpen(false);
                if (editor && !editorState.isEmpty) {
                  editor.commands.clearContent();
                }
                setSelectedTags([]);
              }}
              sx={{ color: "text.secondary" }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              size="small"
              endIcon={<Send fontSize="small" />}
              onClick={submit}
              disabled={!editor || editorState.isEmpty}
              sx={{ px: 2 }}
            >
              Post Log
            </Button>
          </Stack>
        </Stack>
        <input
          type="file"
          accept="image/*"
          ref={fileRef}
          hidden
          onChange={(e) => {
            if (e.target.files != null) {
              loadFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </Collapse>

      {/* Tag menu */}
      <Menu
        anchorEl={tagAnchor}
        open={Boolean(tagAnchor)}
        onClose={() => setTagAnchor(null)}
        PaperProps={{
          sx: { bgcolor: "background.paper", p: 1, minWidth: 240 },
        }}
      >
        <Typography
          variant="caption"
          sx={{ px: 1, color: "text.secondary", fontFamily: "monospace" }}
        >
          SELECT TAGS
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, p: 1 }}>
          {tags?.map(({ label, color }) => (
            <Chip
              key={label}
              label={`#${label}`}
              size="small"
              onClick={() => {
                toggleTag(label);
                setTagAnchor(null);
              }}
              sx={{
                bgcolor: selectedTags.includes(label)
                  ? alpha(color, 0.2)
                  : "transparent",
                color: color,
                border: "1px solid",
                borderColor: alpha(color, 0.4),
                cursor: "pointer",
              }}
            />
          ))}
        </Box>
      </Menu>
    </Paper>
  );
};
