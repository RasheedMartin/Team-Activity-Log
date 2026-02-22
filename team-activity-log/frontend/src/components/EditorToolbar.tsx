import {
  FormatBold,
  FormatItalic,
  FormatUnderlined,
  FormatStrikethrough,
  Code,
  FormatListBulleted,
  FormatListNumbered,
  FormatQuote,
  DataObject,
  Undo,
  Redo,
} from "@mui/icons-material";
import { Tooltip, IconButton, Box, Divider } from "@mui/material";
import { Editor, useEditorState } from "@tiptap/react";

interface EditorToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  title: string;
  active: boolean;
  down: () => void;
  children: React.ReactNode;
}
type ToolbarItem =
  | {
      type: "button";
      title: string;
      icon: React.ReactNode;
      active: boolean;
      down: () => void;
    }
  | { type: "divider" };
// ─── TIPTAP TOOLBAR ───────────────────────────────────────────────────────────
export const EditorToolbar = ({ editor }: EditorToolbarProps) => {
  const editorState = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
    }),
  });
  if (!editor) return null;

  const B = ({ active, down, children, title }: ToolbarButtonProps) => (
    <Tooltip title={title}>
      <IconButton
        disableRipple
        onMouseDown={(e) => {
          e.preventDefault();
          down();
        }}
        sx={{
          backgroundColor: active ? "#f59e0b1a" : "transparent",
          border: "none",
          borderRadius: 4,
          color: active ? "#2196f3" : "#4a5568",
          cursor: "pointer",
          padding: "3px 7px",
          fontSize: ".78rem",
          fontFamily: "monospace",
          fontWeight: active ? 700 : 400,

          "&:active": {
            backgroundColor: "#2196f3",
          },
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
  const toolbarButtons: ToolbarItem[] = [
    {
      type: "button",

      title: "Bold",
      icon: <FormatBold />,
      active: editorState.bold,
      down: () => editor.chain().focus().toggleBold().run(),
    },
    {
      type: "button",

      title: "Italic",
      icon: <FormatItalic />,
      active: editorState.italic,
      down: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      type: "button",

      title: "Underline",
      icon: <FormatUnderlined />,
      active: editorState.underline,
      down: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      type: "button",

      title: "Strike",
      icon: <FormatStrikethrough />,
      active: editorState.strike,
      down: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      type: "button",

      title: "Code",
      icon: <Code />,
      active: editorState.code,
      down: () => editor.chain().focus().toggleCode().run(),
    },
    { type: "divider" },

    {
      type: "button",

      title: "Bullets",
      icon: <FormatListBulleted />,
      active: editorState.bulletList,
      down: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      type: "button",

      title: "Numbers",
      icon: <FormatListNumbered />,
      active: editorState.orderedList,
      down: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      type: "button",

      title: "Quote",
      icon: <FormatQuote />,
      active: editorState.blockquote,
      down: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      type: "button",

      title: "Code block",
      icon: <DataObject />,
      active: editorState.codeBlock,
      down: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    { type: "divider" },

    {
      type: "button",

      title: "Undo",
      icon: <Undo />,
      active: false,
      down: () => editor.chain().focus().undo().run(),
    },
    {
      type: "button",

      title: "Redo",
      icon: <Redo />,
      active: false,
      down: () => editor.chain().focus().redo().run(),
    },
  ];

  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        padding: "6px 10px",
        borderBottom: "1px solid #ffffff0a",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {toolbarButtons.map((btn, i) =>
        btn.type === "divider" ? (
          <Divider
            key={`Box-${i}`}
            orientation="vertical"
            flexItem
            sx={{ backgroundColor: "#4a5568" }}
          />
        ) : (
          <B
            key={btn.title}
            title={btn.title}
            active={btn.active}
            down={btn.down}
          >
            {btn.icon}
          </B>
        ),
      )}
    </Box>
  );
};
