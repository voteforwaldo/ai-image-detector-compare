import { parseGeminiResponse } from "../lib/analyze.mjs";

const userCase = `Forensic бележки: проверка за Gemini лого и AI артефакти.
{"verdict":"human","confidence_percent":95,"summary":"Изображението е оценено като автентична снимка поради напълно кохерентния текст и изключително последователната физика на светлината и сенките.","focus_regions":[]}`;

const jsonHumanSummaryAiVerdict = `{"verdict":"ai","confidence_percent":95,"summary":"Изображението е оценено като автентична снимка поради кохерентна физика.","focus_regions":[]}`;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const r1 = parseGeminiResponse(userCase);
assert(r1.verdict === "human", `expected human verdict, got ${r1.verdict}`);
assert(r1.confidence_percent === 95, `expected 95% human conf, got ${r1.confidence_percent}`);
assert(
  /автентичн/i.test(r1.summary),
  `summary should stay human-aligned, got: ${r1.summary}`
);
assert(
  !/Коригирано/i.test(r1.summary),
  `summary must not contain correction note, got: ${r1.summary}`
);

const r2 = parseGeminiResponse(jsonHumanSummaryAiVerdict);
assert(r2.verdict === "human", `json ai+human summary → human, got ${r2.verdict}`);
assert(/автентичн|естествена|Forensic/i.test(r2.summary), `summary aligned: ${r2.summary}`);

const googleLogoCase = `{"verdict":"human","confidence_percent":90,"platform_logo":"gemini","summary":"Липсват AI артефакти и watermarks.","focus_regions":[]}`;
const r3 = parseGeminiResponse(googleLogoCase);
assert(r3.verdict === "ai", `platform_logo gemini → ai, got ${r3.verdict}`);
assert(r3.confidence_percent >= 95, `expected high AI conf, got ${r3.confidence_percent}`);

const googleSparkleCase = `Forensic: в долния десен ъгъл се вижда полупрозрачен Gemini sparkle watermark (✦).
{"verdict":"human","confidence_percent":88,"google_sparkle":true,"platform_logo":"gemini","summary":"Липсват AI артефакти.","focus_regions":[]}`;
const r4 = parseGeminiResponse(googleSparkleCase);
assert(r4.verdict === "ai", `google_sparkle → ai, got ${r4.verdict}`);
assert(r4.confidence_percent >= 96, `sparkle conf ≥96, got ${r4.confidence_percent}`);
assert(/sparkle|ромб|✦/i.test(r4.summary), `summary mentions sparkle: ${r4.summary}`);

console.log("OK — Gemini parse/reconcile tests passed");
console.log("  userCase:", r1.verdict, r1.confidence_percent + "%", "→", r1.summary.slice(0, 80) + "...");
