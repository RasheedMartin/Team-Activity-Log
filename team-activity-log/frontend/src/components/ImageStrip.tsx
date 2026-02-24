import { Edit, Close, AddPhotoAlternate } from "@mui/icons-material";
import {
  Stack,
  Box,
  Tooltip,
  IconButton,
  Typography,
  Dialog,
} from "@mui/material";
import type { BlockType } from "../interfaces/TeamActivityLogInterfaces";
import { useState } from "react";

type ImageBlock = Extract<BlockType, { type: "image" }>;

interface ImageStripType {
  images: ImageBlock[];
}

export const ImageStrip = ({ images }: ImageStripType) => {
  if (!images.length) return null;
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ px: 2, pb: 1.5 }}>
        {images.map((img, i) => {
          if (!img.src) return null;
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
                src={img.src}
                alt={`attachment ${i + 1}`}
                onClick={() => setPreviewIndex(i)}
                sx={{
                  display: "block",
                  height: 110,
                  width: "auto",
                  maxWidth: 180,
                  objectFit: "cover",
                  cursor: "zoom-in",
                  borderRadius: 1,
                }}
              />
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
      </Stack>
      <Dialog
        open={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        maxWidth="xl"
      >
        {previewIndex !== null && (
          <Box
            sx={{
              position: "relative",
              bgcolor: "black",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Close button */}
            <IconButton
              onClick={() => setPreviewIndex(null)}
              sx={{
                position: "absolute",
                top: 8,
                right: 8,
                color: "#fff",
                bgcolor: "rgba(0,0,0,.5)",
                "&:hover": { bgcolor: "rgba(0,0,0,.75)" },
              }}
            >
              <Close />
            </IconButton>

            {/* Image */}
            <Box
              component="img"
              src={images[previewIndex].src}
              sx={{
                maxWidth: "90vw",
                maxHeight: "85vh",
                height: 1000,
                objectFit: "contain",
              }}
            />
          </Box>
        )}
      </Dialog>
    </>
  );
};
