/**
 * Batch SynthID scores for calibration (label folders optional).
 *
 *   node scripts/calibrate-synthid.mjs path/to/image.png
 *   node scripts/calibrate-synthid.mjs path/to/folder
 *   node scripts/calibrate-synthid.mjs --label watermarked ./samples/wm ./samples/clean
 */
import fs from "fs";
import path from "path";
import { analyzeSynthID } from "../lib/synthid-detect.mjs";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function collectImages(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectImages(p));
    else if (IMAGE_EXT.has(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

async function scoreFile(filePath, label = "") {
  const buf = fs.readFileSync(filePath);
  const t0 = Date.now();
  const r = await analyzeSynthID(buf);
  const ms = Date.now() - t0;
  return {
    file: path.basename(filePath),
    label,
    ok: r.ok,
    phase: r.phaseMatch,
    universal: r.universalPhase,
    tier: r.tier,
    detected: r.detected,
    exact: r.exactResolution,
    ms,
  };
}

function printRow(row) {
  const u = row.universal != null ? row.universal.toFixed(3) : "—";
  console.log(
    [
      row.label ? `[${row.label}]` : "",
      row.file,
      row.ok ? `phase=${row.phase?.toFixed(3)}` : "ERR",
      `univ=${u}`,
      `tier=${row.tier}`,
      row.detected ? "DETECT" : "—",
      row.exact ? "exact" : "resize",
      `${row.ms}ms`,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function summarizeGroup(label, rows) {
  const ok = rows.filter((r) => r.ok);
  if (!ok.length) return;
  const phases = ok.map((r) => r.phase);
  const avg = phases.reduce((a, b) => a + b, 0) / phases.length;
  const min = Math.min(...phases);
  const max = Math.max(...phases);
  const det = ok.filter((r) => r.detected).length;
  console.log(
    `\n${label}: n=${ok.length} phase avg=${avg.toFixed(3)} min=${min.toFixed(3)} max=${max.toFixed(3)} detected=${det}/${ok.length}`
  );
}

const args = process.argv.slice(2);
let labelGroups = [];

if (args[0] === "--label" && args.length >= 3) {
  for (let i = 0; i < args.length - 1; i += 2) {
    if (args[i] !== "--label") continue;
    const label = args[i + 1];
    const dir = args[i + 2];
    if (!dir || dir.startsWith("--")) break;
    const files = fs.statSync(dir).isDirectory() ? collectImages(dir) : [dir];
    labelGroups.push({ label, files });
    i++;
  }
} else {
  const paths = args.length ? args : ["../reverse-synthid-gui/assets"];
  const files = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      console.warn("skip", p);
      continue;
    }
    if (fs.statSync(p).isDirectory()) files.push(...collectImages(p));
    else files.push(p);
  }
  labelGroups = [{ label: "", files }];
}

for (const { label, files } of labelGroups) {
  const rows = [];
  for (const f of files) {
    const row = await scoreFile(f, label);
    printRow(row);
    rows.push(row);
  }
  if (label) summarizeGroup(label, rows);
}
