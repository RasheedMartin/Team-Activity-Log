import { Chip } from "@mui/material";

interface TagRequestType {
  tag: string;
  active: boolean;
  color: string;
  onClick?: () => void;
  onRemove?: () => void;
}

// Individual Tags
export const Tag = ({
  tag,
  active,
  color,
  onClick,
  onRemove,
}: TagRequestType) => {
  return (
    <Chip
      onClick={onClick}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        padding: "1px 1px",
        borderRadius: 4,
        fontSize: ".68rem",
        cursor: onClick ? "pointer" : "default",
        fontFamily: "monospace",
        background: active ? `${color}28` : `${color}12`,
        color: color,
        border: `1px solid ${active ? `${color}50` : `${color}20`}`,
      }}
      label={"#" + tag}
      onDelete={
        onRemove &&
        ((e) => {
          e.stopPropagation();
          onRemove();
        })
      }
    />
  );
};
