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

/**
 * Journalist-grade thresholds — fail closed.
 * Random phase match is ~0.50; real Gemini SynthID often sits ~0.65–0.80.
 * Official ground truth is only https://synthid.withgoogle.com — this local
 * spectral screen must NEVER claim a hit that official would miss. Prefer
 * false negatives over false positives for newsroom use.
 *
 * Resized (non-exact) profiles are screening-only and cannot set detected=true.
 */
const PHASE_WM_EXACT = 0.7;
const PHASE_WM_RESIZED = 0.78;
const PHASE_STRONG = 0.74;
const UNIVERSAL_VOTE = 0.68;
const CHANNEL_WEIGHTS = [0.25, 0.55, 0.2];
const TOP_K_PER_CH = 128;
const GREEN_CH = 1;
const HEADLINE_DETECTED = "Възможен SynthID сигнал — потвърдете официално";
const HEADLINE_CLEAN = "Няма потвърден SynthID сигнал (локален екран)";
const OFFICIAL_URL = "https://synthid.withgoogle.com";

/** Blog universal carrier offsets (1024×1024 reference), from synthid_bypass_v4. */
const UNIVERSAL_CARRIER_REF = [
  [14, 14],
  [14, -14],
  [-14, 14],
  [-14, -14],
  [98, 14],
  [98, -14],
  [-98, 14],
  [-98, -14],
  [126, 14],
  [126, -14],
  [-126, 14],
  [-126, -14],
  [128, 128],
  [128, -128],
  [-128, 128],
  [-128, -128],
  [210, 14],
  [210, -14],
  [-210, 14],
  [-210, -14],
  [238, 14],
  [238, -14],
  [-238, 14],
  [-238, -14],
];
const UNIVERSAL_REF_H = 1024;
const UNIVERSAL_REF_W = 1024;

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

function scaleUniversalBins(h, w) {
  const nyqY = Math.floor(h / 2);
  const nyqX = Math.floor(w / 2);
  const out = [];
  const seen = new Set();
  for (const [fy, fx] of UNIVERSAL_CARRIER_REF) {
    const y = Math.round((fy * h) / UNIVERSAL_REF_H);
    const x = Math.round((fx * w) / UNIVERSAL_REF_W);
    if (y === 0 && x === 0) continue;
    if (y < 0 || x < 0 || y >= h || x >= w) continue;
    if (Math.abs(y) >= nyqY || Math.abs(x) >= nyqX) continue;
    const key = `${y},${x}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([y, x]);
  }
  return out;
}

function phaseRefAt(profile, y, x, ch, maxDist = 3) {
  const exact = profile.bins.find((b) => b.ch === ch && b.y === y && b.x === x);
  if (exact) return exact.phase;
  let best = null;
  let bestD = 999;
  for (const b of profile.bins) {
    if (b.ch !== ch) continue;
    const d = Math.abs(b.y - y) + Math.abs(b.x - x);
    if (d <= maxDist && d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best?.phase ?? null;
}

/** Universal carrier phase match (green channel), aligned with Python detect_universal_phase. */
function scoreUniversalPhase(phases, h, w, profile) {
  const imgPhase = phases[GREEN_CH];
  if (!imgPhase) return null;
  const coords = scaleUniversalBins(h, w);
  const matches = [];
  for (const [y, x] of coords) {
    const ref = phaseRefAt(profile, y, x, GREEN_CH, 24);
    if (ref == null) continue;
    const diff = phaseDiff(imgPhase[y][x], ref);
    matches.push(1 - diff / Math.PI);
  }
  if (!matches.length) return null;
  return matches.reduce((a, c) => a + c, 0) / matches.length;
}

function pickTopBins(chBins, limit) {
  return [...chBins].sort((a, b) => b.cons - a.cons).slice(0, limit);
}

function applyUniversalSupport(core, universalPhase) {
  return { ...core, universalPhase: universalPhase ?? core.universalPhase ?? null };
}

function journalistWatermarked(core) {
  // Never claim a watermark after resize — codebook mismatch → false positives.
  if (!core.exact) return false;

  // Dual-signal only: phase + universal carriers. Single-signal "strong" was FP-prone.
  return Boolean(
    core.phaseMatch >= PHASE_WM_EXACT &&
      core.universalPhase != null &&
      core.universalPhase >= UNIVERSAL_VOTE
  );
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
      .resize(workW, workH, { fit: "fill", kernel: "cubic" })
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
    const pool = profile.bins.filter((b) => b.ch === ch && b.cons >= consensusFloor);
    const chBins = pickTopBins(pool, TOP_K_PER_CH);
    if (!chBins.length) continue;

    const imgPhase = phases[ch];
    const matches = [];
    for (const b of chBins) {
      if (b.y >= h || b.x >= w) continue;
      const diff = phaseDiff(imgPhase[b.y][b.x], b.phase);
      matches.push(1 - diff / Math.PI);
    }
    if (matches.length) {
      perChannel.push({
        ch,
        score: matches.reduce((a, c) => a + c, 0) / matches.length,
      });
    }
  }

  if (!perChannel.length) return null;

  let phaseMatch = 0;
  let wSum = 0;
  for (const { ch, score } of perChannel) {
    const wt = CHANNEL_WEIGHTS[ch] ?? 0.33;
    phaseMatch += score * wt;
    wSum += wt;
  }
  phaseMatch /= wSum;

  const phaseScore = 1 / (1 + Math.exp(-18 * (phaseMatch - 0.58)));
  const confidence = Math.min(1, phaseScore);
  const isWatermarked = false;

  const universalPhase = scoreUniversalPhase(phases, w, h, profile);

  return {
    phaseMatch,
    confidence,
    isWatermarked,
    profileKey: `${profile.model}/${profile.h}x${profile.w}`,
    exact,
    phaseThreshold: exact ? PHASE_WM_EXACT : PHASE_WM_RESIZED,
    model: profile.model,
    universalPhase,
  };
}

function scoreBinsOnBuffer(rgb, w, h, profile, exact) {
  const phases = channelPhases(rgb, w, h);
  const floors = [0.7, 0.6];
  let best = null;
  for (const floor of floors) {
    const scored = scoreBinsAtFloor(phases, w, h, profile, exact, floor);
    if (scored) {
      best = scored;
      break;
    }
  }

  if (!best) {
    return applyUniversalSupport(
      {
        phaseMatch: 0,
        confidence: 0,
        isWatermarked: false,
        profileKey: `${profile.model}/${profile.h}x${profile.w}`,
        exact,
        phaseThreshold: exact ? PHASE_WM_EXACT : PHASE_WM_RESIZED,
        model: profile.model,
        universalPhase: scoreUniversalPhase(phases, w, h, profile),
      },
      scoreUniversalPhase(phases, w, h, profile)
    );
  }
  return applyUniversalSupport(best, best.universalPhase);
}

function tierFromCore(core) {
  if (core.isWatermarked) {
    const strong = core.phaseMatch >= PHASE_STRONG && core.exact;
    return {
      tier: strong ? "strong" : "likely",
      headline: HEADLINE_DETECTED,
      summary:
        "Локалният спектрален екран вижда възможен Google SynthID шаблон. Това НЕ е официален резултат от Google.",
      explanation: strong
        ? `Силен локален сигнал при оригинална резолюция. Преди публикация задължително проверете в официалния детектор: ${OFFICIAL_URL}`
        : `Два локални сигнала съвпадат, но неофициалният тест често греши. Потвърдете в ${OFFICIAL_URL} — ако там няма watermark, докладвайте като неоткрит.`,
    };
  }
  return {
    tier: "clean",
    headline: HEADLINE_CLEAN,
    summary:
      "Локалният екран не намира надежден SynthID. Ако официалният Google детектор също е отрицателен — няма SynthID.",
    explanation:
      `Това е неофициален спектрален тест, не Google SynthID Detector. Официална проверка: ${OFFICIAL_URL}. Липса на SynthID не доказва човешки произход (Midjourney, DALL·E и др. нямат този знак).`,
  };
}

function buildApiResult(core, candidates) {
  const gated = { ...core, isWatermarked: journalistWatermarked(core) };
  const tierInfo = tierFromCore(gated);
  const bannerDetected = gated.isWatermarked;

  const resolutionNote = core.exact
    ? "Анализ при оригинална резолюция."
    : `Анализ след мащабиране до ${core.profileKey} — само скрининг; при resize не се докладва „открит“.`;

  const detailLines = [
    "СТАТУС: неофициален локален спектрален екран (не Google).",
    `Официален детектор: ${OFFICIAL_URL}`,
    `Модел: ${core.model}`,
    `Профил: ${core.profileKey} (${core.exact ? "точен размер" : "приближен / resize"})`,
    resolutionNote,
    `Фазово съвпадение (V4): ${(core.phaseMatch * 100).toFixed(1)}%`,
    core.universalPhase != null
      ? `Универсални носители (зелен канал): ${(core.universalPhase * 100).toFixed(1)}%`
      : null,
    `Увереност (локална): ${(core.confidence * 100).toFixed(1)}%`,
    `Прагове (fail-closed): точен размер + фаза ≥${(PHASE_WM_EXACT * 100).toFixed(0)}% и универсален ≥${(UNIVERSAL_VOTE * 100).toFixed(0)}% (или фаза ≥${(PHASE_STRONG * 100).toFixed(0)}%)`,
    core.exact
      ? null
      : "Resize: detected=false винаги — codebook-ът не съвпада с резолюцията на файла.",
    "",
    tierInfo.explanation,
    "",
    "Референтни стойности:",
    "  Истински SynthID: обикновено ~65–80% фаза при точен размер",
    "  Случаен шум: около ~50%",
    "  При съмнение винаги вярвайте на synthid.withgoogle.com",
  ];

  const compactDetail = detailLines.filter((line) => line != null);

  if (candidates?.length > 1) {
    const idx = compactDetail.findIndex((l) => l.startsWith("Увереност"));
    const insertAt = idx >= 0 ? idx : compactDetail.length;
    const modelLines = [
      "",
      "По модел:",
      ...candidates.map(
        (c) =>
          `  • ${c.model}: ${(c.phaseMatch * 100).toFixed(1)}%${c.exact ? " (точен)" : ""}${
            c.universalPhase != null ? `, univ. ${(c.universalPhase * 100).toFixed(0)}%` : ""
          }`
      ),
    ];
    compactDetail.splice(insertAt, 0, ...modelLines);
  }

  return {
    ok: true,
    detected: bannerDetected,
    isWatermarked: gated.isWatermarked,
    verdict: bannerDetected ? "uncertain" : "uncertain",
    aiPercent: 0,
    humanPercent: 0,
    confidencePercent: bannerDetected
      ? Math.round(Math.min(92, 70 + (core.phaseMatch - PHASE_WM_EXACT) * 100))
      : Math.round(core.confidence * 100),
    phaseMatch: Math.round(core.phaseMatch * 1000) / 1000,
    tier: tierInfo.tier,
    headline: tierInfo.headline,
    summary: tierInfo.summary,
    explanation: tierInfo.explanation,
    profileKey: core.profileKey,
    modelUsed: core.model,
    exactResolution: core.exact,
    resolutionNote,
    unofficial: true,
    officialUrl: OFFICIAL_URL,
    universalPhase:
      core.universalPhase != null ? Math.round(core.universalPhase * 1000) / 1000 : null,
    detailText: compactDetail.join("\n"),
    bannerText: bannerDetected ? HEADLINE_DETECTED : HEADLINE_CLEAN,
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
