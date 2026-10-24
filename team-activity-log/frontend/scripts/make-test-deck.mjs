// Builds e2e/fixtures/Lab_Notes_2021.pptx: a small but structurally real PowerPoint package
// (presentation, sections, layouts, slides, notes, media) used by parser and E2E tests.
// Usage: node scripts/make-test-deck.mjs
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const png = readFileSync(join(ROOT, "e2e/fixtures/spectrum.png"));
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const run = (t, { b, i } = {}) => `<a:r><a:rPr lang="en-US"${b ? ' b="1"' : ""}${i ? ' i="1"' : ""}/><a:t>${esc(t)}</a:t></a:r>`;
const para = (...runs) => `<a:p>${runs.join("")}</a:p>`;
const title = (t) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${para(run(t))}</p:txBody></p:sp>`;
const body = (...paras) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paras.join("")}</p:txBody></p:sp>`;
const textBox = (t) => `<p:sp><p:nvSpPr><p:cNvPr id="4" name="TextBox"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/>${para(run(t))}</p:txBody></p:sp>`;
const pic = (rid) => `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill><p:spPr/></p:pic>`;
const tbl = (rows) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${rows.map((r) => `<a:tr>${r.map((c) => `<a:tc><a:txBody><a:bodyPr/>${para(run(c))}</a:txBody></a:tc>`).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`;
const slideXml = (shapes, extra = "") => `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes.join("")}</p:spTree></p:cSld>${extra}</p:sld>`;
const notesXml = (t) => `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${para(run(t))}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
const TIMING = "<p:timing><p:tnLst/></p:timing>";
const TRANSITION = '<p:transition spd="med"><p:fade/></p:transition>';

const slides = [
  { section: "Cooldown", shapes: [title("Cooldown overview"), body(para(run("Started 2024-03-12")), para(run("Cryostat reached "), run("4.1 K", { b: true })))], notes: "Mention the pump schedule" },
  { section: "Cooldown", shapes: [title("Cooldown curve"), pic("rIdImg"), textBox("Curve from run 4512")], image: true, extra: TIMING },
  { section: "Cooldown", shapes: [textBox("Loose notes, 14 Mar 2024")] },
  { section: "Calibration", shapes: [title("Calibration results"), tbl([["Channel", "Gain"], ["12", "1.02"], ["13", "0.98"]]), textBox("Taken March 20, 2024")] },
  { section: "Calibration", shapes: [title("Gain plot"), pic("rIdImg"), chart], image: true },
  { section: "Calibration", shapes: [title("Calibration issues"), body(para(run("Channel 12 is "), run("noisy", { i: true })), para(run("Replace the connector")))] },
  { section: "Analysis", shapes: [title("Analysis summary"), textBox("3/28/2024 summary of the run")], notes: "Thank the beam team" },
  { section: "Analysis", shapes: [title("Next steps"), body(para(run("Repeat with shielding")), para(run("Write up for the group meeting")))], extra: TRANSITION },
];

const zip = new JSZip();
zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
const sections = [...new Set(slides.map((s) => s.section))];
zip.file(
  "ppt/presentation.xml",
  `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join("")}</p:sldIdLst><p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${sections
    .map((name) => `<p14:section name="${name}" id="{${name}}"><p14:sldIdLst>${slides.map((s, i) => (s.section === name ? `<p14:sldId id="${256 + i}"/>` : "")).join("")}</p14:sldIdLst></p14:section>`)
    .join("")}</p14:sectionLst></p:ext></p:extLst></p:presentation>`,
);
zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`);
zip.file("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS} type="obj"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
zip.file("ppt/media/image1.png", png);
slides.forEach((s, i) => {
  const n = i + 1;
  zip.file(`ppt/slides/slide${n}.xml`, slideXml(s.shapes, s.extra));
  const r = [`<Relationship Id="rIdL" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
  if (s.image) r.push(`<Relationship Id="rIdImg" Type="${REL}/image" Target="../media/image1.png"/>`);
  if (s.notes) {
    r.push(`<Relationship Id="rIdN" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`);
    zip.file(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(s.notes));
  }
  zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join("")}</Relationships>`);
});
const out = join(ROOT, "e2e/fixtures/Lab_Notes_2021.pptx");
writeFileSync(out, await zip.generateAsync({ type: "nodebuffer" }));
console.log("wrote", out);
