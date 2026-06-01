/**
 * One-time export: compact SynthID V4 detector data from reverse-SynthID npz.
 * Run from repo root: node scripts/export-synthid-codebook.mjs
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "lib", "data", "synthid-v4-detector.json");

const SYNTHID_ROOT = process.env.SYNTHID_ROOT || path.join(ROOT, "..", "reverse-synthid-gui");
const CODEBOOK = path.join(SYNTHID_ROOT, "artifacts", "spectral_codebook_v4.npz");
const PY_SCRIPT = path.join(__dirname, "export-synthid-codebook.py");

if (!fs.existsSync(CODEBOOK)) {
  console.error("Missing codebook:", CODEBOOK);
  console.error("Set SYNTHID_ROOT or clone reverse-synthid-gui alongside this repo.");
  process.exit(1);
}

const py = process.env.PYTHON || "py";
const args = process.platform === "win32" ? ["-3.12", PY_SCRIPT, CODEBOOK, OUT] : [PY_SCRIPT, CODEBOOK, OUT];
const r = spawnSync(py, args, { encoding: "utf8", stdio: "inherit" });

if (r.status !== 0) process.exit(r.status || 1);
console.log("Wrote", OUT, `(${ (fs.statSync(OUT).size / 1024).toFixed(0) } KB)`);
