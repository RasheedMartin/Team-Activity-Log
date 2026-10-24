import { BrushOutlined, DeleteOutlineRounded, ErrorOutlineRounded, InfoOutlined, RefreshRounded, SwapHorizRounded } from "@mui/icons-material";
import { Box, Button, IconButton, InputBase, LinearProgress, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import type { ImageView } from "../../../api/contract";
import { AnnotationLayer } from "../../../components/AnnotationLayer";

/** An image with its stored aspect ratio reserved (no layout shift) and annotations overlaid. */
export function AnnotatedImage({ image, maxHeight = 520, onClick, variant = "medium", children }: { image: ImageView; maxHeight?: number; onClick?: () => void; variant?: "small" | "medium" | "original"; children?: ReactNode }) {
  const a = image.asset;
  const src = (a.variants.find((v) => v.name === variant) ?? a.variants[a.variants.length - 1])?.url;
  const [loaded, setLoaded] = useState(false);
  return (
    <Box
      onClick={onClick}
      sx={{
        position: "relative",
        width: "100%",
        maxWidth: `calc(${maxHeight}px * ${a.width / a.height})`,
        aspectRatio: `${a.width} / ${a.height}`,
        bgcolor: a.dominantColors[0] ?? "action.hover",
        borderRadius: 1,
        overflow: "visible",
        cursor: onClick ? "zoom-in" : undefined,
        border: 1,
        borderColor: "divider",
      }}
    >
      <Box component="img" src={src} alt={image.altText ?? image.caption ?? ""} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} sx={{ width: "100%", height: "100%", display: "block", objectFit: "contain", opacity: loaded ? 1 : 0, transition: "opacity 150ms" }} />
      <AnnotationLayer shapes={image.annotation?.shapes ?? []} width={a.width} height={a.height} />
      {children}
    </Box>
  );
}

interface Props {
  image: ImageView;
  readOnly?: boolean;
  onAnnotate: () => void;
  onDetails: () => void;
  onReplace: (file: File) => void;
  onRemove: () => void;
  onCaption: (caption: string) => void;
}

export function ImageBlock({ image, readOnly, onAnnotate, onDetails, onReplace, onRemove, onCaption }: Props) {
  const [caption, setCaption] = useState(image.caption ?? "");
  useEffect(() => setCaption(image.caption ?? ""), [image.caption]);
  const shapes = image.annotation?.shapes.length ?? 0;
  return (
    <Box>
      <Box sx={{ position: "relative", "&:hover .img-actions, &:focus-within .img-actions": { opacity: 1 } }}>
        <AnnotatedImage image={image} onClick={readOnly ? undefined : onAnnotate} maxHeight={400} />
        {!readOnly && (
          <Stack className="img-actions" direction="row" spacing={0.5} sx={{ position: "absolute", top: 8, right: 8, opacity: 0, transition: "opacity 120ms", bgcolor: "background.paper", borderRadius: 1, boxShadow: 2, p: 0.25 }}>
            <Tooltip title="Annotate"><IconButton size="small" onClick={onAnnotate} aria-label="Annotate image"><BrushOutlined fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Image details"><IconButton size="small" onClick={onDetails} aria-label="Image details"><InfoOutlined fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Replace image">
              <IconButton size="small" component="label" aria-label="Replace image">
                <SwapHorizRounded fontSize="small" />
                <input hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onReplace(e.target.files[0])} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Remove"><IconButton size="small" onClick={onRemove} aria-label="Remove image"><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
          </Stack>
        )}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
        {image.figureLabel && <Typography variant="caption" sx={{ fontWeight: 600 }}>{image.figureLabel}</Typography>}
        <InputBase
          value={caption}
          readOnly={readOnly}
          placeholder={readOnly ? "" : "Add a caption"}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (image.caption ?? "") && onCaption(caption)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputProps={{ "aria-label": "Caption" }}
          sx={{ flex: 1, fontSize: "0.82rem", color: "text.secondary" }}
        />
        {shapes > 0 && <Typography variant="caption" color="text.disabled">{shapes} annotation{shapes > 1 ? "s" : ""}</Typography>}
        {!readOnly && !image.altText && (
          <Button size="small" onClick={onDetails} sx={{ fontSize: "0.72rem", color: "text.disabled", minWidth: 0 }}>
            + alt text
          </Button>
        )}
        {image.asset.processing === "pending" && <Typography variant="caption" color="text.disabled">processing…</Typography>}
      </Stack>
    </Box>
  );
}

export interface UploadState {
  id: string;
  file: File;
  preview: string;
  progress: number;
  error?: string;
}

export function UploadingBlock({ u, onRetry, onRemove }: { u: UploadState; onRetry: () => void; onRemove: () => void }) {
  return (
    <Box sx={{ position: "relative", border: 1, borderColor: u.error ? "error.main" : "divider", borderRadius: 1, overflow: "hidden", maxWidth: 520 }}>
      <Box component="img" src={u.preview} alt="" sx={{ width: "100%", maxHeight: 280, objectFit: "contain", display: "block", opacity: 0.5, bgcolor: "action.hover" }} />
      <Box sx={{ position: "absolute", inset: "auto 0 0 0", p: 1, bgcolor: "background.paper" }}>
        {u.error ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <ErrorOutlineRounded color="error" fontSize="small" />
            <Typography variant="caption" sx={{ flex: 1 }} color="error">{u.error}</Typography>
            <Button size="small" startIcon={<RefreshRounded />} onClick={onRetry}>Retry</Button>
            <Button size="small" onClick={onRemove}>Remove</Button>
          </Stack>
        ) : (
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary" noWrap>Uploading {u.file.name || "image"}… {Math.round(u.progress * 100)}%</Typography>
            <LinearProgress variant="determinate" value={u.progress * 100} />
          </Stack>
        )}
      </Box>
    </Box>
  );
}
