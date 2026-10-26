import { http, HttpResponse } from "msw";
import { uuidv7 } from "../../lib/ids";
import { db, type AttachmentRow } from "../db";
import { parseDocx } from "../docs";
import { fail, orgCtx, route } from "../server";

// Mirrors backend/src/tal/routes/attachments.py: files attached to posts, stored once per org,
// text extracted for search (PDF via pdf.js, Word, CSV and plain text), downloadable by people
// who can see a post holding them.

const MB = 1024 * 1024;
const LIMITS: Record<string, number> = { pdf: 100 * MB, docx: 100 * MB, xlsx: 25 * MB, csv: 25 * MB };
const BLOCKED = new Set(["exe", "dll", "bat", "cmd", "com", "msi", "scr", "js", "vbs", "ps1", "sh", "app", "jar"]);
const ext = (n: string) => (n.includes(".") ? n.split(".").pop()!.toLowerCase() : "");

async function extract(blob: Blob, name: string): Promise<string | undefined> {
  try {
    const e = ext(name);
    if (e === "pdf") {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) pages.push((await (await pdf.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
      return pages.join("\n").trim() || undefined;
    }
    if (e === "docx") return (await parseDocx(blob)).slides.map((s) => `${s.title}\n${s.text}`).join("\n").trim() || undefined;
    if (["csv", "tsv", "txt", "md", "json", "log"].includes(e)) return (await blob.text()).trim() || undefined;
  } catch {
    // unreadable: keep the file, skip its text
  }
  return undefined;
}

export const view = (a: AttachmentRow) => ({ id: a.id, filename: a.filename, mime: a.mime, bytes: a.bytes, searchable: !!a.text, url: a.url });

export const attachmentHandlers = [
  http.post(
    "/v1/orgs/:org/attachments",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const name = (new URL(request.url).searchParams.get("filename") ?? "file").replace(/[\\/]/g, "_").slice(0, 255);
      if (BLOCKED.has(ext(name))) fail(415, "unsupported_type", "Programs and scripts can't be attached");
      const blob = await request.blob();
      const limit = LIMITS[ext(name)] ?? 50 * MB;
      if (blob.size > limit) fail(413, "too_large", `Files like this must be under ${limit / MB} MB`);
      if (!blob.size) fail(422, "invalid", "The file is empty");
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");
      const found = db.t.attachments.find((a) => a.orgId === ctx.org.id && a.sha256 === sha);
      if (found) return HttpResponse.json(view(found), { status: 201 });
      const id = uuidv7();
      const row = db.t.attachments.put({ id, orgId: ctx.org.id, sha256: sha, filename: name, mime: request.headers.get("content-type") || "application/octet-stream", bytes: blob.size, text: await extract(blob, name), blob, createdBy: ctx.user.id, url: `/v1/orgs/${ctx.org.id}/attachments/${id}`, searchable: false });
      return HttpResponse.json(view(row), { status: 201 });
    }),
  ),
  http.get(
    "/v1/orgs/:org/attachments/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const a = db.t.attachments.get(params.id as string);
      if (!a || a.orgId !== ctx.org.id) fail(404, "not_found", "File not found");
      const visible =
        a!.createdBy === ctx.user.id ||
        db.t.posts.filter((p) => p.orgId === ctx.org.id && !p.deletedAt && (p.status === "published" || p.authorId === ctx.user.id) && p.blocks.some((b) => b.type === "file" && b.attachmentId === a!.id)).length > 0;
      if (!visible) fail(404, "not_found", "File not found");
      return new HttpResponse(a!.blob, { headers: { "Content-Type": a!.mime, "Content-Disposition": `attachment; filename="${a!.filename.replace(/"/g, "")}"` } });
    }),
  ),
];
