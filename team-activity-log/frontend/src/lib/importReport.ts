import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ImportJob, ImportPost } from "../api/contract";
import { formatDay } from "./dates";

// The import report as a PDF: what came in, what was published, what's still a draft or skipped,
// and every warning, slide by slide. Loaded on demand from the import page.

const slideRange = (ns: number[]) => (ns.length > 1 && ns[ns.length - 1] - ns[0] === ns.length - 1 ? `${ns[0]}–${ns[ns.length - 1]}` : ns.join(", "));

export function downloadImportReport(job: ImportJob, posts: ImportPost[], modeTitle: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const status = new Map(posts.map((p) => [p.source?.slide, p.status]));
  const published = posts.filter((p) => p.status === "published").length;
  const drafts = posts.filter((p) => p.status === "draft").length;
  const warnings = job.items.reduce((n, i) => n + (i.included ? i.warnings.length : 0), 0);

  doc.setFont("helvetica", "bold").setFontSize(18).text("Import report", margin, margin + 6);
  doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(80);
  doc.text(job.sourceFilename, margin, margin + 26);
  doc.text(`${modeTitle} · ${job.slideCount} slides · ${formatDay(new Date().toISOString().slice(0, 10))}`, margin, margin + 42);
  doc.setTextColor(20);
  autoTable(doc, {
    startY: margin + 58,
    theme: "plain",
    styles: { fontSize: 11, cellPadding: { top: 2, bottom: 2, left: 0, right: 16 } },
    margin: { left: margin, right: margin },
    body: [[`${job.report?.created ?? posts.length} posts created`, `${published} published`, `${drafts} still drafts`, `${job.report?.skipped ?? 0} skipped`, `${warnings} warnings`]],
  });

  autoTable(doc, {
    startY: ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin + 80) + 12,
    head: [["Slides", "Title", "Work date", "Status", "Warnings"]],
    body: job.items.map((i) => {
      const s = i.included ? (status.get(i.slideNumbers[0]) ?? "discarded") : "skipped";
      return [slideRange(i.slideNumbers), i.proposedTitle || "(untitled)", `${i.proposedDate}${i.dateSource === "guessed" ? " (guessed)" : ""}`, s[0].toUpperCase() + s.slice(1), i.included ? i.warnings.join("\n") || "—" : "—"];
    }),
    styles: { fontSize: 9, cellPadding: 5, valign: "top", overflow: "linebreak" },
    headStyles: { fillColor: [52, 81, 209], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 251] },
    columnStyles: { 0: { cellWidth: 48 }, 2: { cellWidth: 82 }, 3: { cellWidth: 64 }, 4: { cellWidth: 150 } },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(8).setTextColor(140).text(`${job.sourceFilename} · page ${n}`, margin, doc.internal.pageSize.getHeight() - 24);
      doc.setTextColor(20);
    },
  });
  doc.save(`${job.sourceFilename.replace(/\.pptx$/i, "")} import report.pdf`);
}
