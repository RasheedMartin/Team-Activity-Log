import { Box } from "@mui/material";
import { useState } from "react";
import { Av } from "./AvatarComponent";
import { sBtn } from "../utilities/TeamLogsUtilities";
import type { UserData } from "../interfaces/TeamActivityLogInterfaces";

export interface ReplyBoxProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  placeholder: string;
  users: UserData[];
}

// ─── INLINE REPLY COMPOSER ────────────────────────────────────────────────────
export const ReplyBox = ({
  onSubmit,
  onCancel,
  placeholder = "Reply…",
  users,
}: ReplyBoxProps) => {
  const [text, setText] = useState("");
  const ME = users[0];

  return (
    <Box
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        marginTop: 6,
      }}
    >
      <Av user={ME} size={24} />
      <Box style={{ flex: 1 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) onSubmit(text);
              setText("");
            }
          }}
          style={{
            width: "100%",
            background: "#0b0f18",
            border: "1px solid #ffffff12",
            borderRadius: 6,
            padding: "6px 10px",
            color: "#e2e8f0",
            fontSize: ".8rem",
            fontFamily: "'IBM Plex Sans',sans-serif",
            resize: "none",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <Box style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            onClick={() => {
              if (text.trim()) onSubmit(text);
              setText("");
            }}
            disabled={!text.trim()}
            style={{
              ...sBtn,
              background: text.trim() ? "#f59e0b" : "#f59e0b44",
              color: "#000",
              fontWeight: 700,
              border: "none",
              fontSize: ".72rem",
              padding: "3px 10px",
            }}
          >
            Reply
          </button>
          <button
            onClick={onCancel}
            style={{ ...sBtn, fontSize: ".72rem", padding: "3px 10px" }}
          >
            Cancel
          </button>
        </Box>
      </Box>
    </Box>
  );
};
