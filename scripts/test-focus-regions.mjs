import assert from "node:assert/strict";
import {
  hasPositiveLogoEvidence,
  resolveFocusRegions,
} from "../public/js/focus-regions.js";

const noLogoHuman = {
  ok: true,
  verdict: "human",
  platformLogo: "none",
  googleSparkle: false,
  summary:
    "Няма видим Google sparkle или watermark в долния десен ъгъл. Проверих ъглите за лого — не са открити. Снимката изглежда естествена.",
  focusRegions: [],
};

const r1 = resolveFocusRegions(noLogoHuman);
assert.equal(
  r1.filter((z) => /лого|watermark|sparkle/i.test(z.label)).length,
  0,
  "human + no logo text → no logo markers"
);

const aiNoLogo = {
  ok: true,
  verdict: "ai",
  platformLogo: "none",
  googleSparkle: false,
  summary:
    "Вероятно AI по текстури на фона. Няма видим watermark или Gemini sparkle в ъглите.",
  focusRegions: [
    {
      label: "Google sparkle / лого",
      note: "долен десен",
      x: 0.82,
      y: 0.82,
      w: 0.14,
      h: 0.14,
    },
  ],
};

const r2 = resolveFocusRegions(aiNoLogo);
assert.equal(
  r2.filter((z) => /лого|watermark|sparkle/i.test(z.label)).length,
  0,
  "AI verdict without logo evidence → strip API logo regions"
);

const withSparkle = {
  ok: true,
  verdict: "ai",
  platformLogo: "gemini",
  googleSparkle: true,
  summary: "В долния десен ъгъл се вижда полупрозрачен Gemini sparkle (✦).",
  focusRegions: [],
};

const r3 = resolveFocusRegions(withSparkle);
assert.ok(
  r3.some((z) => /sparkle|лого/i.test(z.label) && z.x >= 0.65),
  "positive sparkle → corner marker"
);

assert.equal(hasPositiveLogoEvidence("няма видим watermark", {}), false);
assert.equal(
  hasPositiveLogoEvidence("открит е видим watermark в долния ъгъл", {}),
  true
);

console.log("OK — focus-regions tests passed");
