import { http, HttpResponse } from "msw";
import type { ImageMetadata, OcrProviderId, OcrSettings } from "../../api/contract";
import { db } from "../db";
import { fail, now, orgCtx, reindex, route } from "../server";

// Mirrors backend/src/tal/routes/ocr.py. Mock orgs behave like Team (see the plan handler), so
// cloud engines show as a Business option; the built-in engine is "ready" and reads canned text.

const PROVIDERS: OcrSettings["providers"] = [
  { id: "tesseract", name: "Built-in (Tesseract)", cloud: false, fields: [] },
  { id: "google", name: "Google Cloud Vision", cloud: true, fields: ["apiKey"] },
  { id: "azure", name: "Azure AI Vision", cloud: true, fields: ["endpoint", "apiKey"] },
  { id: "aws", name: "AWS Textract", cloud: true, fields: ["accessKeyId", "secretAccessKey", "region"] },
];
const chosen = new Map<string, OcrProviderId>(); // orgId → provider (the mock never stores keys)

function view(orgId: string): OcrSettings {
  const counts: OcrSettings["counts"] = {};
  for (const a of db.t.assets.filter((x) => x.orgId === orgId)) counts[a.metadata.ocrState] = (counts[a.metadata.ocrState] ?? 0) + 1;
  return { provider: chosen.get(orgId) ?? "tesseract", active: "tesseract", cloudAllowed: false, builtInReady: true, providers: PROVIDERS, saved: {}, counts };
}

export const ocrHandlers = [
  http.get(
    "/v1/orgs/:org/ocr",
    route(({ cookies, params }) => HttpResponse.json(view(orgCtx(cookies, params.org as string, "admin").org.id))),
  ),
  http.put(
    "/v1/orgs/:org/ocr",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const body = (await request.json()) as { provider: OcrProviderId; forget?: boolean };
      if (!PROVIDERS.some((p) => p.id === body.provider)) fail(422, "invalid", "Choose an OCR engine");
      if (body.provider !== "tesseract" && !body.forget) fail(402, "plan_limit", "Cloud OCR engines are on the Business plan. The built-in engine is included on every plan.");
      chosen.set(ctx.org.id, "tesseract");
      return HttpResponse.json(view(ctx.org.id));
    }),
  ),
  http.post(
    "/v1/orgs/:org/ocr/reread",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const which = ((await request.json().catch(() => ({}))) as { which?: string }).which === "all" ? "all" : "failed";
      const assets = db.t.assets.filter((a) => a.orgId === ctx.org.id && a.metadata.ocrState !== "edited" && (which === "all" || a.metadata.ocrState === "failed"));
      for (const a of assets) db.t.assets.put({ ...a, metadata: { ...a.metadata, ocrState: "ready", ocrEngine: "tesseract", ocrAt: now(), ocrError: undefined } });
      return HttpResponse.json({ queued: assets.length });
    }),
  ),
  http.put(
    "/v1/orgs/:org/assets/:id/ocr",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const a = db.t.assets.get(params.id as string);
      if (!a || a.orgId !== ctx.org.id) fail(404, "not_found", "Image not found");
      const text = String(((await request.json()) as { text?: string }).text ?? "")
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter((l) => /\w/.test(l))
        .join("\n");
      const ocrState: ImageMetadata["ocrState"] = text ? "edited" : "empty";
      db.t.assets.put({ ...a!, metadata: { ...a!.metadata, ocrState, ocrText: text || undefined, ocrEngine: "person", ocrAt: now(), ocrError: undefined } });
      db.t.images.filter((i) => i.assetId === a!.id && !!i.postId).forEach((i) => reindex(i.postId!));
      return HttpResponse.json({ ocrState, ocrText: text });
    }),
  ),
];
