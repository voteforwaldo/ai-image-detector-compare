const GEMINI_SPARKLE_REGION = {
  label: "Google sparkle / лого",
  note: "Долен десен ъгъл — открит Gemini watermark (✦) или лого.",
  x: 0.82,
  y: 0.82,
  w: 0.14,
  h: 0.14,
  severity: "warn",
};

/** Forensic zones only — not logo/watermark (those need positive detection). */
const FORENSIC_KEYWORD_REGIONS = [
  {
    re: /(?:пръст|ръц|длан).{0,40}(?:деформа|греш|неестеств|лиш|слип|артефакт|анатом)/i,
    label: "Ръце",
    note: "Проверете анатомията на ръцете и пръстите.",
    x: 0.32,
    y: 0.52,
    w: 0.36,
    h: 0.28,
  },
  {
    re: /(?:очи|лиц|зъб|коса|кожа).{0,40}(?:деформа|греш|неестеств|артефакт|размаз|смаз)/i,
    label: "Лице",
    note: "Прегледайте лице, очи и детайли на кожата.",
    x: 0.28,
    y: 0.08,
    w: 0.44,
    h: 0.38,
  },
  {
    re: /(?:текст|надпис|букв).{0,40}(?:греш|нечет|артефакт|изкрив|смаз|неразб)/i,
    label: "Текст",
    note: "Проверете надписи и четимост на текст.",
    x: 0.08,
    y: 0.04,
    w: 0.84,
    h: 0.22,
  },
  {
    re: /(?:фон|заден план).{0,40}(?:несъответ|артефакт|неестеств|повтар)/i,
    label: "Фон",
    note: "Потърсете несъответствия във фона.",
    x: 0.05,
    y: 0.05,
    w: 0.9,
    h: 0.9,
    severity: "info",
  },
  {
    re: /(?:сенк|осветл|отраж).{0,40}(?:несъответ|греш|неестеств|липс)/i,
    label: "Осветление",
    note: "Сравнете сенки, светлина и отражения.",
    x: 0.15,
    y: 0.45,
    w: 0.7,
    h: 0.45,
  },
  {
    re: /(?:текстур|артефакт|контур|симетр).{0,40}(?:неестеств|повтар|греш|артефакт)/i,
    label: "Текстури",
    note: "Обърнете внимание на повтарящи се или неестествени текстури.",
    x: 0.12,
    y: 0.12,
    w: 0.76,
    h: 0.76,
  },
  {
    re: /(?:перспектив|деформац|структур).{0,40}(?:греш|неестеств|изкрив)/i,
    label: "Перспектива",
    note: "Проверете геометрия и перспектива.",
    x: 0.2,
    y: 0.2,
    w: 0.6,
    h: 0.6,
  },
];

const POSITIVE_LOGO_EVIDENCE_RE = [
  /(?:видим|открит|наличен|забелязан|присъства|има|се\s+вижда).{0,55}(?:sparkle|ромб|✦|воден\s*знак|watermark|лого|badge)/i,
  /(?:sparkle|ромб|✦|воден\s*знак|watermark|лого|badge).{0,55}(?:видим|открит|наличен|забелязан|присъства|се\s+вижда)/i,
  /долен[\s-]*десен.{0,45}(?:вижда|открит|sparkle|ромб|watermark|✦|лого)/i,
  /(?:google\s*)?sparkle\s*watermark/i,
  /made with google/i,
  /content\s*credentials.{0,30}(?:видим|открит|икон|badge|panel)/i,
  /c2pa.{0,30}(?:видим|открит|badge|икон|panel)/i,
];

const LOGO_ABSENCE_RE =
  /(?:няма|без|липсва|не\s+(?:са\s+)?открит|не\s+(?:се\s+)?(?:вижда|открива)|not\s+(?:visibly\s+)?(?:detected|found|present)|no\s+visible|absent).{0,50}(?:sparkle|ромб|✦|воден\s*знак|видим\s*watermark|видим\s*лого|google\s*sparkle|watermarks?|лого)/i;

const LOGO_ABSENCE_REVERSE =
  /(?:sparkle|ромб|✦|воден\s*знак|видим\s*watermark|видим\s*лого|google\s*sparkle|watermarks?|лого).{0,50}(?:няма|липсва|не\s+(?:са\s+)?открит|не\s+(?:се\s+)?вижда|not\s+found|absent)/i;

const KNOWN_PLATFORM_LOGOS = new Set([
  "gemini",
  "google",
  "google_ai",
  "imagen",
  "openai",
  "chatgpt",
  "dalle",
  "midjourney",
  "adobe",
  "getty",
  "shutterstock",
  "canva",
]);

export function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function normalizeRegion(r, index) {
  const w = clamp01(r.w ?? 0.12);
  const h = clamp01(r.h ?? 0.12);
  let x = clamp01(r.x ?? 0);
  let y = clamp01(r.y ?? 0);
  if (x + w > 1) x = Math.max(0, 1 - w);
  if (y + h > 1) y = Math.max(0, 1 - h);

  return {
    id: index + 1,
    label: String(r.label || `Зона ${index + 1}`).slice(0, 40),
    note: String(r.note || r.label || "").slice(0, 200),
    x,
    y,
    w: Math.max(0.06, w),
    h: Math.max(0.06, h),
    severity: r.severity === "info" ? "info" : "warn",
  };
}

function regionKey(r) {
  return `${r.label}|${Math.round(r.x * 100)}|${Math.round(r.y * 100)}`;
}

function mergeRegions(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const r of list) {
      const norm = normalizeRegion(r, out.length);
      const key = regionKey(norm);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(norm);
      if (out.length >= 4) return out;
    }
  }
  return out;
}

function isLogoLikeRegion(r) {
  return /sparkle|ромб|✦|лого|watermark|воден\s*знак|gemini|google\s*ai|c2pa|provenance|digital\s*watermark|ai\s*ui/i.test(
    `${r.label} ${r.note}`
  );
}

/** True only when model or text says a logo/watermark was actually seen. */
export function hasPositiveLogoEvidence(text, gemini) {
  if (gemini?.googleSparkle === true) return true;

  const pl = String(gemini?.platformLogo || "")
    .toLowerCase()
    .trim();
  if (pl && pl !== "none" && pl !== "unknown" && KNOWN_PLATFORM_LOGOS.has(pl.replace(/\s+/g, "_"))) {
    return true;
  }

  if (!text) return false;
  const t = text.trim();
  if (!t) return false;

  if (LOGO_ABSENCE_RE.test(t) || LOGO_ABSENCE_REVERSE.test(t)) {
    return false;
  }

  return POSITIVE_LOGO_EVIDENCE_RE.some((re) => re.test(t));
}

function filterLogoRegions(regions, gemini, summary) {
  if (hasPositiveLogoEvidence(summary, gemini)) return regions;
  return regions.filter((r) => !isLogoLikeRegion(r));
}

export function inferForensicFromSummary(text) {
  if (!text) return [];
  const found = [];

  for (const item of FORENSIC_KEYWORD_REGIONS) {
    if (item.re.test(text)) {
      found.push({
        label: item.label,
        note: item.note,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        severity: item.severity || "warn",
      });
    }
    if (found.length >= 4) break;
  }

  return found;
}

/** Add bottom-right corner only when sparkle/logo was positively detected. */
function ensureLogoCornerIfDetected(regions, gemini, summary) {
  if (!hasPositiveLogoEvidence(summary, gemini)) return regions;

  const hasCorner = regions.some(
    (r) =>
      /sparkle|ромб|✦|лого|watermark/i.test(`${r.label} ${r.note}`) &&
      r.x >= 0.65 &&
      r.y >= 0.65
  );
  if (hasCorner) return regions;

  return mergeRegions([GEMINI_SPARKLE_REGION], regions);
}

export function resolveFocusRegions(gemini) {
  if (!gemini?.ok) return [];

  const summary = gemini.summary || gemini.rawText || "";
  let regions = [];

  const fromApi = gemini.focusRegions;
  if (Array.isArray(fromApi) && fromApi.length) {
    regions = fromApi.map((r, i) => normalizeRegion(r, i));
    regions = filterLogoRegions(regions, gemini, summary);
  } else {
    regions = inferForensicFromSummary(summary);
  }

  regions = ensureLogoCornerIfDetected(regions, gemini, summary);
  return regions.map((r, i) => ({ ...r, id: i + 1 }));
}

/** @deprecated use inferForensicFromSummary */
export function inferFocusFromSummary(text) {
  return inferForensicFromSummary(text);
}
