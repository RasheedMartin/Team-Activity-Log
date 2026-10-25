// Builds e2e/fixtures/Lab_Notes_2021.pptx: a small but structurally real PowerPoint package
// (presentation, sections, layouts, slides, notes, media) used by parser and E2E tests, and
// e2e/fixtures/Formatting_2024.pptx: theme colors, positioned shapes, numbered/nested lists,
// links, highlight, alignment, a styled table, a chart with data, and SmartArt — plus, for
// designed slides, a master with a background, logo, color bar and title style, a group, an arrow
// connector, mixed font sizes, SmartArt with its drawing cache, a styled table with column widths,
// a run in another typeface, a see-through shape, and a deck default text size.
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

// ---- Formatting_2024.pptx ----

const EMU = 914400; // per inch
const at = (x, y) => `<p:spPr><a:xfrm><a:off x="${Math.round(x * EMU)}" y="${Math.round(y * EMU)}"/><a:ext cx="${4 * EMU}" cy="${EMU}"/></a:xfrm></p:spPr>`;
const r2 = (t, pr = "", inner = "") => `<a:r><a:rPr lang="en-US"${pr}>${inner}</a:rPr><a:t>${esc(t)}</a:t></a:r>`;
const p2 = (ppr, ...runs) => `<a:p>${ppr}${runs.join("")}</a:p>`;
const sp = (id, { ph = "", pos = "", paras, txBox = false }) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="S${id}"/><p:cNvSpPr${txBox ? ' txBox="1"' : ""}/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>${pos}<p:txBody><a:bodyPr/>${paras.join("")}</p:txBody></p:sp>`;
const solid = (inner) => `<a:solidFill>${inner}</a:solidFill>`;
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DGM = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const DSP = "http://schemas.microsoft.com/office/drawing/2008/diagram";
const xf = (x, y, w, h, extra = "") => `<a:xfrm${extra}><a:off x="${Math.round(x * EMU)}" y="${Math.round(y * EMU)}"/><a:ext cx="${Math.round(w * EMU)}" cy="${Math.round(h * EMU)}"/></a:xfrm>`;

const fmtSlides = [
  {
    layout: 1,
    shapes: [
      sp(2, { ph: '<p:ph type="ctrTitle"/>', paras: [para(run("Quarterly review"))] }),
      sp(3, { ph: '<p:ph type="subTitle" idx="1"/>', paras: [p2('<a:pPr algn="ctr"/>', run("Detector group"))] }),
    ],
  },
  {
    layout: 2,
    rels: [`<Relationship Id="rIdImg" Type="${REL}/image" Target="../media/image1.png"/>`, `<Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://example.test/run" TargetMode="External"/>`],
    shapes: [
      sp(2, { ph: '<p:ph type="title"/>', paras: [para(run("Results"))] }),
      // z-order deliberately differs from reading order
      `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill>${at(0.5, 3.5)}</p:pic>`,
      sp(4, { txBox: true, pos: at(5, 1.5), paras: [para(run("Right column"))] }),
      sp(5, {
        ph: '<p:ph idx="1"/>', // no position: inherits the layout's (top left)
        paras: [
          para(run("Gain stable")),
          p2('<a:pPr lvl="1"/>', run("Channel 12 fixed")),
          p2('<a:pPr><a:buAutoNum type="arabicPeriod" startAt="3"/></a:pPr>', run("Third step")),
          p2('<a:pPr><a:buAutoNum type="arabicPeriod" startAt="3"/></a:pPr>', run("Fourth step")),
          p2('<a:pPr><a:buNone/></a:pPr>', r2("critical", "", solid('<a:srgbClr val="C00000"/>')), r2(" accent", "", solid('<a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr>')), r2(" plain", "", solid('<a:srgbClr val="000000"/>'))),
          p2('<a:pPr><a:buNone/></a:pPr>', r2("flagged", "", '<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>'), r2(" run log", "", '<a:hlinkClick r:id="rIdLink"/>'), r2(" old value", ' strike="sngStrike"')),
        ],
      }),
      sp(6, { txBox: true, pos: at(0.5, 5), paras: [p2("", r2("Big takeaway", ' sz="3600"'))] }),
      sp(7, { txBox: true, pos: at(0.5, 6), paras: [p2('<a:pPr algn="ctr"/>', run("Centered note"))] }),
    ],
  },
  {
    layout: 2,
    rels: [`<Relationship Id="rIdChart" Type="${REL}/chart" Target="../charts/chart1.xml"/>`, `<Relationship Id="rIdDm" Type="${REL}/diagramData" Target="../diagrams/data1.xml"/>`],
    shapes: [
      sp(2, { ph: '<p:ph type="title"/>', paras: [para(run("Data"))] }),
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${EMU / 2}" y="${1.5 * EMU}"/><a:ext cx="${4 * EMU}" cy="${EMU}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/>` +
        `<a:tr><a:tc gridSpan="2"><a:txBody><a:bodyPr/>${para(run("Run summary"))}</a:txBody></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/>${para(run(""))}</a:txBody></a:tc></a:tr>` +
        `<a:tr><a:tc><a:txBody><a:bodyPr/>${para(run("Gain"))}</a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/>${para(run("1.02"))}${para(run("stable"))}</a:txBody></a:tc></a:tr>` +
        `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${EMU / 2}" y="${3 * EMU}"/><a:ext cx="${4 * EMU}" cy="${EMU}"/></p:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>`,
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="SmartArt"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${EMU / 2}" y="${5 * EMU}"/><a:ext cx="${4 * EMU}" cy="${EMU}"/></p:xfrm><a:graphic><a:graphicData uri="${DGM}"><dgm:relIds xmlns:dgm="${DGM}" r:dm="rIdDm" r:lo="x" r:qs="x" r:cs="x"/></a:graphicData></a:graphic></p:graphicFrame>`,
    ],
  },
  {
    layout: 2,
    notes: "Designed slide notes",
    rels: [`<Relationship Id="rIdDm" Type="${REL}/diagramData" Target="../diagrams/data2.xml"/>`, `<Relationship Id="rIdDraw" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>`],
    shapes: [
      sp(2, { ph: '<p:ph type="title"/>', paras: [para(run("Design"))] }),
      // a group drawn at 2x: child space 2in x 1in mapped onto 4in x 2in at (1in, 2in)
      `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${EMU}" y="${2 * EMU}"/><a:ext cx="${4 * EMU}" cy="${2 * EMU}"/><a:chOff x="0" y="0"/><a:chExt cx="${2 * EMU}" cy="${EMU}"/></a:xfrm></p:grpSpPr>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(0, 0, 1, 0.5)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid('<a:schemeClr val="accent2"/>')}</p:spPr><p:txBody><a:bodyPr anchor="ctr"/>${para(run("Grouped box"))}</p:txBody></p:sp>` +
        `</p:grpSp>`,
      `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Arrow"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xf(5.5, 3, 2, 0, ' flipV="1"')}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="25400">${solid('<a:srgbClr val="333333"/>')}<a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`,
      sp(6, { txBox: true, pos: `<p:spPr>${xf(8, 2, 4, 1)}</p:spPr>`, paras: [p2("", r2("Big", ' sz="2400"'), r2(" small", ' sz="1200"'), r2(" again", ' sz="2400"'))] }),
      sp(8, { txBox: true, pos: `<p:spPr>${xf(8, 3.2, 4, 0.6)}</p:spPr>`, paras: [p2("", run("Plain then "), r2("code", "", '<a:latin typeface="Courier New"/>'))] }),
      `<p:sp><p:nvSpPr><p:cNvPr id="9" name="Glass"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(9, 4.2, 2, 1.2)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${solid('<a:srgbClr val="4472C4"><a:alpha val="40000"/></a:srgbClr>')}</p:spPr></p:sp>`,
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="Styled table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${8 * EMU}" y="${5.6 * EMU}"/><a:ext cx="${EMU}" cy="${EMU}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{TEST-STYLE}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="${2 * EMU}"/><a:gridCol w="${EMU}"/></a:tblGrid>` +
        [["Run", "Gain"], ["A", "1.02"], ["B", "0.98"], ["C", "1.01"]].map((r) => `<a:tr h="${EMU / 3}">${r.map((c) => `<a:tc><a:txBody><a:bodyPr/>${para(run(c))}</a:txBody><a:tcPr/></a:tc>`).join("")}</a:tr>`).join("") +
        `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="SmartArt"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${EMU}" y="${5 * EMU}"/><a:ext cx="${6 * EMU}" cy="${EMU}"/></p:xfrm><a:graphic><a:graphicData uri="${DGM}"><dgm:relIds xmlns:dgm="${DGM}" r:dm="rIdDm" r:lo="x" r:qs="x" r:cs="x"/></a:graphicData></a:graphic></p:graphicFrame>`,
    ],
  },
];

const series = (name, vals, color) =>
  `<c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>${color ? `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>` : ""}<c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Ch 12</c:v></c:pt><c:pt idx="1"><c:v>Ch 13</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache></c:numRef></c:val></c:ser>`;
const chartXml = `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="${C}" ${NS}><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Gain by channel</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart>${series("Run A", ["1.02", "0.98"], "2E75B6")}${series("Run B", ["1.01", "0.97"])}</c:barChart></c:plotArea></c:chart></c:chartSpace>`;
const dgmPt = (id, t, type) => `<dgm:pt modelId="${id}"${type ? ` type="${type}"` : ""}>${t ? `<dgm:t><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></dgm:t>` : ""}</dgm:pt>`;
const dataXml = `<?xml version="1.0" encoding="UTF-8"?><dgm:dataModel xmlns:dgm="${DGM}" ${NS}><dgm:ptLst>${dgmPt(0, "", "doc")}${dgmPt(1, "Plan")}${dgmPt(2, "Build")}${dgmPt(3, "ignored", "parTrans")}${dgmPt(4, "Test")}</dgm:ptLst></dgm:dataModel>`;
const themeXml = `<?xml version="1.0" encoding="UTF-8"?><a:theme ${NS} name="Test"><a:themeElements><a:clrScheme name="Test"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2></a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
const drawingXml = `<?xml version="1.0" encoding="UTF-8"?><dsp:drawing xmlns:dsp="${DSP}" ${NS}><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${["Step A", "Step B"]
  .map((t, i) => `<dsp:sp modelId="{${i}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>${xf(i * 3, 0, 2.5, 1)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid('<a:schemeClr val="accent1"/>')}</dsp:spPr><dsp:txBody><a:bodyPr anchor="ctr"/><a:p><a:r><a:rPr lang="en-US" sz="2000"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r></a:p></dsp:txBody></dsp:sp>`)
  .join("")}</dsp:spTree></dsp:drawing>`;
const data2Xml = `<?xml version="1.0" encoding="UTF-8"?><dgm:dataModel xmlns:dgm="${DGM}" ${NS}><dgm:ptLst>${dgmPt(0, "", "doc")}${dgmPt(1, "Step A")}${dgmPt(2, "Step B")}</dgm:ptLst><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="rIdDraw" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>`;
const masterXml = `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr>${solid('<a:srgbClr val="F7F9FC"/>')}<a:effectLst/></p:bgPr></p:bg><p:spTree>` +
  sp(2, { ph: '<p:ph type="title"/>', pos: `<p:spPr>${xf(0.5, 0.3, 12.3, 1)}</p:spPr>`, paras: [para(run(""))] }).replace("<a:bodyPr/>", '<a:bodyPr anchor="b"/>') +
  `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdLogo"/></p:blipFill><p:spPr>${xf(12.2, 6.8, 0.9, 0.5)}</p:spPr></p:pic>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(0, 7.3, 13.333, 0.2)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('<a:schemeClr val="accent1"/>')}</p:spPr></p:sp>` +
  `</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3600">${solid('<a:schemeClr val="tx2"/>')}</a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const layoutXml = (type, shapes = "", attrs = "") => `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS} type="${type}"${attrs}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sldLayout>`;
const relsXml = (rs) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rs.join("")}</Relationships>`;

const fz = new JSZip();
fz.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
fz.file("_rels/.rels", relsXml([`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>`]));
fz.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldIdLst>${fmtSlides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`);
fz.file("ppt/_rels/presentation.xml.rels", relsXml(fmtSlides.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`)));
fz.file("ppt/theme/theme1.xml", themeXml);
fz.file(
  "ppt/tableStyles.xml",
  `<?xml version="1.0" encoding="UTF-8"?><a:tblStyleLst ${NS} def="{TEST-STYLE}"><a:tblStyle styleId="{TEST-STYLE}" styleName="Test"><a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:insideH><a:ln w="12700">${solid('<a:srgbClr val="9E9E9E"/>')}</a:ln></a:insideH></a:tcBdr><a:fill>${solid('<a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr>')}</a:fill></a:tcStyle></a:wholeTbl><a:band1H><a:tcStyle><a:fill>${solid('<a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr>')}</a:fill></a:tcStyle></a:band1H><a:firstRow><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:fill>${solid('<a:schemeClr val="accent1"/>')}</a:fill></a:tcStyle></a:firstRow></a:tblStyle></a:tblStyleLst>`,
);
fz.file("ppt/slideMasters/slideMaster1.xml", masterXml);
fz.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", relsXml([`<Relationship Id="rIdT" Type="${REL}/theme" Target="../theme/theme1.xml"/>`, `<Relationship Id="rIdLogo" Type="${REL}/image" Target="../media/image1.png"/>`]));
fz.file("ppt/slideLayouts/slideLayout1.xml", layoutXml("title", "", ' showMasterSp="0"')); // title slides hide the master's art
fz.file("ppt/slideLayouts/slideLayout2.xml", layoutXml("obj", sp(9, { ph: '<p:ph idx="1"/>', pos: at(0.5, 1.5), paras: [para(run(""))] })));
for (const n of [1, 2]) fz.file(`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`, relsXml([`<Relationship Id="rIdM" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`]));
fz.file("ppt/media/image1.png", png);
fz.file("ppt/charts/chart1.xml", chartXml);
fz.file("ppt/diagrams/data1.xml", dataXml);
fz.file("ppt/diagrams/data2.xml", data2Xml);
fz.file("ppt/diagrams/drawing1.xml", drawingXml);
fmtSlides.forEach((s, i) => {
  const n = i + 1;
  fz.file(`ppt/slides/slide${n}.xml`, slideXml(s.shapes));
  const notesRel = s.notes ? [`<Relationship Id="rIdN" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`] : [];
  if (s.notes) fz.file(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(s.notes));
  fz.file(`ppt/slides/_rels/slide${n}.xml.rels`, relsXml([`<Relationship Id="rIdL" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout${s.layout}.xml"/>`, ...notesRel, ...(s.rels ?? [])]));
});
const out2 = join(ROOT, "e2e/fixtures/Formatting_2024.pptx");
writeFileSync(out2, await fz.generateAsync({ type: "nodebuffer" }));
console.log("wrote", out2);
