import fs from "fs";
import path from "path";
import { analyzeSynthID } from "../lib/synthid-detect.mjs";

const samples = [
  process.argv[2],
  path.join("..", "reverse-synthid-gui", "assets", "sample_watermarked.png"),
  path.join("..", "reverse-synthid-gui", "assets", "sample_cleaned.png"),
].filter(Boolean);

for (const p of samples) {
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) {
    console.log("skip", resolved);
    continue;
  }
  const buf = fs.readFileSync(resolved);
  console.log("\n===", path.basename(resolved), "===");
  const t0 = Date.now();
  const r = await analyzeSynthID(buf);
  console.log("ms", Date.now() - t0);
  console.log({
    ok: r.ok,
    detected: r.detected,
    tier: r.tier,
    phaseMatch: r.phaseMatch,
    bannerText: r.bannerText,
    headline: r.headline,
  });
}
