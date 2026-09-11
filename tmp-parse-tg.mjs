import fs from "fs";
import path from "path";
import os from "os";

const files = ["4421", "4400", "4380", "4360", "4340"].map((x) =>
  path.join(os.tmpdir(), `tg_${x}.html`)
);
let html = "";
for (const f of files) {
  try {
    html += fs.readFileSync(f, "utf8");
  } catch {}
}

const blocks = [
  ...html.matchAll(
    /data-post="provereno_media\/(\d+)"[\s\S]*?class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g
  ),
];
const byId = new Map();
for (const m of blocks) {
  const id = +m[1];
  const txt = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!byId.has(id) || txt.length > (byId.get(id) || "").length) byId.set(id, txt);
}

const ids = [...byId.keys()].sort((a, b) => b - a).slice(0, 50);
console.log(`unique_posts=${byId.size} last50=${ids[0]}..${ids[ids.length - 1]} n=${ids.length}`);

const dets = [
  ["Hive", /Hive/i],
  ["Sightengine", /Sightengine/i],
  ["SynthID", /SynthID/i],
  ["OpenAI Verify", /openai\.com[^\s]*verify|OpenAI Verify/i],
  ["Gemini", /\bGemini\b/i],
  ["DeepFake-o-meter", /Deep\s*Fake-?o-?meter|Deepfake-o-meter/i],
  ["Illuminarty", /Illuminarty/i],
  ["AI or Not", /AI or Not|aiornot/i],
  ["InVID", /\bInVID\b/i],
  ["FotoForensics", /FotoForensics|Foto Forensics/i],
  ["C2PA", /\bC2PA\b|Content Credentials/i],
];

for (const [name, re] of dets) {
  const hits = ids.filter((id) => re.test(byId.get(id) || ""));
  console.log(`${name}: ${hits.length ? hits.join(", ") : "—"}`);
}

console.log("\n=== detector snippets ===");
for (const id of ids) {
  const t = byId.get(id) || "";
  if (!/Hive|Sightengine|SynthID|Deep\s*Fake|детектор|Gemini|openai\.com.*verify/i.test(t)) {
    continue;
  }
  const m = t.match(
    /(.{0,90}(?:Hive|Sightengine|SynthID|Gemini|openai\.com[^ ]*verify|ИИ-детектор|детектор(?:ов|а)?).{0,140})/i
  );
  console.log(`#${id}: ${(m ? m[1] : t.slice(0, 220)).replace(/\s+/g, " ")}`);
}
