// Generates plot-like SVG fixtures for the mock server into public/mock-assets.
// Deterministic: re-running produces identical files. Usage: node scripts/gen-mock-assets.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "mock-assets");
mkdirSync(OUT, { recursive: true });

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const f = (n) => n.toFixed(1);

const INK = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#d97706", "#0891b2"];
const QUANTITIES = [
  ["Time (s)", "Rate (Hz)"],
  ["Energy (keV)", "Counts"],
  ["Temperature (K)", "Resistance (Ω)"],
  ["Channel", "ADC value"],
  ["Run number", "Gain drift (%)"],
  ["Wavelength (nm)", "Intensity (a.u.)"],
  ["Bias voltage (V)", "Leakage current (nA)"],
  ["Position (mm)", "Efficiency"],
];
const TITLES = [
  "Detector B gain vs. run",
  "Cooldown curve, cryostat 2",
  "Calibration spectrum, Co-60",
  "Pedestal stability",
  "Beam profile scan",
  "Timing resolution",
  "Noise spectrum after shielding",
  "Trigger efficiency turn-on",
  "Laser alignment residuals",
  "Vacuum pressure log",
];

function frame(w, h, title, [xl, yl], body) {
  const m = { l: 80, r: 30, t: 60, b: 70 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  const ticks = [];
  for (let i = 0; i <= 5; i++) {
    const x = m.l + (pw * i) / 5;
    const y = m.t + (ph * i) / 5;
    ticks.push(`<line x1="${f(x)}" y1="${m.t}" x2="${f(x)}" y2="${m.t + ph}" stroke="#e5e7eb"/>`);
    ticks.push(`<line x1="${m.l}" y1="${f(y)}" x2="${m.l + pw}" y2="${f(y)}" stroke="#e5e7eb"/>`);
    ticks.push(`<text x="${f(x)}" y="${m.t + ph + 22}" font-size="14" text-anchor="middle" fill="#4b5563">${i * 20}</text>`);
    ticks.push(`<text x="${m.l - 10}" y="${f(m.t + ph - (ph * i) / 5 + 5)}" font-size="14" text-anchor="end" fill="#4b5563">${(i * 0.2).toFixed(1)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif">
<rect width="${w}" height="${h}" fill="#ffffff"/>
<text x="${w / 2}" y="36" font-size="22" font-weight="600" text-anchor="middle" fill="#111827">${title}</text>
${ticks.join("\n")}
<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" stroke="#374151" stroke-width="1.5"/>
${body({ ...m, pw, ph })}
<text x="${m.l + pw / 2}" y="${h - 18}" font-size="16" text-anchor="middle" fill="#111827">${xl}</text>
<text transform="translate(22 ${m.t + ph / 2}) rotate(-90)" font-size="16" text-anchor="middle" fill="#111827">${yl}</text>
</svg>`;
}

function linePlot(w, h, title, axes) {
  const series = 1 + Math.floor(rnd() * 3);
  return frame(w, h, title, axes, ({ l, t, pw, ph }) => {
    let out = "";
    for (let s = 0; s < series; s++) {
      const a = 0.2 + rnd() * 0.5;
      const k = 1 + rnd() * 4;
      const ph0 = rnd() * 6;
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const x = i / 120;
        const y = Math.min(0.95, Math.max(0.05, a + 0.25 * Math.sin(k * x * 6 + ph0) * Math.exp(-x) + (rnd() - 0.5) * 0.04 + x * 0.2));
        pts.push(`${f(l + x * pw)},${f(t + ph - y * ph)}`);
      }
      out += `<polyline points="${pts.join(" ")}" fill="none" stroke="${INK[s]}" stroke-width="2.5"/>`;
    }
    return out;
  });
}

function histogram(w, h, title, axes) {
  return frame(w, h, title, axes, ({ l, t, pw, ph }) => {
    const n = 40;
    const mu = 0.3 + rnd() * 0.4;
    const sig = 0.06 + rnd() * 0.1;
    let out = "";
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n;
      const y = 0.9 * Math.exp(-((x - mu) ** 2) / (2 * sig * sig)) + 0.05 + rnd() * 0.04;
      out += `<rect x="${f(l + (i / n) * pw)}" y="${f(t + ph - y * ph)}" width="${f(pw / n - 1)}" height="${f(y * ph)}" fill="${INK[0]}" fill-opacity="0.75"/>`;
    }
    return out;
  });
}

function scatter(w, h, title, axes) {
  return frame(w, h, title, axes, ({ l, t, pw, ph }) => {
    let out = "";
    const slope = 0.3 + rnd() * 0.6;
    for (let i = 0; i < 160; i++) {
      const x = rnd();
      const y = Math.min(0.95, Math.max(0.05, 0.1 + slope * x + (rnd() - 0.5) * 0.2));
      out += `<circle cx="${f(l + x * pw)}" cy="${f(t + ph - y * ph)}" r="4" fill="${INK[2]}" fill-opacity="0.6"/>`;
    }
    out += `<line x1="${l}" y1="${f(t + ph - 0.1 * ph)}" x2="${l + pw}" y2="${f(t + ph - (0.1 + slope) * ph)}" stroke="${INK[1]}" stroke-width="2" stroke-dasharray="8 6"/>`;
    return out;
  });
}

function heatmap(w, h, title) {
  const cells = [];
  const n = 24;
  const cw = (w - 120) / n;
  const chh = (h - 120) / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = Math.exp(-(((i - 12) / 6) ** 2 + ((j - 10) / 5) ** 2)) + rnd() * 0.15;
      const c = Math.round(255 - Math.min(1, v) * 200);
      cells.push(`<rect x="${f(60 + i * cw)}" y="${f(70 + j * chh)}" width="${f(cw + 0.5)}" height="${f(chh + 0.5)}" fill="rgb(${c},${c},255)"/>`);
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif">
<rect width="${w}" height="${h}" fill="#fff"/>
<text x="${w / 2}" y="40" font-size="22" font-weight="600" text-anchor="middle" fill="#111827">${title}</text>
${cells.join("")}
<text x="${w / 2}" y="${h - 20}" font-size="16" text-anchor="middle" fill="#111827">Pixel column</text>
</svg>`;
}

function photo(w, h) {
  // A stylized "bench photo": dark background, a detector housing, cables, and an LED.
  const hue = Math.floor(rnd() * 360);
  let cables = "";
  for (let i = 0; i < 6; i++)
    cables += `<path d="M ${f(rnd() * w)} ${h} C ${f(rnd() * w)} ${f(h * 0.6)}, ${f(rnd() * w)} ${f(h * 0.5)}, ${f(w * 0.5 + (rnd() - 0.5) * 100)} ${f(h * 0.5)}" stroke="hsl(${(hue + i * 40) % 360} 60% 45%)" stroke-width="${6 + rnd() * 6}" fill="none"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="hsl(${hue} 15% 35%)"/><stop offset="1" stop-color="hsl(${hue} 20% 8%)"/></radialGradient>
<linearGradient id="m" x1="0" x2="1"><stop offset="0" stop-color="#9ca3af"/><stop offset=".5" stop-color="#e5e7eb"/><stop offset="1" stop-color="#6b7280"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
${cables}
<rect x="${w * 0.3}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.3}" rx="16" fill="url(#m)" stroke="#374151" stroke-width="4"/>
<circle cx="${w * 0.65}" cy="${h * 0.36}" r="8" fill="#22c55e"/>
<text x="${w * 0.5}" y="${h * 0.47}" font-size="${Math.round(h * 0.04)}" text-anchor="middle" fill="#111827" font-family="Helvetica">DET-B  S/N 0${Math.floor(rnd() * 900 + 100)}</text>
</svg>`;
}

function screenshot(w, h, title) {
  let rows = "";
  for (let i = 0; i < 14; i++) {
    const y = 110 + i * 34;
    if (y > h - 40) break;
    rows += `<text x="40" y="${y}" font-size="16" fill="#d1d5db" font-family="Menlo, monospace">[${String(10 + i).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:12] run ${4000 + Math.floor(rnd() * 900)}  ch${Math.floor(rnd() * 64)}  ${pick(["OK", "OK", "OK", "WARN rate high", "OK", "ERR timeout"])}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#111827"/>
<rect width="${w}" height="44" fill="#1f2937"/>
<circle cx="24" cy="22" r="7" fill="#ef4444"/><circle cx="46" cy="22" r="7" fill="#f59e0b"/><circle cx="68" cy="22" r="7" fill="#22c55e"/>
<text x="${w / 2}" y="28" font-size="16" text-anchor="middle" fill="#9ca3af" font-family="Helvetica">${title}</text>
${rows}
</svg>`;
}

function diagram(w, h, title) {
  const labels = ["Source", "Collimator", "Target", "Detector A", "Detector B", "DAQ"];
  let out = "";
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    const x = 40 + (i * (w - 80)) / n;
    const bw = (w - 80) / n - 30;
    out += `<rect x="${f(x)}" y="${h / 2 - 40}" width="${f(bw)}" height="80" rx="10" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>`;
    out += `<text x="${f(x + bw / 2)}" y="${h / 2 + 6}" font-size="16" text-anchor="middle" fill="#1e3a8a" font-family="Helvetica">${labels[i]}</text>`;
    if (i < n - 1)
      out += `<path d="M ${f(x + bw + 2)} ${h / 2} L ${f(x + bw + 26)} ${h / 2}" stroke="#374151" stroke-width="2" marker-end="url(#a)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><marker id="a" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker></defs>
<rect width="${w}" height="${h}" fill="#fff"/>
<text x="${w / 2}" y="50" font-size="22" font-weight="600" text-anchor="middle" fill="#111827" font-family="Helvetica">${title}</text>
${out}
</svg>`;
}

const SIZES = [
  [1200, 800],
  [1600, 900],
  [1000, 1000],
  [1400, 1000],
  [1280, 720],
];
const KINDS = [
  ["chart", linePlot],
  ["chart", histogram],
  ["chart", scatter],
  ["chart", heatmap],
  ["photo", photo],
  ["screenshot", screenshot],
  ["diagram", diagram],
];
const DOMINANT = { chart: ["#ffffff", "#2563eb"], photo: ["#1f2937", "#9ca3af"], screenshot: ["#111827", "#d1d5db"], diagram: ["#ffffff", "#eff6ff"] };

const manifest = [];
for (let i = 0; i < 28; i++) {
  const [type, fn] = KINDS[i % KINDS.length];
  const [w, h] = SIZES[i % SIZES.length];
  const title = TITLES[i % TITLES.length];
  const axes = QUANTITIES[i % QUANTITIES.length];
  const svg = fn(w, h, title, axes);
  const file = `fig-${String(i + 1).padStart(2, "0")}-${type}.svg`;
  writeFileSync(join(OUT, file), svg);
  const ocrText =
    type === "chart" ? `${title} ${axes.join(" ")}` : type === "screenshot" ? `${title} run ch OK WARN rate high ERR timeout` : type === "diagram" ? `${title} Source Collimator Target Detector A Detector B DAQ` : "DET-B S/N";
  manifest.push({ file, type, width: w, height: h, title, ocrText, dominantColors: DOMINANT[type], bytes: Buffer.byteLength(svg) });
}
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "mock", "fixtures");
mkdirSync(SRC, { recursive: true });
writeFileSync(join(SRC, "assetManifest.json"), JSON.stringify(manifest, null, 2));
console.log(`wrote ${manifest.length} figures to ${OUT}`);
