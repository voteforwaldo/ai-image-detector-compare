/**
 * SynthID V4 spectral detector (Node port for Vercel).
 * Compact codebook in lib/data/synthid-v4-detector.json (~450 KB).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import ndarray from "ndarray";
import fft from "ndarray-fft";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODEBOOK_PATH = path.join(__dirname, "data", "synthid-v4-detector.json");

const PHASE_WM_EXACT = 0.52;
const PHASE_WM_RESIZED = 0.58;
const PHASE_STRONG = 0.62;
const CONF_STRONG = 0.65;
const CHANNEL_WEIGHTS = [0.25, 0.55, 0.2];

let _codebook = null;

function loadCodebook() {
  if (_codebook) return _codebook;
  if (!fs.existsSync(CODEBOOK_PATH)) {
    throw new Error(
      "Липсва lib/data/synthid-v4-detector.json. Пуснете: node scripts/export-synthid-codebook.mjs"
    );
  }
  _codebook = JSON.parse(fs.readFileSync(CODEBOOK_PATH, "utf8"));
  return _codebook;
}

function phaseDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

/** 2D FFT phase angles (matches numpy.fft.fft2 on real input). */
function fft2Phase(plane, h, w) {
  const re = ndarray(new Float64Array(h * w), [h, w]);
  const im = ndarray(new Float64Array(h * w), [h, w]);
  for (let i = 0; i < h * w; i++) re.data[i] = plane[i];
  fft(1, re, im);

  const phase = Array.from({ length: h }, () => Array(w).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = re.index(y, x);
      phase[y][x] = Math.atan2(im.data[idx], re.data[idx]);
    }
  }
  return phase;
}

function pickProfile(profiles, h, w) {
  const models = [...new Set(profiles.map((p) => p.model))].filter((m) => m !== "union");
  return models.map((model) => {
    const exact = profiles.find((p) => p.model === model && p.h === h && p.w === w);
    if (exact) return { profile: exact, exact: true, model };
    const pool = profiles.filter((p) => p.model === model);
    let best = pool[0];
    let bestScore = Infinity;
    const targetAr = h / w;
    for (const p of pool) {
      const score =
        (Math.abs(p.h / p.w - targetAr) / (targetAr + 1e-9)) * 2 +
        Math.abs(p.h * p.w - h * w) / (h * w + 1e-9);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return { profile: best, exact: false, model };
  });
}

async function scoreBins(rgb, w, h, profile, exact) {
  const workW = exact ? w : profile.w;
  const workH = exact ? h : profile.h;

  if (!exact) {
    const resized = await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
      .resize(workW, workH, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .raw()
      .toBuffer();
    return scoreBinsOnBuffer(resized, workW, workH, profile, exact);
  }
  return scoreBinsOnBuffer(rgb, workW, workH, profile, exact);
}

function channelPhases(rgb, w, h) {
  const phases = [];
  for (let ch = 0; ch < 3; ch++) {
    const plane = new Float64Array(h * w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        plane[y * w + x] = rgb[(y * w + x) * 3 + ch];
      }
    }
    phases[ch] = fft2Phase(plane, h, w);
  }
  return phases;
}

function scoreBinsAtFloor(phases, w, h, profile, exact, consensusFloor) {
  const perChannel = [];

  for (let ch = 0; ch < 3; ch++) {
    const chBins = profile.bins.filter((b) => b.ch === ch && b.cons >= consensusFloor);
    if (!chBins.length) continue;

    const imgPhase = phases[ch];
    const matches = [];
    for (const b of chBins) {
      if (b.y >= h || b.x >= w) continue;
      const diff = phaseDiff(imgPhase[b.y][b.x], b.phase);
      matches.push(1 - diff / Math.PI);
    }
    if (matches.length) {
      perChannel.push(matches.reduce((a, c) => a + c, 0) / matches.length);
    }
  }

  if (!perChannel.length) return null;

  let phaseMatch = 0;
  let wSum = 0;
  for (let i = 0; i < perChannel.length; i++) {
    const wt = CHANNEL_WEIGHTS[i] ?? 0.33;
    phaseMatch += perChannel[i] * wt;
    wSum += wt;
  }
  phaseMatch /= wSum;

  const phaseScore = 1 / (1 + Math.exp(-18 * (phaseMatch - 0.52)));
  const confidence = Math.min(1, phaseScore);
  const isWatermarked = confidence > 0.5;

  return {
    phaseMatch,
    confidence,
    isWatermarked,
    profileKey: `${profile.model}/${profile.h}x${profile.w}`,
    exact,
    phaseThreshold: exact ? PHASE_WM_EXACT : PHASE_WM_RESIZED,
    model: profile.model,
  };
}

function scoreBinsOnBuffer(rgb, w, h, profile, exact) {
  const phases = channelPhases(rgb, w, h);
  const floors = [0.75, 0.65, 0.55, 0.45];
  let best = null;
  for (const floor of floors) {
    const scored = scoreBinsAtFloor(phases, w, h, profile, exact, floor);
    if (scored && (!best || scored.phaseMatch > best.phaseMatch)) {
      best = scored;
    }
  }

  if (!best) {
    return {
      phaseMatch: 0,
      confidence: 0,
      isWatermarked: false,
      profileKey: `${profile.model}/${profile.h}x${profile.w}`,
      exact,
      phaseThreshold: exact ? PHASE_WM_EXACT : PHASE_WM_RESIZED,
      model: profile.model,
    };
  }
  return best;
}

function tierFromCore(core) {
  if (core.isWatermarked) {
    if (core.phaseMatch >= PHASE_STRONG || core.confidence >= CONF_STRONG) {
      return {
        tier: "strong",
        headline: "Силен сигнал за SynthID",
        summary: "Ясно открит невидим воден знак (Google SynthID).",
        explanation:
          "Спектралният анализ показва силно съвпадение с профила на Gemini. Изображението е почти сигурно от Google AI (Gemini / Imagen).",
      };
    }
    if (core.phaseMatch < 0.56) {
      return {
        tier: "weak",
        headline: "Слаб сигнал за SynthID",
        summary: "Открит е само лек / частичен SynthID след.",
        explanation:
          "Има малко съвпадение с водния знак на Google — възможно AI изображение след компресия или редакция. Препоръчва се ръчна проверка.",
      };
    }
    return {
      tier: "likely",
      headline: "SynthID открит",
      summary: "Открит е невидим воден знак, типичен за Google Gemini.",
      explanation:
        "Фазовият шаблон съвпада с известен SynthID профил — силен технически индикатор за AI от Google.",
    };
  }
  if (core.phaseMatch >= 0.48) {
    return {
      tier: "trace",
      headline: "Едва забележим SynthID след",
      summary: "Много слаб спектрален отпечатък — не е сигурно воден знак.",
      explanation:
        "Леко сходство с SynthID носители, но под прага. Може да е от JPEG или мащабиране.",
    };
  }
  if (core.phaseMatch >= 0.44) {
    return {
      tier: "uncertain",
      headline: "Неясно",
      summary: "Сигналът е твърде слаб за категорично заключение.",
      explanation: "Гранична зона между чисти и воденирани изображения.",
    };
  }
  return {
    tier: "clean",
    headline: "SynthID не е открит",
    summary: "Няма значим спектрален сигнал за Google SynthID.",
    explanation:
      "Не е намерен типичният SynthID шаблон. Не доказва човешки произход, но няма технически Google watermark.",
  };
}

function buildApiResult(core, candidates) {
  const tierInfo = tierFromCore(core);
  const bannerDetected =
    core.isWatermarked ||
    tierInfo.tier === "strong" ||
    tierInfo.tier === "likely" ||
    tierInfo.tier === "weak" ||
    tierInfo.tier === "trace";

  const detailLines = [
    `Модел: ${core.model}`,
    `Профил: ${core.profileKey} (${core.exact ? "точен размер" : "приближен"})`,
    `Фазово съвпадение: ${(core.phaseMatch * 100).toFixed(1)}%`,
    `Увереност: ${(core.confidence * 100).toFixed(1)}%`,
    "",
    tierInfo.explanation,
    "",
    "Референтни стойности:",
    "  Силен SynthID: ~60–75%",
    "  Слаб / частичен: ~52–58%",
    "  Без watermark: под ~48%",
  ];

  if (candidates?.length > 1) {
    detailLines.splice(4, 0, "", "По модел:");
    for (const c of candidates) {
      detailLines.splice(
        5,
        0,
        `  • ${c.model}: ${(c.phaseMatch * 100).toFixed(1)}%${c.exact ? " (точен)" : ""}`
      );
    }
  }

  return {
    ok: true,
    detected: bannerDetected,
    isWatermarked: core.isWatermarked,
    verdict: bannerDetected ? "ai" : "human",
    aiPercent: bannerDetected
      ? Math.min(98, Math.round(50 + core.confidence * 48))
      : Math.round(15 + core.phaseMatch * 25),
    humanPercent: bannerDetected
      ? Math.round(20 + (1 - core.confidence) * 30)
      : Math.min(95, Math.round(65 + (1 - core.phaseMatch) * 30)),
    confidencePercent: Math.round(core.confidence * 100),
    phaseMatch: Math.round(core.phaseMatch * 1000) / 1000,
    tier: tierInfo.tier,
    headline: tierInfo.headline,
    summary: tierInfo.summary,
    explanation: tierInfo.explanation,
    profileKey: core.profileKey,
    modelUsed: core.model,
    exactResolution: core.exact,
    detailText: detailLines.join("\n"),
    bannerText: bannerDetected ? "SynthID открит" : "SynthID не е открит",
  };
}

export async function analyzeSynthID(buffer) {
  try {
    const cb = loadCodebook();
    const meta = await sharp(buffer).metadata();
    const w = meta.width;
    const h = meta.height;
    if (!w || !h) throw new Error("Невалидно изображение");

    const { data: rgb } = await sharp(buffer).ensureAlpha().removeAlpha().raw().toBuffer({
      resolveWithObject: true,
    });

    const picks = pickProfile(cb.profiles, h, w);
    const candidates = await Promise.all(
      picks.map(({ profile, exact, model }) =>
        scoreBins(rgb, w, h, profile, exact).then((scored) => ({ ...scored, model }))
      )
    );

    const exactOnes = candidates.filter((c) => c.exact);
    let core;
    if (exactOnes.length) {
      core = exactOnes.reduce((a, b) => (b.phaseMatch > a.phaseMatch ? b : a));
    } else {
      const prefer = (m) => (m === "gemini-3.1-flash-image-preview" ? 0 : 1);
      core = candidates.reduce((a, b) => {
        if (a.phaseMatch !== b.phaseMatch) return a.phaseMatch < b.phaseMatch ? a : b;
        return prefer(a.model) <= prefer(b.model) ? a : b;
      });
    }

    return buildApiResult(core, candidates);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      detected: false,
      bannerText: "SynthID — грешка",
      tier: "error",
      headline: "SynthID анализ — грешка",
      summary: err?.message || "Неуспешен анализ",
      detailText: String(err?.message || err),
    };
  }
}
