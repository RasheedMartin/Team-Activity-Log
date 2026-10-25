import type { Asset, ID, ImageType } from "../api/contract";
import { uuidv7 } from "../lib/ids";
import { db, type AssetRow } from "./db";
import { reindex } from "./server";

// Image processing (the §B7 worker, simulated): content hash for dedupe, real dimensions and a
// dominant color from the pixels; thumbnails/OCR "finish" shortly after so the UI never blocks.

async function sha256Hex(blob: Blob) {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function inspect(blob: Blob): Promise<{ width: number; height: number; color: string }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 800;
    const height = img.naturalHeight || 600;
    let color = "#808080";
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      color = `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
    } catch {
      // tainted canvas or unsupported: keep the neutral placeholder color
    }
    return { width, height, color };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function guessType(filename: string, mime: string): ImageType {
  const f = filename.toLowerCase();
  if (/screen ?shot|capture|screenshot/.test(f)) return "screenshot";
  if (/diagram|schematic|layout/.test(f)) return "diagram";
  if (mime === "image/jpeg" || /img_|dsc|photo/.test(f)) return "photo";
  return "chart";
}

const CANNED_OCR: Record<ImageType, string> = {
  chart: "Counts Energy (keV) run calibration peak",
  screenshot: "run status OK rate trigger",
  diagram: "Source Detector DAQ",
  photo: "",
  table: "run channel value",
};

/** Create (or reuse, by content hash within the org) an image asset from a blob. */
export async function createAsset(orgId: ID, blob: Blob, filename: string, sourceKind: Asset["metadata"]["sourceKind"]): Promise<{ asset: AssetRow; created: boolean }> {
  const sha = await sha256Hex(blob);
  const existing = db.t.assets.find((a) => a.orgId === orgId && a.sha256 === sha);
  if (existing) return { asset: existing, created: false };
  const { width, height, color } = await inspect(blob);
  const mime = blob.type || "image/png";
  const type = guessType(filename, mime);
  const scale = (w: number) => ({ width: Math.min(w, width), height: Math.round((height * Math.min(w, width)) / width) });
  const row: AssetRow = db.t.assets.put({
    id: uuidv7(),
    orgId,
    kind: "image",
    mime,
    bytes: blob.size,
    width,
    height,
    sha256: sha,
    originalFilename: filename,
    dominantColors: [color],
    variants: [
      { name: "thumb", url: "", ...scale(320) },
      { name: "small", url: "", ...scale(640) },
      { name: "medium", url: "", ...scale(1280) },
      { name: "original", url: "", width, height },
    ],
    processing: "pending",
    metadata: { ocrState: "pending", detectedType: type, sourceKind, ...(type === "photo" && sourceKind !== "pptx_import" ? { exif: { capturedAt: new Date(Date.now() - 3_600_000).toISOString(), cameraMake: "Canon", cameraModel: "EOS R6" } } : {}) },
    blob,
  });
  setTimeout(() => {
    const a = db.t.assets.get(row.id);
    if (!a) return;
    db.t.assets.put({ ...a, processing: "ready", metadata: { ...a.metadata, ocrState: "ready", ocrEngine: "mock", ocrText: sourceKind === "pptx_import" ? a.metadata.ocrText : CANNED_OCR[type] } });
    db.t.images.filter((i) => i.assetId === row.id && !!i.postId).forEach((i) => reindex(i.postId!));
  }, 1200);
  return { asset: row, created: true };
}
