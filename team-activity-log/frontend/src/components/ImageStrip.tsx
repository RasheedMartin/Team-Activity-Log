import { Edit, Close, AddPhotoAlternate } from "@mui/icons-material";
import { Stack, Box, Tooltip, IconButton, Typography } from "@mui/material";

interface ImageStripType {
  images: string[];
  onAnnotate: (i: number) => void;
  onRemove?: (idx: number) => void;
  onAdd?: () => void;
  mode: string;
}

export const ImageStrip = ({
  images,
  onAnnotate,
  onRemove,
  onAdd,
  mode = "view",
}: ImageStripType) => {
  if (!images.length && mode === "view") return null;
  return (
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ px: 2, pb: 1.5 }}>
      {images.map((src, i) => {
        if (!src) return null;
        return (
          <Box
            key={i}
            sx={{
              position: "relative",
              display: "inline-block",
              borderRadius: 1,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              "&:hover .img-actions": { opacity: 1 },
            }}
          >
            <Box
              component="img"
              src={src}
              alt={`attachment ${i + 1}`}
              sx={{
                display: "block",
                height: 110,
                width: "auto",
                maxWidth: 180,
                objectFit: "cover",
                cursor: "pointer",
                borderRadius: 1,
              }}
              onClick={() => onAnnotate(i)}
            />
            {/* Hover overlay */}
            <Stack
              className="img-actions"
              direction="row"
              gap={0.25}
              sx={{
                position: "absolute",
                top: 4,
                right: 4,
                opacity: 0,
                transition: "opacity .15s",
                bgcolor: "rgba(0,0,0,.6)",
                borderRadius: 1,
                p: 0.25,
              }}
            >
              <Tooltip title="Annotate">
                <IconButton
                  size="small"
                  onClick={() => onAnnotate(i)}
                  sx={{ color: "#fff", p: "2px" }}
                >
                  <Edit sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              {mode === "edit" && onRemove && (
                <Tooltip title="Remove">
                  <IconButton
                    size="small"
                    onClick={() => onRemove(i)}
                    sx={{ color: "#f44336", p: "2px" }}
                  >
                    <Close sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            {/* Index badge */}
            <Box
              sx={{
                position: "absolute",
                bottom: 4,
                left: 4,
                bgcolor: "rgba(0,0,0,.65)",
                borderRadius: 0.5,
                px: 0.75,
                py: 0.1,
                fontSize: ".65rem",
                fontFamily: "monospace",
                color: "#fff",
              }}
            >
              {i + 1}/{images.length}
            </Box>
          </Box>
        );
      })}
      {/* Add more button (edit mode) */}
      {mode === "edit" && onAdd && (
        <Box
          onClick={onAdd}
          sx={{
            width: 80,
            height: 110,
            border: "2px dashed",
            borderColor: "divider",
            borderRadius: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "text.disabled",
            gap: 0.5,
            "&:hover": { borderColor: "primary.main", color: "primary.main" },
            transition: "all .15s",
          }}
        >
          <AddPhotoAlternate sx={{ fontSize: 22 }} />
          <Typography variant="caption">Add</Typography>
        </Box>
      )}
    </Stack>
  );
};
